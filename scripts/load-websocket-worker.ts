import type { Room, SeatReservation } from '@colyseus/sdk';
import NodeWebSocket from 'ws';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { LobbyState } from '../server/state';
import { installLoopbackNetworking } from './load-server-metrics';
import { generatorWebSocketEndpoint } from './load-generator-endpoints';
import { BoundedSamples, BrowserInputWindow, PacketTracker, TimerPacer, browserInputLimits, instrumentMethod, isLegacyInputFrame,
  validateMeasurementSeconds, OutboundBufferGuard, OUTBOUND_BUFFER_LIMIT_BYTES } from './load-websocket-diagnostics';

installLoopbackNetworking();
const implementation = process.env.LOAD_SDK_WEBSOCKET ?? 'ws';
if (!['ws', 'native'].includes(implementation)) throw new Error('Unknown local WebSocket implementation');
if (implementation === 'ws') globalThis.WebSocket = NodeWebSocket as unknown as typeof globalThis.WebSocket;
if (!globalThis.WebSocket) throw new Error('Native WebSocket implementation is unavailable');
// The SDK captures globalThis.WebSocket while its module initializes.
const { Client } = await import('@colyseus/sdk');
const transportDescription = { implementation, constructor: globalThis.WebSocket.name, nodeVersion: process.version, undiciVersion: process.versions.undici };

type NodeSocket = { readableLength: number; writableLength: number; bytesRead: number; bytesWritten: number;
  on(type: 'data', callback: (data: unknown) => void): void; off(type: 'data', callback: (data: unknown) => void): void };
type Socket = { bufferedAmount: number; terminate?: () => void; close?: () => void; _socket?: NodeSocket; _receiver?: { _bufferedBytes?: number; writableLength?: number } };
type Member = { room: Room<LobbyState>; seq: number; tracker: PacketTracker; window?: BrowserInputWindow; lastPatch: number; lastMessage: number; lastTcpChunk: number; left: boolean;
  bufferGuard: OutboundBufferGuard; cleanup: () => void; byteBaseline?: { read: number; written: number } };
type InputMode = 'stress' | 'browser-window';
type ConnectCommand = { kind: 'connect'; endpoint: string; canonicalEndpoint?: string; tokens: string[]; concurrency?: number; maxRetries?: number; retryDelayMs?: number; joinTimeoutMs?: number };
type Command = ConnectCommand | { kind: 'measure'; seconds: number; stepsPerPacket?: number; drainMs?: number; inputMode?: InputMode } | { kind: 'shutdown' };
const members: Member[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const send = (message: unknown) => { if (process.connected) process.send?.(message); };
let measuring = false, shuttingDown = false, errors: Record<string, number> = {};
let acks = new BoundedSamples(), intervals = new BoundedSamples(), receivedBytes = 0, packetsSent = 0, maxClientBufferedBytes = 0;
let inputTimer: ReturnType<typeof setTimeout> | undefined, heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let connectionAttempts = 0, connectionRetries = 0;
const retryCodes: Record<string, number> = {};
let closeReasons: Record<string, number> = {}, errorReasons: Record<string, number> = {};
const error = (kind: string) => { errors[kind] = (errors[kind] ?? 0) + 1; };
function safeReason(value: unknown) {
  if (value === undefined || value === null || value === '') return 'empty';
  const message = typeof value === 'string' ? value : value instanceof Error ? value.message : '';
  if (/too many messages per second/i.test(message)) return 'message-rate';
  if (/not registered/i.test(message)) return 'unregistered-message';
  if (/invalid payload|decode|msgpack/i.test(message)) return 'invalid-payload';
  if (/buffer|backpressure/i.test(message)) return 'buffer';
  if (/connection|websocket|socket|network/i.test(message)) return 'socket';
  return 'other';
}
const reason = (counts: Record<string, number>, value: unknown) => { const key = safeReason(value); counts[key] = (counts[key] ?? 0) + 1; };
const socket = (member: Member) => (member.room.connection.transport as unknown as { ws: Socket }).ws;
const bytes = (data: unknown) => typeof data === 'string' ? Buffer.byteLength(data) : data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data.byteLength : 0;
const protocol = (data: unknown) => data instanceof ArrayBuffer ? new Uint8Array(data)[0]
  : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)[0] : undefined;
const freshDiagnostics = () => ({ packetSendMs: new BoundedSamples(), webSocketSendMs: new BoundedSamples(), messageProcessingMs: new BoundedSamples(),
  schemaDecodeMs: new BoundedSamples(), stateCallbackMs: new BoundedSamples(), tcpChunkBytes: new BoundedSamples(),
  receivedFrameIntervalMs: new BoundedSamples(), tcpChunkIntervalMs: new BoundedSamples(),
  webSocketSendCalls: 0, inputFrameSendCalls: 0, sentPayloadBytes: 0, receivedFrames: 0, rawTcpReceiveChunks: 0, rawTcpReceivedBytes: 0,
  receivedProtocolCodes: {} as Record<string, number>, nodeSocketsObserved: new Set<Member>(), maxTcpReadableBytes: 0, maxTcpWritableBytes: 0,
  maxReceiverBufferedBytes: 0, maxReceiverWritableBytes: 0 });
let diagnostics = freshDiagnostics();
function sampleBuffers(member: Member) {
  const ws = socket(member), tcp = ws._socket;
  maxClientBufferedBytes = Math.max(maxClientBufferedBytes, ws.bufferedAmount ?? 0);
  if (!tcp) return;
  diagnostics.nodeSocketsObserved.add(member);
  diagnostics.maxTcpReadableBytes = Math.max(diagnostics.maxTcpReadableBytes, tcp.readableLength ?? 0);
  diagnostics.maxTcpWritableBytes = Math.max(diagnostics.maxTcpWritableBytes, tcp.writableLength ?? 0);
  diagnostics.maxReceiverBufferedBytes = Math.max(diagnostics.maxReceiverBufferedBytes, ws._receiver?._bufferedBytes ?? 0);
  diagnostics.maxReceiverWritableBytes = Math.max(diagnostics.maxReceiverWritableBytes, ws._receiver?.writableLength ?? 0);
}
function attachDiagnostics(member: Member) {
  const ws = socket(member), tcp = ws._socket, active = () => measuring;
  const restore = [instrumentMethod(ws, 'send', active, (duration, args) => {
    diagnostics.webSocketSendMs.add(duration); diagnostics.webSocketSendCalls++; diagnostics.sentPayloadBytes += bytes(args[0]);
    if (isLegacyInputFrame(args[0])) diagnostics.inputFrameSendCalls++; sampleBuffers(member);
  }), instrumentMethod(member.room.connection.events, 'onmessage', active, (duration, args) => {
    const data = (args[0] as { data?: unknown })?.data, code = protocol(data), receivedAt = performance.now() - duration;
    receivedBytes += bytes(data); diagnostics.receivedFrames++; diagnostics.messageProcessingMs.add(duration);
    if (member.lastMessage) diagnostics.receivedFrameIntervalMs.add(Math.max(0, receivedAt - member.lastMessage)); member.lastMessage = receivedAt;
    if (code !== undefined) diagnostics.receivedProtocolCodes[String(code)] = (diagnostics.receivedProtocolCodes[String(code)] ?? 0) + 1;
    sampleBuffers(member);
  }), ...['patch', 'setState'].map(key => instrumentMethod(member.room.serializer, key, active, duration => diagnostics.schemaDecodeMs.add(duration)))];
  const onData = (data: unknown) => { if (measuring) { diagnostics.rawTcpReceiveChunks++; const size = bytes(data), now = performance.now();
    if (member.lastTcpChunk) diagnostics.tcpChunkIntervalMs.add(now - member.lastTcpChunk); member.lastTcpChunk = now;
    diagnostics.rawTcpReceivedBytes += size; diagnostics.tcpChunkBytes.add(size); sampleBuffers(member); } };
  tcp?.on('data', onData);
  let cleaned = false;
  return () => { if (cleaned) return; cleaned = true; tcp?.off('data', onData); for (const detach of restore) detach(); };
}
const connected = () => members.filter(member => !member.left && member.room.connection.isOpen).length;
function rooms() {
  const counts = new Map<string, { count: number; owner: string }>();
  for (const member of members) if (!member.left && member.room.connection.isOpen) {
    const previous = counts.get(member.room.roomId);
    counts.set(member.room.roomId, { count: (previous?.count ?? 0) + 1, owner: new URL(member.room.connection.url!).pathname.split('/')[2] || 'single' });
  }
  return [...counts].map(([id, value]) => ({ id, ...value }));
}
const timeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Local operation timed out')), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
};
class LoopbackClient extends Client {
  constructor(private readonly endpoint: string, token: string, private readonly canonicalEndpoint?: string) { super(endpoint, { headers: { Cookie: 'royal_session=' + token } }); }
  protected override buildEndpoint(reservation: SeatReservation, options?: unknown) {
    return generatorWebSocketEndpoint(super.buildEndpoint(reservation, options), this.endpoint, this.canonicalEndpoint);
  }
}
async function connect(command: ConnectCommand) {
  const { endpoint, tokens } = command;
  const url = new URL(endpoint);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('loopback required');
  const concurrency = command.concurrency ?? 5, maxRetries = command.maxRetries ?? 0;
  const retryDelayMs = command.retryDelayMs ?? 250, joinTimeoutMs = command.joinTimeoutMs ?? 10000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5 || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5
    || !Number.isInteger(retryDelayMs) || retryDelayMs < 200 || retryDelayMs > 3000 || !Number.isInteger(joinTimeoutMs) || joinTimeoutMs < 1000 || joinTimeoutMs > 30000
    || !Array.isArray(tokens) || tokens.some(token => typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))) throw new Error('Invalid local connection command');
  const before = members.length;
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < tokens.length && !shuttingDown) {
      const token = tokens[next++];
      for (let attempt = 0; attempt <= maxRetries && !shuttingDown; attempt++) {
      try {
        connectionAttempts++;
        const client = new LoopbackClient(endpoint, token, command.canonicalEndpoint);
        const pending = client.joinOrCreate<LobbyState>('lobby', { activityProtocol: 1 });
        let expired = false;
        void pending.then(room => { if (expired) { room.reconnection.enabled = false; void room.leave().catch(() => {}); } }).catch(() => {});
        let room: Room<LobbyState>;
        try { room = await timeout(pending, joinTimeoutMs); } catch (failure) { expired = true; throw failure; }
        room.reconnection.enabled = false;
        const member: Member = { room, seq: 0, tracker: new PacketTracker(0, 3), lastPatch: 0, lastMessage: 0, lastTcpChunk: 0,
          left: false, bufferGuard: new OutboundBufferGuard(), cleanup: () => {} };
        members.push(member); const removeWildcard = room.onMessage('*', () => {});
        const onError = (code: number, message?: string) => { error('room-' + code); reason(errorReasons, message); };
        const onLeave = (code: number, message?: string) => { member.left = true; if (measuring) { error('disconnect-' + code); reason(closeReasons, message); } member.cleanup(); };
        const onState = () => {
          if (!measuring) return;
          const now = performance.now(), ack = room.state.players?.get(room.sessionId)?.inputSeq ?? 0;
          if (member.lastPatch) intervals.add(now - member.lastPatch); member.lastPatch = now;
          member.window?.acknowledge(ack); member.tracker.acknowledge(ack, now, value => acks.add(value));
          diagnostics.stateCallbackMs.add(performance.now() - now);
        };
        room.onError(onError); room.onLeave(onLeave); room.onStateChange(onState);
        const detachDiagnostics = attachDiagnostics(member);
        let cleaned = false;
        member.cleanup = () => { if (cleaned) return; cleaned = true;
          detachDiagnostics(); removeWildcard(); room.onError.remove(onError); room.onLeave.remove(onLeave); room.onStateChange.remove(onState); };
        const deadline = performance.now() + 5000;
        while (!member.left && !room.state.players?.get(room.sessionId) && performance.now() < deadline) await delay(10);
        if (!room.state.players?.get(room.sessionId)) {
          error('initial-state'); member.left = true;
          await timeout(room.leave().catch(() => {}), 2000).catch(() => {});
        }
        break;
      } catch (failure) {
        const code = (failure as { code?: number }).code;
        if ((code === 429 || code === 503) && attempt < maxRetries) {
          connectionRetries++; retryCodes[String(code)] = (retryCodes[String(code)] ?? 0) + 1;
          await delay(Math.min(3000, retryDelayMs * 2 ** attempt));
        } else { error('join-' + (Number.isInteger(code) ? code : 'failed')); break; }
      }
      }
    }
  }));
  send({ kind: 'ready', count: members.length, connectedClients: connected(), rooms: rooms(), errors,
    requestedBatch: tokens.length, joinedBatch: members.length - before, connectionAttempts, connectionRetries, retryCodes, transport: transportDescription });
}
async function measure(seconds: number, stepsPerPacket = 3, drainMs = 150, inputMode: InputMode = 'stress') {
  validateMeasurementSeconds(seconds);
  if (!Number.isInteger(stepsPerPacket) || stepsPerPacket < 1 || stepsPerPacket > 6) throw new Error('invalid step count');
  if (!Number.isInteger(drainMs) || drainMs < 0 || drainMs > 10000) throw new Error('invalid drain duration');
  if (inputMode !== 'stress' && inputMode !== 'browser-window') throw new Error('invalid input mode');
  const previouslyBlocked = members.filter(member => member.bufferGuard.blocked).length;
  errors = previouslyBlocked ? { 'generator-buffer-limit': previouslyBlocked } : {};
  closeReasons = {}; errorReasons = {}; acks = new BoundedSamples(); intervals = new BoundedSamples();
  diagnostics = freshDiagnostics(); receivedBytes = packetsSent = maxClientBufferedBytes = 0;
  for (const member of members) {
    member.seq = Math.max(member.seq, member.room.state.players?.get(member.room.sessionId)?.inputSeq ?? 0);
    member.tracker = new PacketTracker(member.seq, inputMode === 'stress' ? stepsPerPacket : undefined);
    member.window = inputMode === 'browser-window' ? new BrowserInputWindow(member.seq) : undefined; member.lastPatch = member.lastMessage = member.lastTcpChunk = 0;
    const tcp = socket(member)._socket; member.byteBaseline = tcp ? { read: tcp.bytesRead, written: tcp.bytesWritten } : undefined;
  }
  const started = performance.now(), beforeCount = connected(), cpuStarted = process.cpuUsage(); measuring = true;
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  const pacer = new TimerPacer(started), timerLateness = new BoundedSamples(), tickCost = new BoundedSamples();
  let generatedInputSteps = 0, sentInputSteps = 0, skippedWindowSteps = 0, windowBlockedPacketOpportunities = 0;
  let unavailableClientOpportunities = 0, missingStateOpportunities = 0, blockedBufferClientOpportunities = 0, clientOpportunities = 0, maxPendingSteps = 0, maxOutgoingSteps = 0;
  const bufferReady = (member: Member) => member.bufferGuard.check(socket(member), peak => {
    maxClientBufferedBytes = Math.max(maxClientBufferedBytes, peak); error('generator-buffer-limit');
  });
  let heartbeatAt = started, heartbeatPackets = 0;
  const tick = () => {
    if (!measuring || shuttingDown) return;
    const tickStarted = performance.now(), timing = pacer.tick(tickStarted); timerLateness.add(timing.lateMs);
    const direction = Math.floor((tickStarted - started) / 2000) % 2 ? 1 : -1;
    for (const member of members) {
      clientOpportunities++;
      if (member.bufferGuard.blocked) { blockedBufferClientOpportunities++; continue; }
      if (member.left || !member.room.connection.isOpen) { unavailableClientOpportunities++; continue; }
      if (!bufferReady(member)) { blockedBufferClientOpportunities++; continue; }
      const player = member.room.state.players?.get(member.room.sessionId); if (!player) { missingStateOpportunities++; continue; }
      try {
        const sendInputs = (inputs: { seq: number; x: number; y: number; ms: number }[]) => {
          if (!bufferReady(member)) throw new Error('Generator buffer is blocked');
          const now = performance.now(); member.room.send('inputs', { revision: player.hallRevision, inputs });
          diagnostics.packetSendMs.add(performance.now() - now);
          member.tracker.record(inputs[inputs.length - 1].seq, now); packetsSent++; sentInputSteps += inputs.length; sampleBuffers(member);
          bufferReady(member);
        };
        if (member.window) {
          for (let step = 0; step < stepsPerPacket; step++) {
            if (member.window.offer(direction, 0, 1000 / (30 * stepsPerPacket))) generatedInputSteps++; else skippedWindowSteps++;
          }
          const previousPackets = packetsSent; member.window.flush(sendInputs);
          if (packetsSent === previousPackets) windowBlockedPacketOpportunities++;
          member.seq = member.window.lastSequence;
          maxPendingSteps = Math.max(maxPendingSteps, member.window.pendingCount); maxOutgoingSteps = Math.max(maxOutgoingSteps, member.window.outgoingCount);
        } else {
          const inputs = Array.from({ length: stepsPerPacket }, (_, index) => ({ seq: member.seq + index + 1, x: direction, y: 0, ms: 1000 / (30 * stepsPerPacket) }));
          generatedInputSteps += inputs.length; sendInputs(inputs); member.seq += inputs.length;
        }
      } catch { if (!member.bufferGuard.blocked) error('send'); }
    }
    tickCost.add(performance.now() - tickStarted);
    inputTimer = setTimeout(tick, Math.max(0, pacer.nextAt - performance.now()));
  };
  inputTimer = setTimeout(tick, Math.max(0, pacer.nextAt - performance.now()));
  heartbeatTimer = setInterval(() => {
    const now = performance.now();
    send({ kind: 'heartbeat', connectedClients: connected(), packetsSent, inputPacketsPerSecond: (packetsSent - heartbeatPackets) * 1000 / (now - heartbeatAt) });
    heartbeatAt = now; heartbeatPackets = packetsSent;
  }, 5000);
  await delay(seconds * 1000);
  clearTimeout(inputTimer); clearInterval(heartbeatTimer); inputTimer = heartbeatTimer = undefined;
  const sendDuration = performance.now() - started;
  const outstanding = () => members.reduce((total, member) => total + member.tracker.outstandingPackets, 0);
  const unacknowledgedAtEndOfSending = outstanding(), packetsAtEndOfSending = packetsSent;
  const drainStarted = performance.now();
  while (outstanding() > 0 && performance.now() - drainStarted < drainMs) await delay(Math.min(10, drainMs));
  const unacknowledgedPackets = outstanding(), duration = performance.now() - started;
  let oldestUnacknowledgedMs = 0, oldestUnacknowledgedTimingExact = true, rawTcpBytesRead = 0, rawTcpBytesWritten = 0;
  for (const member of members) {
    const oldest = member.tracker.oldest(performance.now()); oldestUnacknowledgedMs = Math.max(oldestUnacknowledgedMs, oldest.ms);
    oldestUnacknowledgedTimingExact &&= oldest.exact;
    const tcp = socket(member)._socket; if (tcp && member.byteBaseline) {
      rawTcpBytesRead += Math.max(0, tcp.bytesRead - member.byteBaseline.read); rawTcpBytesWritten += Math.max(0, tcp.bytesWritten - member.byteBaseline.written);
    }
  }
  measuring = false;
  const cpu = process.cpuUsage(cpuStarted), memory = process.memoryUsage(); loop.disable();
  for (const member of members) if (!member.left && member.room.connection.isOpen) {
    if (member.bufferGuard.blocked) continue;
    try { member.room.send('stop'); } catch { error('stop'); }
  }
  send({ kind: 'result', count: members.length, connectedClients: connected(), rooms: rooms(),
    durationSeconds: sendDuration / 1000, observationSeconds: duration / 1000, packetsSent,
    inputPacketsPerSecond: packetsSent * 1000 / sendDuration,
    inputPacketsPerClientPerSecond: packetsSent * 1000 / sendDuration / Math.max(1, beforeCount),
    receivedBytes, receivedBytesPerSecond: receivedBytes * 1000 / duration, maxClientBufferedBytes,
    ackMs: acks.summary(), stateIntervalMs: intervals.summary(), unacknowledgedPackets, unacknowledgedAtEndOfSending, packetsAtEndOfSending,
    drainSeconds: (duration - sendDuration) / 1000, oldestUnacknowledgedMs,
    oldestUnacknowledgedTimingExact, inputMode, offeredInputPacketsPerSecond: beforeCount * 30, offeredInputStepsPerSecond: beforeCount * 30 * stepsPerPacket,
    generatedInputSteps, generatedInputStepsPerSecond: generatedInputSteps * 1000 / sendDuration, sentInputSteps, sentInputStepsPerSecond: sentInputSteps * 1000 / sendDuration,
    acknowledgedInputSteps: members.reduce((total, member) => total + member.tracker.acknowledgedSteps, 0),
    acknowledgedInputStepsPerSecond: members.reduce((total, member) => total + member.tracker.acknowledgedSteps, 0) * 1000 / duration,
    window: { enabled: inputMode === 'browser-window', throttled: skippedWindowSteps > 0 || windowBlockedPacketOpportunities > 0, ...browserInputLimits, maxPendingSteps, maxOutgoingSteps,
      skippedInputSteps: skippedWindowSteps, blockedPacketOpportunities: windowBlockedPacketOpportunities,
      definition: 'MovementPrediction queue limits only; fixed 30 Hz flush opportunities, without browser rendering or its 50 ms flush cadence' },
    timing: { timerTicks: pacer.ticks, skippedTimerTicks: pacer.skippedTicks, nominalClientOpportunities: Math.floor(sendDuration * 30 / 1000) * beforeCount,
      deliveredClientOpportunities: clientOpportunities, unavailableClientOpportunities, missingStateOpportunities, blockedBufferClientOpportunities,
      skippedTimerClientOpportunities: pacer.skippedTicks * beforeCount, timerLatenessMs: timerLateness.summary(), tickWorkMs: tickCost.summary() },
    tracking: { maxPacketsPerClient: 512, maxTrackedPacketsPerClient: Math.max(0, ...members.map(member => member.tracker.maxTrackedPackets)),
      latencyTimingSamplesDropped: members.reduce((total, member) => total + member.tracker.timingSamplesDropped, 0), quantileSampleLimit: 8192,
      residualCountsExact: true, definition: 'Stress residual uses contiguous fixed-size packet sequences; latency storage keeps the latest 512 unacknowledged packets per client' },
    diagnostics: { webSocketSendCalls: diagnostics.webSocketSendCalls, inputFrameSendCalls: diagnostics.inputFrameSendCalls,
      outboundBufferLimitBytes: OUTBOUND_BUFFER_LIMIT_BYTES, bufferBlockedClients: members.filter(member => member.bufferGuard.blocked).length,
      maxOwnedOutboundBufferBytes: Math.max(0, ...members.map(member => member.bufferGuard.peakBytes)),
      sentPayloadBytes: diagnostics.sentPayloadBytes, receivedFrames: diagnostics.receivedFrames, receivedProtocolCodes: diagnostics.receivedProtocolCodes,
      packetSendMs: diagnostics.packetSendMs.summary(), webSocketSendMs: diagnostics.webSocketSendMs.summary(), messageProcessingMs: diagnostics.messageProcessingMs.summary(),
      schemaDecodeMs: diagnostics.schemaDecodeMs.summary(), stateCallbackMs: diagnostics.stateCallbackMs.summary(), tcpChunkBytes: diagnostics.tcpChunkBytes.summary(),
      receivedFrameIntervalMs: diagnostics.receivedFrameIntervalMs.summary(), tcpChunkIntervalMs: diagnostics.tcpChunkIntervalMs.summary(),
      nodeSocketsObserved: diagnostics.nodeSocketsObserved.size, rawTcpReceiveChunks: diagnostics.rawTcpReceiveChunks, rawTcpReceivedBytes: diagnostics.rawTcpReceivedBytes,
      rawTcpBytesRead, rawTcpBytesWritten, maxTcpReadableBytes: diagnostics.nodeSocketsObserved.size ? diagnostics.maxTcpReadableBytes : null,
      maxTcpWritableBytes: diagnostics.nodeSocketsObserved.size ? diagnostics.maxTcpWritableBytes : null,
      maxReceiverBufferedBytes: diagnostics.nodeSocketsObserved.size ? diagnostics.maxReceiverBufferedBytes : null,
      maxReceiverWritableBytes: diagnostics.nodeSocketsObserved.size ? diagnostics.maxReceiverWritableBytes : null,
      definition: 'Synchronous SDK message handler, serializer decode and this load callback; ws private TCP/receiver queues sampled after send or receive, not kernel or proxy queues' },
    ackDefinition: 'Send to SDK state callback observing inputSeq advancement; cumulative sequence observation, not network RTT or proof that every input was applied',
    generator: { cpuPercent: (cpu.user + cpu.system) / (duration * 10), rssMiB: memory.rss / 1024 ** 2,
      eventLoopP99Ms: loop.percentile(99) / 1e6, eventLoopMaxMs: loop.max / 1e6 },
    errorCount: Object.values(errors).reduce((total, count) => total + count, 0), errors, closeReasons, errorReasons, transport: transportDescription });
}
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true; measuring = false;
  if (inputTimer) clearTimeout(inputTimer); if (heartbeatTimer) clearInterval(heartbeatTimer);
  await Promise.race([Promise.allSettled(members.map(member => member.room.leave())), delay(2000)]);
  for (const member of members) member.cleanup();
  process.exit(0);
}
let commands = Promise.resolve();
process.on('message', raw => {
  const command = raw as Command;
  if (command.kind === 'shutdown') { void shutdown(); return; }
  commands = commands.then(async () => {
    if (command.kind === 'connect') await connect(command);
    else if (command.kind === 'measure') await measure(command.seconds, command.stepsPerPacket, command.drainMs, command.inputMode);
  }).catch(() => { send({ kind: 'error', reason: 'Worker command failed' }); });
});
process.on('disconnect', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
