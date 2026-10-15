import type { MovementInput } from '../src/shared/movement';
import { MAX_MOVEMENT_BATCH, MAX_MOVEMENT_INPUT_MS, MAX_PENDING_MOVEMENT_INPUTS, MAX_QUEUED_MOVEMENT_MS } from '../src/shared/movementLimits';
import { MAX_MEASUREMENT_SECONDS } from './load-stand-limits';

export const OUTBOUND_BUFFER_LIMIT_BYTES = 256 * 1024;
export function validateMeasurementSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_MEASUREMENT_SECONDS) throw new RangeError('Invalid measurement duration');
  return seconds;
}

export class OutboundBufferGuard {
  blocked = false;
  peakBytes = 0;
  constructor(readonly limit = OUTBOUND_BUFFER_LIMIT_BYTES) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid outbound buffer limit');
  }
  check(socket: { bufferedAmount: number; terminate?: () => void; close?: () => void }, exceeded: (peak: number) => void) {
    const buffered = socket.bufferedAmount;
    this.peakBytes = Math.max(this.peakBytes, buffered);
    if (this.blocked) return false;
    if (buffered < this.limit) return true;
    this.blocked = true; exceeded(this.peakBytes);
    try { if (socket.terminate) socket.terminate(); else socket.close?.(); } catch {}
    return false;
  }
}

export const browserInputLimits = { pendingMovingSteps: MAX_PENDING_MOVEMENT_INPUTS - 1,
  inFlightSteps: MAX_PENDING_MOVEMENT_INPUTS - MAX_MOVEMENT_BATCH,
  inFlightMs: MAX_QUEUED_MOVEMENT_MS - MAX_MOVEMENT_INPUT_MS, batchSteps: MAX_MOVEMENT_BATCH };

export class BoundedSamples {
  private values: number[] = [];
  private seen = 0;
  private sum = 0;
  private maximum = 0;
  private seed = 0x6d2b79f5;
  constructor(readonly limit = 8192) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid sample limit');
  }
  add(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    this.seen++; this.sum += value; this.maximum = Math.max(this.maximum, value);
    if (this.values.length < this.limit) { this.values.push(value); return; }
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    const index = Math.floor((this.seed >>> 0) / 2 ** 32 * this.seen);
    if (index < this.limit) this.values[index] = value;
  }
  summary() {
    const values = [...this.values].sort((a, b) => a - b), round = (value: number) => Number(value.toFixed(3));
    const at = (p: number) => round(values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0);
    return { count: this.seen, sampleCount: values.length, sampling: this.seen > this.limit ? 'bounded-reservoir' : 'complete',
      p50: at(.5), p95: at(.95), p99: at(.99), max: round(this.maximum), mean: round(this.sum / Math.max(1, this.seen)) };
  }
}

// Matches MovementPrediction's queue rules, without rendering or collision work.
export class BrowserInputWindow {
  private pending: MovementInput[] = [];
  private outgoing: MovementInput[] = [];
  private sentThrough: number;
  constructor(private sequence = 0) { this.sentThrough = sequence; }
  offer(x: number, y: number, ms: number) {
    if (this.pending.length >= MAX_PENDING_MOVEMENT_INPUTS - (x || y ? 1 : 0)) return false;
    const input = { seq: ++this.sequence, x, y, ms: Math.min(MAX_MOVEMENT_INPUT_MS, Math.max(0, ms)), sprint: false };
    this.pending.push(input); this.outgoing.push(input); return true;
  }
  flush(send: (inputs: MovementInput[]) => void) {
    const inFlight = this.pending.filter(input => input.seq <= this.sentThrough);
    let count = inFlight.length, ms = inFlight.reduce((total, input) => total + input.ms, 0);
    while (this.outgoing.length) {
      const batch: MovementInput[] = [];
      for (const input of this.outgoing) {
        if (batch.length >= MAX_MOVEMENT_BATCH || count >= MAX_PENDING_MOVEMENT_INPUTS - MAX_MOVEMENT_BATCH
          || ms + input.ms > MAX_QUEUED_MOVEMENT_MS - MAX_MOVEMENT_INPUT_MS) break;
        batch.push(input); count++; ms += input.ms;
      }
      if (!batch.length) break;
      this.outgoing.splice(0, batch.length); this.sentThrough = batch[batch.length - 1].seq; send(batch);
    }
  }
  acknowledge(seq: number) { this.sequence = Math.max(this.sequence, seq); this.pending = this.pending.filter(input => input.seq > seq); }
  get pendingCount() { return this.pending.length; }
  get outgoingCount() { return this.outgoing.length; }
  get lastSequence() { return this.sequence; }
}

export class PacketTracker {
  private timestamps = new Map<number, number>();
  private sent = 0;
  private acknowledged = 0;
  private observedSteps = 0;
  private lastSequence: number;
  timingSamplesDropped = 0;
  maxTrackedPackets = 0;
  constructor(private baseline: number, private fixedSteps?: number, readonly limit = 512) {
    if (!Number.isSafeInteger(baseline) || baseline < 0 || !Number.isInteger(limit) || limit < 1
      || fixedSteps !== undefined && (!Number.isInteger(fixedSteps) || fixedSteps < 1)) throw new Error('Invalid packet tracker');
    this.lastSequence = baseline;
  }
  record(seq: number, now: number) {
    if (seq <= this.lastSequence || (this.fixedSteps && seq !== this.baseline + (this.sent + 1) * this.fixedSteps)) throw new Error('Non-contiguous packet sequence');
    if (!this.fixedSteps && this.timestamps.size >= this.limit) throw new Error('Browser window exceeded tracking limit');
    if (this.timestamps.size >= this.limit) { this.timestamps.delete(this.timestamps.keys().next().value!); this.timingSamplesDropped++; }
    this.timestamps.set(seq, now); this.sent++; this.lastSequence = seq;
    this.maxTrackedPackets = Math.max(this.maxTrackedPackets, this.timestamps.size);
  }
  acknowledge(seq: number, now: number, latency: (value: number) => void) {
    this.observedSteps = Math.max(this.observedSteps, Math.max(0, Math.min(this.lastSequence, seq) - this.baseline));
    for (const [packetSeq, at] of this.timestamps) {
      if (packetSeq > seq) break;
      latency(Math.max(0, now - at)); this.timestamps.delete(packetSeq);
      if (!this.fixedSteps) this.acknowledged++;
    }
    if (this.fixedSteps) this.acknowledged = Math.min(this.sent, Math.floor(this.observedSteps / this.fixedSteps));
  }
  get outstandingPackets() { return this.sent - this.acknowledged; }
  get acknowledgedPackets() { return this.acknowledged; }
  get acknowledgedSteps() { return this.observedSteps; }
  oldest(now: number) {
    const at = this.timestamps.values().next().value;
    return { ms: at === undefined ? 0 : Math.max(0, now - at), exact: this.outstandingPackets === this.timestamps.size };
  }
}

export class TimerPacer {
  ticks = 0;
  skippedTicks = 0;
  nextAt: number;
  constructor(started: number, readonly periodMs = 1000 / 30) { this.nextAt = started + periodMs; }
  tick(now: number) {
    const lateMs = Math.max(0, now - this.nextAt), skipped = Math.floor(lateMs / this.periodMs);
    this.ticks++; this.skippedTicks += skipped; this.nextAt += (skipped + 1) * this.periodMs;
    return { lateMs, skipped };
  }
}

export function instrumentMethod(target: object, key: string, enabled: () => boolean,
  measured: (durationMs: number, args: unknown[]) => void, now = () => performance.now()) {
  const object = target as Record<string, unknown>, original = object[key], descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (typeof original !== 'function') return () => {};
  const wrapper = function(this: unknown, ...args: unknown[]) {
    const active = enabled(), started = active ? now() : 0;
    try { return Reflect.apply(original, this, args); }
    finally { if (active) measured(Math.max(0, now() - started), args); }
  };
  object[key] = wrapper;
  return () => { if (object[key] === wrapper) { if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key]; } };
}

export function isLegacyInputFrame(data: unknown) {
  const view = data instanceof ArrayBuffer ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
  return !!view && view.length >= 8 && view[0] === 13 && view[1] === 0xa6
    && view[2] === 105 && view[3] === 110 && view[4] === 112 && view[5] === 117 && view[6] === 116 && view[7] === 115;
}
