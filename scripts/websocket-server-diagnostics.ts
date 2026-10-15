import { unpack } from 'msgpackr';

type Method = (this: any, ...args: any[]) => any;
type InputQueue = { pending: { seq: number; ms: number }[]; pendingMs: number; received: number; sequence: number;
  accept: Method; advance: Method; cancel: Method };
type SocketRef = { bufferedAmount?: number; send?: Method; listenerCount?(event: string): number;
  once?(event: string, listener: (...args: any[]) => void): unknown; off?(event: string, listener: (...args: any[]) => void): unknown;
  _socket?: { readableLength?: number; writableLength?: number } };
export type DiagnosticClient = { state: number; sessionId: string; ref: SocketRef;
  _numMessagesLastSecond?: number; _messageCountResetsAt?: number };
export type DiagnosticRoom = { clock: { currentTime: number }; maxMessagesPerSecond: number; tick?: Method;
  onMessageEvents?: { emit: Method };
  controls?: { get(key: string): { inputs?: InputQueue } | undefined };
  state?: { players?: { get(key: string): { inputSeq?: number } | undefined } } };
export type RoomMessagePrototype = { _onMessage(this: DiagnosticRoom, client: DiagnosticClient, buffer: Buffer): unknown };

export type AgeSummary = { count: number; maxMs: number; p50UpperBoundMs: number; p95UpperBoundMs: number; p99UpperBoundMs: number };
type Totals = { incomingFrames: number; incomingBytes: number; inputFrames: number; decodedInputSequences: number;
  inputDecodeErrors: number; oversizedInputFrames: number; repeatedInputSequences: number; regressingInputSequences: number;
  sequenceGapEvents: number; sequenceGapSize: number; inputDispatchEvents: number; inputAcceptCalls: number; inputAcceptSuccesses: number;
  queueAcceptedSteps: number; queueAdvancedRemovals: number; queueCancelledRemovals: number;
  inputSeqAdvancements: number; receivedSequencesCoveredByInputSeq: number; outgoingSendCalls: number; outgoingBytes: number;
  outgoingSendThrows: number; limiterHits: number; arrivalTrackingEvictions: number; rollingWindowOverflows: number;
  untrackedClientFrames: number; inputQueueCoverageMisses: number; unacknowledgedSequencesAtClose: number; diagnosticErrors: number };
type Peaks = { maxRollingFramesPerClientSecond: number; maxRollingInputsPerClientSecond: number; maxClockWindowFrames: number;
  maxRoomClockLagMs: number; minRoomClockLagMs: number; maxQueuedStepsPerClient: number; maxQueuedMovementMsPerClient: number;
  maxQueueResidenceMs: number; maxWebSocketBufferedBytes: number; maxSocketReadableBytes: number; maxSocketWritableBytes: number };
export type PendingSnapshot = { clients: number; queuedSteps: number; queuedMovementMs: number; oldestQueueResidenceMs: number;
  webSocketBufferedBytes: number; socketReadableBytes: number; socketWritableBytes: number; socketsAboveBufferedLimit: number; receivedSequencesAwaitingInputSeq: number };
type ClosedSocketSample = { code: number; count: number; peakWebSocketBufferedBytes: number; peakSocketReadableBytes: number;
  peakSocketWritableBytes: number; maxQueuedStepsAtClose: number; unacknowledgedSequences: number };
export type TrafficWindow = Totals & Peaks & { startedAtMs: number; endedAtMs: number; intervalMs: number; pendingAtEnd: PendingSnapshot };
export type BurstExample = { protocol: number; input: boolean; rollingFrames: number; rollingInputs: number; clockWindowFrames: number;
  clockWindowRealMs: number; clockWindowClockMs: number; roomClockLagMs: number; messageListeners: number;
  queuedSteps: number; queuedMovementMs: number; webSocketBufferedBytes: number; socketReadableBytes: number; socketWritableBytes: number;
  // The timeline contains sequence numbers and relative server receive times, never identities or message bodies.
  timeline: { relativeMs: number; input: boolean; firstSequence: number | null; lastSequence: number | null; sequences: number }[] };
export type RoomTraffic = Totals & Peaks & { protocolCodes: Record<string, number>; closedSocketCodes: Record<string, number>; closedSocketSamples: ClosedSocketSample[];
  examples: BurstExample[]; windows: TrafficWindow[]; droppedWindows: number; sampledAtMs: number;
  windowHistory: 'latest-window' | 'bounded-tail'; retainedWindowCount: number;
  pending: PendingSnapshot; receiveToInputSeqAge: AgeSummary; advanceQueueResidence: AgeSummary; cancelQueueResidence: AgeSummary;
  limits: { trackedClients: number; rollingFramesPerClient: number; sequenceArrivalsPerClient: number; windows: number; examples: number;
    decodedFrameBytes: number; decodedSequencesPerFrame: number; queuedStepsPerClient: number; closedCodeBuckets: number; bufferedBytes: number };
  coverage: { activeTrackedClients: number; inputQueueClients: number; inputSeqClients: number; tickRooms: number; dispatchRooms: number; socketBufferSamples: number };
  definitions: Record<string, string> };

const totals = (): Totals => ({ incomingFrames: 0, incomingBytes: 0, inputFrames: 0, decodedInputSequences: 0,
  inputDecodeErrors: 0, oversizedInputFrames: 0, repeatedInputSequences: 0, regressingInputSequences: 0,
  sequenceGapEvents: 0, sequenceGapSize: 0, inputDispatchEvents: 0, inputAcceptCalls: 0, inputAcceptSuccesses: 0, queueAcceptedSteps: 0,
  queueAdvancedRemovals: 0, queueCancelledRemovals: 0, inputSeqAdvancements: 0, receivedSequencesCoveredByInputSeq: 0,
  outgoingSendCalls: 0, outgoingBytes: 0, outgoingSendThrows: 0, limiterHits: 0, arrivalTrackingEvictions: 0,
  rollingWindowOverflows: 0, untrackedClientFrames: 0, inputQueueCoverageMisses: 0, unacknowledgedSequencesAtClose: 0, diagnosticErrors: 0 });
const peaks = (): Peaks => ({ maxRollingFramesPerClientSecond: 0, maxRollingInputsPerClientSecond: 0, maxClockWindowFrames: 0,
  maxRoomClockLagMs: 0, minRoomClockLagMs: 0, maxQueuedStepsPerClient: 0, maxQueuedMovementMsPerClient: 0,
  maxQueueResidenceMs: 0, maxWebSocketBufferedBytes: 0, maxSocketReadableBytes: 0, maxSocketWritableBytes: 0 });
const pending = (): PendingSnapshot => ({ clients: 0, queuedSteps: 0, queuedMovementMs: 0, oldestQueueResidenceMs: 0,
  webSocketBufferedBytes: 0, socketReadableBytes: 0, socketWritableBytes: 0, socketsAboveBufferedLimit: 0, receivedSequencesAwaitingInputSeq: 0 });
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const sequence = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const definitions = {
  incomingFrames: 'Calls entering core Room._onMessage before its limiter and dispatch, excluding LEAVING clients. One call is one received WebSocket message, not a TCP segment.',
  inputFrames: 'Received ROOM_DATA messages with the exact inputs type header, including messages the core limiter subsequently rejects.',
  inputDispatchEvents: 'Actual inputs events emitted by the core ROOM_DATA router after its limiter and decode, before application guards or MovementInputs.accept.',
  sequenceGapSize: 'Gaps between consecutive decoded sequence values on one connection. Gaps do not prove lost frames or discarded movement.',
  queueAcceptedSteps: 'New sequence entries observed in the actual MovementInputs.pending array at advance/cancel entry. Initial pending work after reset is excluded.',
  queueAdvancedRemovals: 'Entries removed by advance, excluding entries removed through a nested cancel. This is not proof of physical displacement.',
  queueCancelledRemovals: 'Entries removed through cancel, including security or hall changes. Their inputSeq can still be acknowledged.',
  receiveToInputSeqAge: 'Local monotonic age from first received sequence to its coverage by observed player.inputSeq advancement. Cumulative acknowledgment is not RTT or proof every step was applied.',
  advanceQueueResidence: 'Local monotonic time from observed queue entry to removal by advance. No generator clock or network transit time is included.',
  outgoingBytes: 'Application bytes passed to WebSocket.send, counted once per send attempt. This excludes framing, TCP/TLS overhead and does not prove delivery.',
  maxWebSocketBufferedBytes: 'Sampled WebSocket.bufferedAmount after send, at input/tick boundaries and at window snapshots. It includes ws/TCP pending work and must not be added to writableLength.',
  maxSocketReadableBytes: 'Sampled Node TCP readableLength. Zero does not exclude data held by the kernel, proxy or network.',
  roomClockLag: 'Date.now minus room.clock.currentTime sampled at received messages. This uses only one server clock domain, not generator or proxy clocks.',
  closedSocketSamples: 'Bounded aggregates by numeric close code, using per-connection buffer peaks observed during this epoch. Peaks and close codes show correlation, not the reason for a close.',
  unacknowledgedSequencesAtClose: 'Received sequence entries still awaiting player.inputSeq coverage when their socket closes. This is a lower bound if arrivalTrackingEvictions is nonzero.',
  maxRollingFramesPerClientSecond: 'Received messages in a trailing 1000ms monotonic window per connection. It is a lower bound if rollingWindowOverflows is nonzero.',
  windows: 'Bounded nonoverlapping local server observation windows. Periodic latest-window snapshots send one window; final bounded-tail snapshots include up to limits.windows retained windows. All cumulative counters and age summaries cover the entire epoch. A reset never changes core limiter state or movement queues.',
  agePercentiles: 'Fixed logarithmic histogram upper bounds, within 10% above samples of at least 1ms until the largest bucket; submillisecond samples have a 1ms upper bound; maxMs is exact.',
};

/** Fixed-size histogram, so a delayed server never retains an unbounded list of latency samples. */
class Ages {
  private bins = new Uint32Array(128);
  private count = 0;
  private maximum = 0;
  add(value: number) {
    const age = Math.max(0, value);
    const index = age === 0 ? 0 : Math.min(127, 1 + Math.max(0, Math.ceil(Math.log(age) / Math.log(1.1))));
    this.bins[index]++; this.count++; this.maximum = Math.max(this.maximum, age);
  }
  summary(): AgeSummary {
    const quantile = (fraction: number) => {
      if (!this.count) return 0;
      const target = Math.ceil(this.count * fraction); let total = 0;
      for (let i = 0; i < this.bins.length; i++) {
        total += this.bins[i];
        if (total >= target) return i === 0 ? 0 : Math.min(this.maximum, i === 127 ? this.maximum : 1.1 ** (i - 1));
      }
      return this.maximum;
    };
    return { count: this.count, maxMs: this.maximum, p50UpperBoundMs: quantile(.5), p95UpperBoundMs: quantile(.95), p99UpperBoundMs: quantile(.99) };
  }
}

type ClientState = { client: DiagnosticClient; room: DiagnosticRoom; ref: SocketRef; times: Float64Array; first: Float64Array;
  last: Float64Array; steps: Uint8Array; inputs: Uint8Array; head: number; count: number; inputCount: number;
  resetPerf: number; resetClock: number; lastSequence?: number; lastAck?: number; arrivals: Map<number, number>; seen: Set<number>;
  queue?: InputQueue; queued: Map<number, { enteredAt: number }>; advanceDepth: number; restoreQueue?: () => void; restoreSend?: () => void;
  peakBuffers: { ws: number; readable: number; writable: number };
  close: (code?: number) => void };
type RoomHook = { clients: Set<ClientState>; tickHooked: boolean; dispatchHooked: boolean; restore: () => void };

export type DiagnosticsOptions = { leavingState: number; now?: () => number; wallNow?: () => number;
  maxClients?: number; maxWindows?: number; maxExamples?: number; bufferedBytes?: number };

/** Opt-in test wrapper hooks. Original arguments, callbacks, return values and exceptions are preserved. */
export function installServerDiagnostics(prototype: RoomMessagePrototype, options: DiagnosticsOptions) {
  const now = options.now ?? (() => performance.now()), wallNow = options.wallNow ?? Date.now;
  const limits = { trackedClients: options.maxClients ?? 330, rollingFramesPerClient: 256, sequenceArrivalsPerClient: 256,
    windows: options.maxWindows ?? 300, examples: options.maxExamples ?? 8, decodedFrameBytes: 16384,
    decodedSequencesPerFrame: 20, queuedStepsPerClient: 240, closedCodeBuckets: 16, bufferedBytes: options.bufferedBytes ?? 256 * 1024 };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid diagnostic bound');
  const clients = new Map<DiagnosticClient, ClientState>(), rooms = new Map<DiagnosticRoom, RoomHook>();
  let cumulative = totals(), allPeaks = peaks(), windowTotals = totals(), windowPeaks = peaks();
  let protocolCodes: Record<string, number> = {}, closedSocketCodes: Record<string, number> = {};
  let closedSamples = new Map<number, ClosedSocketSample>();
  let examples: BurstExample[] = [], windows: TrafficWindow[] = [], droppedWindows = 0, socketBufferSamples = 0;
  let receiveAges = new Ages(), advanceAges = new Ages(), cancelAges = new Ages(), started = now(), windowStarted = started, closed = false;
  const increment = (key: keyof Totals, amount = 1) => { cumulative[key] += amount; windowTotals[key] += amount; };
  const maximum = (key: keyof Peaks, value: number) => { allPeaks[key] = Math.max(allPeaks[key], value); windowPeaks[key] = Math.max(windowPeaks[key], value); };
  const safe = (callback: () => void) => { try { callback(); } catch { increment('diagnosticErrors'); } };
  const queueOf = (state: ClientState) => {
    const candidate = state.room.controls?.get(state.client.sessionId)?.inputs;
    return candidate && Array.isArray(candidate.pending) && typeof candidate.accept === 'function'
      && typeof candidate.advance === 'function' && typeof candidate.cancel === 'function' ? candidate : undefined;
  };
  function syncQueue(state: ClientState, at: number, initial = false) {
    const queue = state.queue; if (!queue) return;
    const values = queue.pending;
    for (let i = 0; i < Math.min(values.length, limits.queuedStepsPerClient); i++) {
      const seq = values[i]?.seq;
      if (!sequence(seq) || state.queued.has(seq)) continue;
      if (state.queued.size >= limits.queuedStepsPerClient) { increment('inputQueueCoverageMisses'); continue; }
      state.queued.set(seq, { enteredAt: at });
      if (!initial) { increment('queueAcceptedSteps'); if (!state.arrivals.has(seq)) increment('inputQueueCoverageMisses'); }
    }
    maximum('maxQueuedStepsPerClient', values.length);
    maximum('maxQueuedMovementMsPerClient', numeric(queue.pendingMs));
    for (const entry of state.queued.values()) maximum('maxQueueResidenceMs', at - entry.enteredAt);
  }
  function removed(state: ClientState, at: number, cancelled: boolean) {
    const remaining = new Set(state.queue?.pending.slice(0, limits.queuedStepsPerClient).map(value => value.seq));
    for (const [seq, entry] of state.queued) {
      if (remaining.has(seq)) continue;
      increment(cancelled ? 'queueCancelledRemovals' : 'queueAdvancedRemovals');
      (cancelled ? cancelAges : advanceAges).add(at - entry.enteredAt);
      state.queued.delete(seq);
    }
  }
  function observeAck(state: ClientState, at: number) {
    const ack = state.room.state?.players?.get(state.client.sessionId)?.inputSeq;
    if (!sequence(ack)) return;
    if (state.lastAck !== undefined && ack > state.lastAck) {
      increment('inputSeqAdvancements');
      for (const [seq, arrived] of state.arrivals) if (seq <= ack) {
        receiveAges.add(at - arrived); increment('receivedSequencesCoveredByInputSeq'); state.arrivals.delete(seq);
      }
    }
    state.lastAck = ack;
  }
  function socketSample(state: ClientState) {
    socketBufferSamples++;
    const ws = numeric(state.ref.bufferedAmount), readable = numeric(state.ref._socket?.readableLength), writable = numeric(state.ref._socket?.writableLength);
    state.peakBuffers.ws = Math.max(state.peakBuffers.ws, ws); state.peakBuffers.readable = Math.max(state.peakBuffers.readable, readable);
    state.peakBuffers.writable = Math.max(state.peakBuffers.writable, writable);
    maximum('maxWebSocketBufferedBytes', ws); maximum('maxSocketReadableBytes', readable); maximum('maxSocketWritableBytes', writable);
    return { ws, readable, writable };
  }
  function ensureQueue(state: ClientState, at: number) {
    const queue = queueOf(state); if (queue === state.queue) return;
    state.restoreQueue?.(); state.queued.clear(); state.queue = queue;
    if (!queue) return;
    const originals = { accept: queue.accept, advance: queue.advance, cancel: queue.cancel };
    const accept: Method = function (...args) {
      increment('inputAcceptCalls'); const result = originals.accept.apply(this, args);
      if (result === true) increment('inputAcceptSuccesses');
      return result;
    };
    const advance: Method = function (...args) {
      safe(() => syncQueue(state, now()));
      state.advanceDepth++;
      try { return originals.advance.apply(this, args); }
      finally { safe(() => { removed(state, now(), false); socketSample(state); }); state.advanceDepth--; }
    };
    const cancel: Method = function (...args) {
      safe(() => {
        // advance shifts its current step before a contact/security callback can cancel the remaining queue.
        if (state.advanceDepth) removed(state, now(), false);
        syncQueue(state, now());
      });
      try { return originals.cancel.apply(this, args); }
      finally { safe(() => removed(state, now(), true)); }
    };
    queue.accept = accept; queue.advance = advance; queue.cancel = cancel;
    state.restoreQueue = () => {
      if (queue.accept === accept) queue.accept = originals.accept;
      if (queue.advance === advance) queue.advance = originals.advance;
      if (queue.cancel === cancel) queue.cancel = originals.cancel;
    };
    syncQueue(state, at, true);
  }
  function removeClient(state: ClientState) {
    state.restoreQueue?.(); state.restoreSend?.(); state.ref.off?.('close', state.close);
    clients.delete(state.client);
    const hook = rooms.get(state.room); hook?.clients.delete(state);
    if (hook && !hook.clients.size) { hook.restore(); rooms.delete(state.room); }
  }
  function track(client: DiagnosticClient, room: DiagnosticRoom, at: number): ClientState | undefined {
    let state = clients.get(client);
    if (state && state.ref !== client.ref) { removeClient(state); state = undefined; }
    if (state) { ensureQueue(state, at); return state; }
    if (clients.size >= limits.trackedClients) { increment('untrackedClientFrames'); return; }
    state = { client, room, ref: client.ref, times: new Float64Array(limits.rollingFramesPerClient),
      first: new Float64Array(limits.rollingFramesPerClient).fill(-1), last: new Float64Array(limits.rollingFramesPerClient).fill(-1),
      steps: new Uint8Array(limits.rollingFramesPerClient), inputs: new Uint8Array(limits.rollingFramesPerClient),
      head: 0, count: 0, inputCount: 0, resetPerf: at, resetClock: room.clock.currentTime, arrivals: new Map(), seen: new Set(), queued: new Map(), advanceDepth: 0,
      peakBuffers: { ws: 0, readable: 0, writable: 0 }, close: () => {} };
    clients.set(client, state);
    const tracked = state;
    tracked.close = code => {
      safe(() => {
        const value = Number.isSafeInteger(code) && code! >= 0 && code! <= 65535 ? code! : 0;
        // Reserve the final bucket for unknown or excess codes, keeping malicious fixtures bounded too.
        const key = closedSamples.has(value) || closedSamples.size < limits.closedCodeBuckets - 1 ? value : 0;
        const sample = closedSamples.get(key) ?? { code: key, count: 0, peakWebSocketBufferedBytes: 0,
          peakSocketReadableBytes: 0, peakSocketWritableBytes: 0, maxQueuedStepsAtClose: 0, unacknowledgedSequences: 0 };
        socketSample(tracked); observeAck(tracked, now());
        sample.count++; sample.peakWebSocketBufferedBytes = Math.max(sample.peakWebSocketBufferedBytes, tracked.peakBuffers.ws);
        sample.peakSocketReadableBytes = Math.max(sample.peakSocketReadableBytes, tracked.peakBuffers.readable);
        sample.peakSocketWritableBytes = Math.max(sample.peakSocketWritableBytes, tracked.peakBuffers.writable);
        sample.maxQueuedStepsAtClose = Math.max(sample.maxQueuedStepsAtClose, tracked.queue?.pending.length ?? 0);
        sample.unacknowledgedSequences += tracked.arrivals.size; increment('unacknowledgedSequencesAtClose', tracked.arrivals.size);
        closedSamples.set(key, sample); closedSocketCodes[key] = sample.count;
      });
      removeClient(tracked);
    };
    client.ref.once?.('close', tracked.close);
    if (typeof client.ref.send === 'function') {
      const original = client.ref.send;
      const send: Method = function (data, ...args) {
        safe(() => { increment('outgoingSendCalls'); increment('outgoingBytes', typeof data === 'string' ? Buffer.byteLength(data) : numeric(data?.byteLength)); });
        try { return original.call(this, data, ...args); }
        catch (error) { increment('outgoingSendThrows'); throw error; }
        finally { safe(() => socketSample(tracked)); }
      };
      client.ref.send = send; tracked.restoreSend = () => { if (tracked.ref.send === send) tracked.ref.send = original; };
    }
    let hook = rooms.get(room);
    if (!hook) {
      const members = new Set<ClientState>(), original = room.tick;
      const events = room.onMessageEvents, originalEmit = events?.emit;
      const emit: Method = function (event, ...args) {
        if (event === 'inputs') increment('inputDispatchEvents');
        return originalEmit!.call(this, event, ...args);
      };
      const tick: Method = function (...args) {
        try { return original!.apply(this, args); }
        finally { const timestamp = now(); for (const member of members) safe(() => { ensureQueue(member, timestamp); syncQueue(member, timestamp); observeAck(member, timestamp); socketSample(member); }); }
      };
      if (typeof original === 'function') room.tick = tick;
      if (events && typeof originalEmit === 'function') events.emit = emit;
      hook = { clients: members, tickHooked: typeof original === 'function', dispatchHooked: typeof originalEmit === 'function', restore: () => {
        if (room.tick === tick) room.tick = original;
        if (events?.emit === emit) events.emit = originalEmit!;
      } }; rooms.set(room, hook);
    }
    hook.clients.add(tracked); ensureQueue(tracked, at); observeAck(tracked, at);
    return tracked;
  }
  function sequences(buffer: Buffer): number[] {
    if (buffer.length > limits.decodedFrameBytes) { increment('oversizedInputFrames'); return []; }
    try {
      const packet: unknown = unpack(buffer.subarray(8));
      const values = packet && typeof packet === 'object' ? (packet as { inputs?: unknown }).inputs : undefined;
      if (!Array.isArray(values) || values.length > limits.decodedSequencesPerFrame) { increment('inputDecodeErrors'); return []; }
      return values.map(value => value && typeof value === 'object' ? value.seq : undefined).filter(sequence);
    } catch { increment('inputDecodeErrors'); return []; }
  }
  function receive(room: DiagnosticRoom, client: DiagnosticClient, buffer: Buffer) {
    const at = now(), clock = room.clock.currentTime, lag = wallNow() - clock, protocol = buffer[0] & 31;
    const input = protocol === 13 && buffer[1] === 0xa6 && buffer[2] === 105 && buffer[3] === 110
      && buffer[4] === 112 && buffer[5] === 117 && buffer[6] === 116 && buffer[7] === 115;
    increment('incomingFrames'); increment('incomingBytes', buffer.length); if (input) increment('inputFrames');
    protocolCodes[protocol] = (protocolCodes[protocol] ?? 0) + 1;
    allPeaks.maxRoomClockLagMs = cumulative.incomingFrames === 1 ? lag : Math.max(allPeaks.maxRoomClockLagMs, lag);
    allPeaks.minRoomClockLagMs = cumulative.incomingFrames === 1 ? lag : Math.min(allPeaks.minRoomClockLagMs, lag);
    windowPeaks.maxRoomClockLagMs = windowTotals.incomingFrames === 1 ? lag : Math.max(windowPeaks.maxRoomClockLagMs, lag);
    windowPeaks.minRoomClockLagMs = windowTotals.incomingFrames === 1 ? lag : Math.min(windowPeaks.minRoomClockLagMs, lag);
    const state = track(client, room, at); if (!state) return;
    const seqs = input ? sequences(buffer) : [];
    increment('decodedInputSequences', seqs.length);
    for (const seq of seqs) {
      if (state.lastSequence !== undefined) {
        if (state.seen.has(seq)) increment('repeatedInputSequences');
        else if (seq < state.lastSequence) increment('regressingInputSequences');
        else if (seq > state.lastSequence + 1) { increment('sequenceGapEvents'); increment('sequenceGapSize', seq - state.lastSequence - 1); }
      }
      state.lastSequence = Math.max(state.lastSequence ?? seq, seq);
      if (!state.seen.has(seq)) {
        if (state.seen.size >= limits.sequenceArrivalsPerClient) state.seen.delete(state.seen.values().next().value!);
        state.seen.add(seq);
      }
      if (!state.arrivals.has(seq) && (state.lastAck === undefined || seq > state.lastAck)) {
        if (state.arrivals.size >= limits.sequenceArrivalsPerClient) { state.arrivals.delete(state.arrivals.keys().next().value!); increment('arrivalTrackingEvictions'); }
        state.arrivals.set(seq, at);
      }
    }
    while (state.count && at - state.times[state.head] >= 1000) {
      state.inputCount -= state.inputs[state.head]; state.head = (state.head + 1) % limits.rollingFramesPerClient; state.count--;
    }
    if (state.count === limits.rollingFramesPerClient) {
      state.inputCount -= state.inputs[state.head]; state.head = (state.head + 1) % limits.rollingFramesPerClient; state.count--; increment('rollingWindowOverflows');
    }
    const index = (state.head + state.count) % limits.rollingFramesPerClient;
    state.times[index] = at; state.first[index] = seqs[0] ?? -1; state.last[index] = seqs.at(-1) ?? -1;
    state.steps[index] = seqs.length; state.inputs[index] = Number(input); state.count++; state.inputCount += Number(input);
    const resets = clock >= (client._messageCountResetsAt ?? 0);
    if (resets) { state.resetPerf = at; state.resetClock = clock; }
    const clockWindowFrames = resets ? 1 : (client._numMessagesLastSecond ?? 0) + 2;
    maximum('maxRollingFramesPerClientSecond', state.count); maximum('maxRollingInputsPerClientSecond', state.inputCount); maximum('maxClockWindowFrames', clockWindowFrames);
    const buffers = socketSample(state); syncQueue(state, at);
    if (!resets && (client._numMessagesLastSecond ?? 0) + 1 > room.maxMessagesPerSecond) {
      increment('limiterHits');
      if (examples.length < limits.examples) {
        const timeline: BurstExample['timeline'] = [];
        for (let i = Math.max(0, state.count - 12); i < state.count; i++) {
          const slot = (state.head + i) % limits.rollingFramesPerClient;
          timeline.push({ relativeMs: state.times[slot] - at, input: Boolean(state.inputs[slot]),
            firstSequence: state.first[slot] < 0 ? null : state.first[slot], lastSequence: state.last[slot] < 0 ? null : state.last[slot], sequences: state.steps[slot] });
        }
        examples.push({ protocol, input, rollingFrames: state.count, rollingInputs: state.inputCount, clockWindowFrames,
          clockWindowRealMs: at - state.resetPerf, clockWindowClockMs: clock - state.resetClock, roomClockLagMs: lag,
          messageListeners: numeric(client.ref.listenerCount?.('message')), queuedSteps: state.queue?.pending.length ?? 0,
          queuedMovementMs: numeric(state.queue?.pendingMs), webSocketBufferedBytes: buffers.ws, socketReadableBytes: buffers.readable,
          socketWritableBytes: buffers.writable, timeline });
      }
    }
  }
  const originalMessage = prototype._onMessage;
  const message: RoomMessagePrototype['_onMessage'] = function (client, buffer) {
    if (!closed && buffer && client.state !== options.leavingState) safe(() => receive(this, client, buffer));
    try { return originalMessage.call(this, client, buffer); }
    finally { const state = clients.get(client); if (state) safe(() => { observeAck(state, now()); socketSample(state); }); }
  };
  prototype._onMessage = message;
  function currentPending(at: number) {
    const sample = pending(); sample.clients = clients.size;
    for (const state of clients.values()) safe(() => {
      ensureQueue(state, at); syncQueue(state, at); observeAck(state, at);
      sample.queuedSteps += state.queue?.pending.length ?? 0; sample.queuedMovementMs += numeric(state.queue?.pendingMs);
      sample.receivedSequencesAwaitingInputSeq += state.arrivals.size;
      for (const entry of state.queued.values()) sample.oldestQueueResidenceMs = Math.max(sample.oldestQueueResidenceMs, at - entry.enteredAt);
      const buffers = socketSample(state); sample.webSocketBufferedBytes += buffers.ws; sample.socketReadableBytes += buffers.readable;
      sample.socketWritableBytes += buffers.writable; sample.socketsAboveBufferedLimit += Number(buffers.ws > limits.bufferedBytes);
    });
    return sample;
  }
  return {
    snapshot(sealWindow = false, options: { compact?: boolean } = {}): RoomTraffic {
      const at = now(), sample = currentPending(at);
      if (sealWindow && at > windowStarted) {
        if (windows.length === limits.windows) { windows.shift(); droppedWindows++; }
        windows.push({ ...windowTotals, ...windowPeaks, startedAtMs: windowStarted - started, endedAtMs: at - started,
          intervalMs: at - windowStarted, pendingAtEnd: sample });
        windowStarted = at; windowTotals = totals(); windowPeaks = peaks();
      }
      return { ...cumulative, ...allPeaks, protocolCodes: { ...protocolCodes }, closedSocketCodes: { ...closedSocketCodes }, closedSocketSamples: [...closedSamples.values()].map(sample => ({ ...sample })),
        examples: examples.map(example => ({ ...example, timeline: example.timeline.map(frame => ({ ...frame })) })),
        windows: (options.compact ? windows.slice(-1) : windows).map(window => ({ ...window, pendingAtEnd: { ...window.pendingAtEnd } })),
        droppedWindows, sampledAtMs: at - started, windowHistory: options.compact ? 'latest-window' : 'bounded-tail', retainedWindowCount: windows.length,
        pending: sample, receiveToInputSeqAge: receiveAges.summary(), advanceQueueResidence: advanceAges.summary(), cancelQueueResidence: cancelAges.summary(),
        limits: { ...limits }, coverage: { activeTrackedClients: clients.size, inputQueueClients: [...clients.values()].filter(state => state.queue).length,
          inputSeqClients: [...clients.values()].filter(state => state.lastAck !== undefined).length,
          tickRooms: [...rooms.values()].filter(hook => hook.tickHooked).length,
          dispatchRooms: [...rooms.values()].filter(hook => hook.dispatchHooked).length, socketBufferSamples }, definitions: { ...definitions } };
    },
    reset() {
      const at = now(); cumulative = totals(); allPeaks = peaks(); windowTotals = totals(); windowPeaks = peaks();
      protocolCodes = {}; closedSocketCodes = {}; closedSamples = new Map(); examples = []; windows = []; droppedWindows = 0; socketBufferSamples = 0;
      receiveAges = new Ages(); advanceAges = new Ages(); cancelAges = new Ages(); started = at; windowStarted = at;
      for (const state of clients.values()) safe(() => {
        state.head = 0; state.count = 0; state.inputCount = 0; state.arrivals.clear(); state.seen.clear(); state.lastSequence = undefined;
        state.lastAck = state.room.state?.players?.get(state.client.sessionId)?.inputSeq;
        state.peakBuffers = { ws: 0, readable: 0, writable: 0 };
        state.queued.clear(); ensureQueue(state, at); syncQueue(state, at, true);
      });
    },
    close() {
      if (closed) return; closed = true;
      if (prototype._onMessage === message) prototype._onMessage = originalMessage;
      for (const state of [...clients.values()]) removeClient(state);
    },
  };
}
