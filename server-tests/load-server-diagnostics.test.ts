import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ClientState, Room, getMessageBytes, Protocol } from '@colyseus/core';
import { WebSocketClient } from '@colyseus/ws-transport';
import { MovementInputs } from '../server/movementInputs';
import { installDiagnosticsResetHandler } from '../scripts/load-server-metrics';
import { installServerDiagnostics, type DiagnosticClient, type DiagnosticRoom, type RoomMessagePrototype } from '../scripts/websocket-server-diagnostics';

class SocketFixture extends EventEmitter {
  onleave = () => {};
  bufferedAmount = 0;
  _socket = { readableLength: 0, writableLength: 0 };
  readyState = 1;
  send(this: SocketFixture, data: unknown, options: unknown, callback?: (error?: Error) => void) {
    assert.equal(this instanceof SocketFixture, true);
    this.bufferedAmount += (data as Uint8Array).byteLength;
    callback?.();
    return options;
  }
  close(code?: number) { this.readyState = 3; this.emit('close', code); }
}

function packet(seqs: number[], ms = 0) {
  return getMessageBytes.raw(Protocol.ROOM_DATA, 'inputs', { revision: 0, inputs: seqs.map(seq => ({ seq, x: 0, y: 0, ms })) });
}

function fixture(options: { maxClients?: number; maxWindows?: number; maxExamples?: number; native?: boolean } = {}) {
  let time = 0;
  const queue = new MovementInputs(10000);
  const player = { inputSeq: 0, x: 420, y: 570, facing: 'down', moving: false, seat: '', action: '', drink: '', actionUntil: 0 };
  const socket = new SocketFixture(); socket.on('message', () => {});
  const client = new WebSocketClient('fixture-secret-session', socket as any); client.state = ClientState.JOINED;
  const room = new Room() as Room & { controls: Map<string, { inputs: MovementInputs }>; tick(): void };
  room.state = { players: new Map([[client.sessionId, player]]) };
  room.controls = new Map([[client.sessionId, { inputs: queue }]]);
  room.maxMessagesPerSecond = 80; room.clock.currentTime = 10000;
  room.tick = () => { queue.advance(player, 10000 + time); player.inputSeq = queue.sequence; };
  const unbind = room.onMessage('inputs', (_client, value) => { queue.accept(player, value.inputs, 10000 + time); player.inputSeq = queue.sequence; });
  const native = (Room.prototype as unknown as RoomMessagePrototype)._onMessage;
  const prototype: RoomMessagePrototype = { _onMessage: options.native === false ? () => 'original-return' : native };
  const diagnostics = installServerDiagnostics(prototype, { leavingState: ClientState.LEAVING, now: () => time, wallNow: () => 10000 + time, ...options });
  return { queue, player, client, socket, room, diagnostics, prototype, unbind,
    advanceTime(ms: number, tickClock = true) { time += ms; if (tickClock) room.clock.currentTime = 10000 + time; },
    send(buffer: Buffer) { return prototype._onMessage.call(room as unknown as DiagnosticRoom, client as unknown as DiagnosticClient, buffer); } };
}

test('real core limiter and codec distinguish 82 received inputs from 81 dispatched packets', async () => {
  const f = fixture();
  try {
    for (let n = 0; n < 82; n++) { f.send(packet([2 * n + 1, 2 * n + 2])); f.advanceTime(.02, false); }
    await new Promise(resolve => setImmediate(resolve));
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.incomingFrames, 82); assert.equal(stats.inputFrames, 82);
    assert.equal(stats.decodedInputSequences, 164); assert.equal(stats.inputAcceptCalls, 81);
    assert.equal(stats.inputDispatchEvents, 81);
    assert.equal(stats.queueAcceptedSteps, 162); assert.equal(stats.receivedSequencesCoveredByInputSeq, 162);
    assert.equal(stats.limiterHits, 1); assert.equal(stats.maxRollingInputsPerClientSecond, 82);
    assert.equal(stats.examples[0].clockWindowFrames, 82); assert.equal(stats.examples[0].timeline.length, 12);
    assert.equal(stats.examples[0].timeline.at(-1)?.lastSequence, 164);
    assert.equal(stats.examples[0].messageListeners, 1); assert.equal(stats.closedSocketCodes['4002'], 1);
    assert.equal(stats.unacknowledgedSequencesAtClose, 2);
    assert.equal(f.room.maxMessagesPerSecond, 80); assert.equal(f.client.state, ClientState.LEAVING);
    assert.equal(stats.inputDecodeErrors, 0); assert.equal(stats.diagnosticErrors, 0);
  } finally { f.diagnostics.close(); }
});

test('actual handler dispatch remains visible when application guards reject inputs before the movement queue', () => {
  const f = fixture();
  try {
    f.unbind(); f.room.onMessage('inputs', () => {});
    f.send(packet([1, 2]));
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.inputFrames, 1); assert.equal(stats.inputDispatchEvents, 1);
    assert.equal(stats.inputAcceptCalls, 0); assert.equal(stats.queueAcceptedSteps, 0); assert.equal(stats.limiterHits, 0);
  } finally { f.diagnostics.close(); }
});

test('real movement queue records delayed advancement and local receive-to-inputSeq age', () => {
  const f = fixture();
  try {
    f.send(packet([1, 2, 3, 4], 50));
    let stats = f.diagnostics.snapshot();
    assert.equal(stats.queueAcceptedSteps, 4); assert.equal(stats.queueAdvancedRemovals, 2);
    assert.equal(stats.pending.queuedSteps, 2); assert.equal(stats.pending.queuedMovementMs, 100);
    assert.equal(stats.receivedSequencesCoveredByInputSeq, 2); assert.equal(f.player.inputSeq, 2);
    f.advanceTime(125); f.room.tick(); stats = f.diagnostics.snapshot(true);
    assert.equal(stats.queueAdvancedRemovals, 4); assert.equal(stats.queueCancelledRemovals, 0);
    assert.equal(stats.pending.queuedSteps, 0); assert.equal(stats.receivedSequencesCoveredByInputSeq, 4);
    assert.equal(stats.advanceQueueResidence.maxMs, 125); assert.equal(stats.receiveToInputSeqAge.maxMs, 125);
    assert.equal(stats.receiveToInputSeqAge.count, 4);
    assert.ok(stats.receiveToInputSeqAge.p95UpperBoundMs >= 125 && stats.receiveToInputSeqAge.p95UpperBoundMs <= 137.5);
    assert.equal(stats.windows[0].intervalMs, 125); assert.equal(stats.windows[0].inputFrames, 1);
  } finally { f.diagnostics.close(); }
});

test('cancelled work is separated from advance even though inputSeq acknowledges it', () => {
  const f = fixture();
  try {
    f.send(packet([1, 2, 3, 4], 50)); f.advanceTime(75);
    f.queue.cancel(); f.player.inputSeq = f.queue.sequence; f.room.tick();
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.queueAdvancedRemovals, 2); assert.equal(stats.queueCancelledRemovals, 2);
    assert.equal(stats.cancelQueueResidence.maxMs, 75); assert.equal(stats.receivedSequencesCoveredByInputSeq, 4);
    assert.match(stats.definitions.receiveToInputSeqAge, /not RTT or proof every step was applied/);
  } finally { f.diagnostics.close(); }
});

test('security cancel nested inside real advance preserves the step already removed by advance', () => {
  const f = fixture();
  try {
    f.send(packet([1, 2, 3, 4], 50));
    (f.player as typeof f.player & { security: string }).security = 'fixture-security';
    f.advanceTime(50); f.room.tick();
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.queueAcceptedSteps, 4); assert.equal(stats.queueAdvancedRemovals, 3);
    assert.equal(stats.queueCancelledRemovals, 1); assert.equal(stats.receivedSequencesCoveredByInputSeq, 4);
    assert.equal(stats.advanceQueueResidence.maxMs, 50); assert.equal(stats.cancelQueueResidence.maxMs, 50);
  } finally { f.diagnostics.close(); }
});

test('rolling wall-time arrival window exposes a frozen limiter clock instead of claiming a delivery burst', async () => {
  const f = fixture();
  try {
    for (let n = 0; n < 82; n++) { f.send(packet([n + 1])); f.advanceTime(20, false); }
    await new Promise(resolve => setImmediate(resolve));
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.limiterHits, 1); assert.equal(stats.maxClockWindowFrames, 82);
    assert.equal(stats.maxRollingFramesPerClientSecond, 50);
    assert.equal(stats.examples[0].clockWindowRealMs, 1620); assert.equal(stats.examples[0].clockWindowClockMs, 0);
    assert.equal(stats.examples[0].roomClockLagMs, 1620);
  } finally { f.diagnostics.close(); }
});

test('clock minima use real positive observations in each window rather than a synthetic zero', () => {
  const f = fixture({ native: false });
  try {
    f.advanceTime(10, false); f.send(packet([1])); f.advanceTime(10, false); f.send(packet([2]));
    let stats = f.diagnostics.snapshot(true);
    assert.equal(stats.minRoomClockLagMs, 10); assert.equal(stats.maxRoomClockLagMs, 20);
    assert.equal(stats.windows[0].minRoomClockLagMs, 10);
    f.advanceTime(30, false); f.send(packet([3])); stats = f.diagnostics.snapshot(true);
    assert.equal(stats.minRoomClockLagMs, 10); assert.equal(stats.maxRoomClockLagMs, 50);
    assert.equal(stats.windows[1].minRoomClockLagMs, 50); assert.equal(stats.windows[1].maxRoomClockLagMs, 50);
  } finally { f.diagnostics.close(); }
});

test('reset starts a new epoch while preserving actual limiter and queued state', async () => {
  const f = fixture();
  try {
    for (let n = 0; n < 40; n++) { f.send(packet([n + 1])); f.advanceTime(.01, false); }
    const counter = f.client._numMessagesLastSecond, resetsAt = f.client._messageCountResetsAt;
    f.diagnostics.reset();
    assert.equal(f.client._numMessagesLastSecond, counter); assert.equal(f.client._messageCountResetsAt, resetsAt);
    assert.equal(f.diagnostics.snapshot().incomingFrames, 0);
    for (let n = 40; n < 82; n++) { f.send(packet([n + 1])); f.advanceTime(.01, false); }
    await new Promise(resolve => setImmediate(resolve));
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.incomingFrames, 42); assert.equal(stats.limiterHits, 1); assert.equal(stats.maxClockWindowFrames, 82);
    assert.equal(stats.examples[0].rollingFrames, 42);
  } finally { f.diagnostics.close(); }

  const queued = fixture();
  try {
    queued.send(packet([1, 2, 3, 4], 50)); queued.diagnostics.reset();
    assert.equal(queued.queue.pendingCount, 2); assert.equal(queued.player.inputSeq, 2);
    assert.equal(queued.diagnostics.snapshot().queueAcceptedSteps, 0);
    queued.advanceTime(100); queued.room.tick();
    assert.equal(queued.diagnostics.snapshot().queueAdvancedRemovals, 2);
    assert.equal(queued.diagnostics.snapshot().receivedSequencesCoveredByInputSeq, 0);
  } finally { queued.diagnostics.close(); }
});

test('outbound observation preserves callbacks, options, return values and restores hooks on close', () => {
  const f = fixture();
  const originalSend = f.socket.send, originalTick = f.room.tick, originalAccept = f.queue.accept;
  try {
    f.send(packet([1])); f.socket._socket.readableLength = 15; f.socket._socket.writableLength = 200;
    const options = { binary: true }; let called = 0;
    assert.equal(f.socket.send(new Uint8Array(400), options, () => called++), options);
    assert.equal(called, 1);
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.outgoingSendCalls, 1); assert.equal(stats.outgoingBytes, 400);
    assert.equal(stats.maxWebSocketBufferedBytes, 400); assert.equal(stats.maxSocketReadableBytes, 15); assert.equal(stats.maxSocketWritableBytes, 200);
    assert.equal(stats.pending.webSocketBufferedBytes, 400);
    f.socket.close(1006);
    assert.equal(f.socket.send, originalSend); assert.equal(f.room.tick, originalTick); assert.equal(f.queue.accept, originalAccept);
    assert.equal(f.socket.listenerCount('close'), 0); assert.equal(f.diagnostics.snapshot().coverage.activeTrackedClients, 0);
    assert.equal(f.diagnostics.snapshot().closedSocketCodes['1006'], 1);
    assert.equal(f.diagnostics.snapshot().closedSocketSamples[0].peakWebSocketBufferedBytes, 400);
  } finally { f.diagnostics.close(); }
});

test('all retained histories and client tracking are bounded and payloads never enter output', () => {
  const f = fixture({ native: false, maxClients: 1, maxWindows: 3, maxExamples: 2 });
  try {
    f.client._numMessagesLastSecond = 80; f.client._messageCountResetsAt = 20000;
    for (let n = 0; n < 400; n++) f.send(packet(Array.from({ length: 20 }, (_, i) => 20 * n + i + 1)));
    for (let i = 0; i < 5; i++) { f.advanceTime(1000); f.diagnostics.snapshot(true); }
    const other = new WebSocketClient('another-secret-token', new SocketFixture() as any); other.state = ClientState.JOINED;
    f.prototype._onMessage.call(f.room as unknown as DiagnosticRoom, other as unknown as DiagnosticClient, packet([1]));
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.maxRollingFramesPerClientSecond, 256); assert.equal(stats.rollingWindowOverflows, 144);
    assert.equal(stats.arrivalTrackingEvictions, 8000 - 256); assert.equal(stats.examples.length, 2);
    assert.equal(stats.windows.length, 3); assert.equal(stats.droppedWindows, 2); assert.equal(stats.untrackedClientFrames, 1);
    assert.equal(stats.coverage.activeTrackedClients, 1);
    const output = JSON.stringify(stats);
    assert.ok(output.length < 50000); assert.doesNotMatch(output, /fixture-secret-session|another-secret-token|revision|sprint|sessionId/);
  } finally { f.diagnostics.close(); }
});

test('sequence repeats, regression and gaps remain distinct from actual acceptance', () => {
  const f = fixture();
  try {
    f.send(packet([1, 2])); f.send(packet([1, 2])); f.send(packet([5])); f.send(packet([4]));
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.repeatedInputSequences, 2); assert.equal(stats.regressingInputSequences, 1);
    assert.equal(stats.sequenceGapEvents, 1); assert.equal(stats.sequenceGapSize, 2);
    assert.equal(stats.queueAcceptedSteps, 3); assert.equal(stats.inputAcceptSuccesses, 2);
  } finally { f.diagnostics.close(); }
});

test('invalid and oversized inputs do not change original dispatch or exceptions', () => {
  const f = fixture({ native: false });
  try {
    const header = Buffer.from([13, 0xa6, 105, 110, 112, 117, 116, 115]);
    assert.equal(f.send(Buffer.concat([header, Buffer.from([0xc1])])), 'original-return');
    assert.equal(f.send(Buffer.concat([header, Buffer.alloc(16384)])), 'original-return');
    f.client.state = ClientState.LEAVING; assert.equal(f.send(packet([1])), 'original-return');
    const stats = f.diagnostics.snapshot();
    assert.equal(stats.incomingFrames, 2); assert.equal(stats.inputDecodeErrors, 1); assert.equal(stats.oversizedInputFrames, 1);
    assert.equal(stats.diagnosticErrors, 0);
  } finally { f.diagnostics.close(); }
  const failure = new Error('fixture failure');
  const prototype: RoomMessagePrototype = { _onMessage: () => { throw failure; } };
  const diagnostics = installServerDiagnostics(prototype, { leavingState: ClientState.LEAVING });
  try {
    const room = { clock: { currentTime: Date.now() }, maxMessagesPerSecond: 80 };
    const client = { state: ClientState.JOINED, sessionId: 'secret', ref: new SocketFixture() };
    assert.throws(() => prototype._onMessage.call(room, client, packet([1])), error => error === failure);
  } finally { diagnostics.close(); }
});

test('IPC reset acknowledges only after the synchronous reset and detaches cleanly', () => {
  const channel = new EventEmitter() as EventEmitter & { connected: boolean; send(message: any, callback: (error: Error | null) => void): void };
  channel.connected = true; let pendingFrames = 42; const replies: any[] = [];
  channel.send = (message, callback) => { assert.equal(pendingFrames, 0); replies.push(message); callback(null); };
  const remove = installDiagnosticsResetHandler(channel, () => { pendingFrames = 0; }, true);
  channel.emit('message', { kind: 'reset-load-diagnostics', requestId: 'epoch_1' });
  assert.deepEqual(replies, [{ kind: 'load-diagnostics-reset', requestId: 'epoch_1', diagnosticsEnabled: true }]);
  channel.emit('message', { kind: 'reset-load-diagnostics', requestId: 'invalid\nrequest' });
  assert.equal(replies.length, 1); remove(); assert.equal(channel.listenerCount('message'), 0);
  channel.emit('message', { kind: 'reset-load-diagnostics', requestId: 'epoch_2' }); assert.equal(replies.length, 1);
});

test('final IPC snapshot captures the last partial window and works when detailed diagnostics are disabled', () => {
  const f = fixture();
  const channel = new EventEmitter() as EventEmitter & { connected: boolean; send(message: any, callback: (error: Error | null) => void): void };
  channel.connected = true; const replies: any[] = [];
  channel.send = (message, callback) => { replies.push(message); callback(null); };
  let resets = 0;
  const remove = installDiagnosticsResetHandler(channel, () => { resets++; f.diagnostics.reset(); }, true, () => f.diagnostics.snapshot(true));
  try {
    f.send(packet([1, 2])); f.advanceTime(450);
    channel.emit('message', { kind: 'snapshot-load-diagnostics', requestId: 'final_1' });
    const reply = replies[0];
    assert.equal(reply.kind, 'load-diagnostics-snapshot'); assert.equal(reply.requestId, 'final_1'); assert.equal(resets, 0);
    assert.equal(reply.traffic.inputFrames, 1); assert.equal(reply.traffic.windows[0].intervalMs, 450);
    f.send(packet([3, 4])); assert.equal(reply.traffic.inputFrames, 1);
  } finally { remove(); f.diagnostics.close(); }
  const disabled = installDiagnosticsResetHandler(channel, () => resets++, false);
  try {
    channel.emit('message', { kind: 'reset-load-diagnostics', requestId: 'disabled_reset' });
    channel.emit('message', { kind: 'snapshot-load-diagnostics', requestId: 'disabled_final' });
    assert.equal(replies.at(-2).kind, 'load-diagnostics-reset'); assert.equal(replies.at(-2).diagnosticsEnabled, false);
    assert.equal(replies.at(-1).kind, 'load-diagnostics-snapshot'); assert.equal(replies.at(-1).traffic, undefined);
  } finally { disabled(); }
});

test('periodic IPC payload keeps one window while final tail and cumulative totals cover a long epoch', () => {
  const f = fixture();
  try {
    f.send(packet([1, 2])); f.advanceTime(1000);
    const first = f.diagnostics.snapshot(true, { compact: true });
    const initialBytes = Buffer.byteLength(JSON.stringify(first));
    let periodic = first;
    for (let second = 1; second < 1800; second++) {
      f.send(packet([second * 2 + 1, second * 2 + 2])); f.advanceTime(1000);
      periodic = f.diagnostics.snapshot(true, { compact: true });
      assert.equal(periodic.windows.length, 1);
    }
    const periodicBytes = Buffer.byteLength(JSON.stringify(periodic));
    assert.equal(periodic.windowHistory, 'latest-window'); assert.equal(periodic.retainedWindowCount, 300);
    assert.equal(periodic.droppedWindows, 1500); assert.equal(periodic.inputFrames, 1800);
    assert.equal(periodic.queueAcceptedSteps, 3600); assert.equal(periodic.queueAdvancedRemovals, 3600);
    assert.equal(periodic.receiveToInputSeqAge.count, 3600); assert.equal(periodic.advanceQueueResidence.count, 3600);
    assert.ok(periodicBytes < initialBytes + 750, 'Periodic size must not grow with retained window history');
    const final = f.diagnostics.snapshot();
    assert.equal(final.windowHistory, 'bounded-tail'); assert.equal(final.windows.length, 300);
    assert.equal(final.windows[0].startedAtMs, 1500000); assert.equal(final.windows.at(-1)?.endedAtMs, 1800000);
    assert.equal(final.inputFrames, periodic.inputFrames); assert.deepEqual(final.receiveToInputSeqAge, periodic.receiveToInputSeqAge);
    assert.equal(final.queueAdvancedRemovals, periodic.queueAdvancedRemovals);
    assert.ok(Buffer.byteLength(JSON.stringify(final)) > periodicBytes * 10);
  } finally { f.diagnostics.close(); }
});
