import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MovementPrediction } from '../src/network/MovementPrediction';
import type { MovementBody, MovementInput } from '../src/shared/movement';
import { BoundedSamples, BrowserInputWindow, PacketTracker, TimerPacer, browserInputLimits, instrumentMethod, isLegacyInputFrame,
  validateMeasurementSeconds, OutboundBufferGuard } from '../scripts/load-websocket-diagnostics';
import { MAX_MEASUREMENT_SECONDS } from '../scripts/load-stand-limits';

test('browser send window agrees with real prediction through stalled ACKs, queue exhaustion and recovery', () => {
  for (const ms of [1000 / 60, 1000 / 90, 50, 0]) {
    const prediction = new MovementPrediction(), window = new BrowserInputWindow();
    const body: MovementBody = { hall: 'arcade', x: 540, y: 700, moving: false, facing: 'down', seat: '', action: 'idle', drink: '', actionUntil: 0, soberAt: 0 };
    const actual: MovementInput[][] = [], expected: MovementInput[][] = [];
    for (let frame = 0; frame < 600; frame++) {
      if (frame === 350 || frame === 500) {
        const seq = expected.flat().at(-1)?.seq ?? 0;
        window.acknowledge(seq); prediction.reconcile(body, seq);
      }
      const x = frame === 299 ? 0 : frame % 200 < 100 ? -1 : 1;
      prediction.step(body, x, 0, ms); window.offer(x, 0, ms);
      if (frame % 2 === 1 || frame === 299) { prediction.flush(batch => expected.push(batch)); window.flush(batch => actual.push(batch)); }
      assert.equal(window.pendingCount, prediction.pendingCount);
      assert.ok(window.pendingCount <= browserInputLimits.pendingMovingSteps + 1);
      assert.deepEqual(actual, expected);
    }
    assert.ok(actual.flat().length > 0);
  }
});

test('stress tracking remains bounded for the full measurement duration while residual and cumulative ACK counts stay exact', () => {
  const tracker = new PacketTracker(100, 2, 32), timings: number[] = [];
  const packets = MAX_MEASUREMENT_SECONDS * 30, finalAt = MAX_MEASUREMENT_SECONDS * 1000;
  for (let packet = 1; packet <= packets; packet++) tracker.record(100 + packet * 2, packet * 1000 / 30);
  assert.equal(tracker.maxTrackedPackets, 32);
  assert.equal(tracker.timingSamplesDropped, packets - 32);
  assert.equal(tracker.outstandingPackets, packets);
  tracker.acknowledge(100 + packets + 1, finalAt, value => timings.push(value));
  assert.equal(tracker.outstandingPackets, packets / 2);
  assert.equal(tracker.acknowledgedSteps, packets + 1);
  assert.equal(tracker.oldest(finalAt).exact, false);
  tracker.acknowledge(100 + packets * 2, finalAt + 200, value => timings.push(value));
  assert.equal(tracker.outstandingPackets, 0); assert.equal(tracker.acknowledgedPackets, packets);
  assert.equal(timings.length, 32); assert.equal(tracker.oldest(finalAt + 200).exact, true);
  assert.throws(() => tracker.record(100 + packets * 2 + 3, finalAt + 300), /Non-contiguous/);
});

test('duration validation accepts the shared thirty-minute limit and preserves fractional worker smoke durations', () => {
  assert.equal(validateMeasurementSeconds(MAX_MEASUREMENT_SECONDS), 1800);
  assert.equal(validateMeasurementSeconds(.25), .25);
  for (const seconds of [0, -1, NaN, Infinity, MAX_MEASUREMENT_SECONDS + .001]) assert.throws(() => validateMeasurementSeconds(seconds));
});

test('a blackholed owned socket stops sending at the buffer cap even if termination leaves it open', () => {
  const guard = new OutboundBufferGuard(16); let sends = 0, closed = 0, errors = 0;
  const socket = { bufferedAmount: 0, isOpen: true, terminate() { closed++; } };
  const exceeded = () => { errors++; };
  for (let opportunity = 0; opportunity < 100; opportunity++) {
    if (!guard.check(socket, exceeded)) continue;
    sends++; socket.bufferedAmount += 4; guard.check(socket, exceeded);
  }
  assert.equal(sends, 4); assert.equal(socket.bufferedAmount, 16); assert.equal(socket.isOpen, true);
  assert.equal(guard.blocked, true); assert.equal(guard.peakBytes, 16); assert.equal(closed, 1); assert.equal(errors, 1);
});

test('buffer guard preserves a draining socket and closes a native socket once before an over-cap send', () => {
  const normal = new OutboundBufferGuard(16); let calls = 0, closed = 0;
  const socket = { bufferedAmount: 0, close() { closed++; } };
  for (let opportunity = 0; opportunity < 100; opportunity++) {
    assert.equal(normal.check(socket, () => assert.fail('Unexpected buffer overflow')), true);
    calls++; socket.bufferedAmount = 4; assert.equal(normal.check(socket, () => assert.fail('Unexpected buffer overflow')), true);
    socket.bufferedAmount = 0;
  }
  assert.equal(calls, 100); assert.equal(closed, 0); assert.equal(normal.blocked, false);
  const blocked = new OutboundBufferGuard(16); socket.bufferedAmount = 32;
  assert.equal(blocked.check(socket, () => {}), false); assert.equal(blocked.check(socket, () => assert.fail('Duplicate overflow')), false);
  assert.equal(closed, 1); assert.equal(blocked.peakBytes, 32);
});

test('variable browser batches count final sequence ACKs without treating a partial batch as acknowledged', () => {
  const tracker = new PacketTracker(40, undefined, 4), values: number[] = [];
  tracker.record(42, 10); tracker.record(62, 20); tracker.record(65, 30);
  tracker.acknowledge(61, 50, value => values.push(value));
  assert.equal(tracker.outstandingPackets, 2); assert.equal(tracker.acknowledgedSteps, 21); assert.deepEqual(values, [40]);
  tracker.acknowledge(65, 60, value => values.push(value));
  assert.equal(tracker.outstandingPackets, 0); assert.deepEqual(values, [40, 40, 30]);
});

test('bounded quantiles retain total count and exact maximum instead of growing with duration', () => {
  const samples = new BoundedSamples(64);
  for (let value = 0; value < 20000; value++) samples.add(value);
  samples.add(NaN); samples.add(-1); samples.add(Infinity);
  const summary = samples.summary();
  assert.equal(summary.count, 20000); assert.equal(summary.sampleCount, 64); assert.equal(summary.max, 19999);
  assert.equal(summary.mean, 9999.5); assert.equal(summary.sampling, 'bounded-reservoir');
  assert.ok(summary.p50 <= summary.p95 && summary.p95 <= summary.p99 && summary.p99 <= summary.max);
  assert.deepEqual(samples.summary(), summary);
});

test('timer pacing records missed opportunities without emitting a catch-up burst', () => {
  const pacer = new TimerPacer(0, 100);
  assert.deepEqual(pacer.tick(101), { lateMs: 1, skipped: 0 });
  assert.deepEqual(pacer.tick(551), { lateMs: 351, skipped: 3 });
  assert.equal(pacer.ticks, 2); assert.equal(pacer.skippedTicks, 3); assert.equal(pacer.nextAt, 600);
  assert.deepEqual(pacer.tick(600), { lateMs: 0, skipped: 0 });
});

test('diagnostic wrappers preserve receiver, return values and errors and detach idempotently', () => {
  let now = 0, active = false; const observed: number[] = [];
  const prototype = { scale: 3, run(value: number) { now += 4; if (value < 0) throw new Error('original'); return this.scale * value; } };
  const target = Object.create(prototype) as typeof prototype;
  const detach = instrumentMethod(target, 'run', () => active, duration => observed.push(duration), () => now);
  assert.equal(target.run(2), 6); assert.deepEqual(observed, []);
  active = true; assert.equal(target.run(4), 12); assert.throws(() => target.run(-1), /original/); assert.deepEqual(observed, [4, 4]);
  detach(); detach(); assert.equal(Object.hasOwn(target, 'run'), false); assert.equal(target.run, prototype.run);
  target.run(1); assert.deepEqual(observed, [4, 4]);
});

test('input frame diagnostic distinguishes legacy inputs from other SDK ROOM_DATA messages', () => {
  const inputs = Buffer.from([13, 0xa6, ...Buffer.from('inputs'), 0x81]);
  assert.equal(isLegacyInputFrame(inputs), true); assert.equal(isLegacyInputFrame(inputs.buffer.slice(inputs.byteOffset, inputs.byteOffset + inputs.byteLength)), true);
  assert.equal(isLegacyInputFrame(Buffer.from([13, 0xa7, ...Buffer.from('history')])), false);
  assert.equal(isLegacyInputFrame(Buffer.from([10])), false); assert.equal(isLegacyInputFrame('inputs'), false);
});
