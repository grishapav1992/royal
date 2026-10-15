import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NpcMotion } from '../src/network/NpcMotion';
import { NpcTimeline } from '../src/network/NpcTimeline';

const epoch = 1800000000000;

function replay(batchMs: number) {
  const timeline = new NpcTimeline();
  const motion = new NpcMotion<{ x: number; y: number; moving: boolean }>({ delayMs: 0, isMoving: view => view.moving });
  const packets = Array.from({ length: 901 }, (_, i) => {
    const source = i * 50;
    return { source, guestAt: Math.floor(source / 100) * 100, arrival: (batchMs ? Math.ceil(source / batchMs) * batchMs : source) + 12 + [0, 3, 1, 6, 2][Math.floor(source / Math.max(50, batchMs)) % 5] + (i % 5) * .01 };
  });
  const speeds: number[] = [];
  let next = 0, previous: { x: number; at: number; render: number } | undefined;
  for (let frame = 0; frame < 2700; frame++) {
    const now = frame * 1000 / 60;
    while (next < packets.length && packets[next].arrival <= now) {
      const packet = packets[next++];
      timeline.receive(epoch + packet.source, packet.arrival);
      motion.push({ x: packet.guestAt * .065, y: 200, moving: true }, epoch + packet.guestAt);
    }
    const render = timeline.renderTime(now);
    if (render === undefined) continue;
    const view = motion.sample(render)!;
    if (previous && now > 1500) {
      assert(render >= previous.render, 'server playhead must never rewind');
      speeds.push((view.x - previous.x) / (now - previous.at) * 1000);
    }
    previous = { x: view.x, at: now, render };
  }
  return { timeline, speeds };
}

test('authoritative 10 Hz motion stays smooth through duplicate 20 Hz room patches for 45 seconds', () => {
  const { timeline, speeds } = replay(0);
  assert(speeds.length > 2500);
  assert(Math.min(...speeds) > 60);
  assert(Math.max(...speeds) < 72);
  assert.equal(timeline.getState().delayMs, 350);
});

test('250 ms WebSocket packet bursts do not compress motion or starve its buffer', () => {
  const { timeline, speeds } = replay(250);
  assert(speeds.length > 2500);
  assert(Math.min(...speeds) > 58, 'a steady walking NPC must not stop between bursts');
  assert(Math.max(...speeds) < 72, 'batched updates must not become a position jump');
  assert(timeline.getState().delayMs >= 395 && timeline.getState().delayMs <= 420);
});

test('the first 250 ms burst after steady delivery cannot outrun a 99 ms old guest publication', () => {
  const timeline = new NpcTimeline();
  const motion = new NpcMotion<{ x: number; y: number }>({ delayMs: 0 });
  const packets = Array.from({ length: 241 }, (_, index) => {
    const source = index * 50;
    const guestAt = source ? Math.floor((source - 1) / 100) * 100 + 1 : 0;
    const arrival = (source <= 5000 ? source : Math.ceil(source / 250) * 250) + 12;
    return { source, guestAt, arrival };
  });
  let next = 0, previous: { x: number; at: number } | undefined;
  for (let frame = 0; frame < 720; frame++) {
    const now = frame * 1000 / 60;
    while (next < packets.length && packets[next].arrival <= now) {
      const packet = packets[next++];
      timeline.receive(epoch + packet.source, packet.arrival);
      motion.push({ x: packet.guestAt * .065, y: 0 }, epoch + packet.guestAt);
    }
    const renderAt = timeline.renderTime(now);
    if (renderAt === undefined) continue;
    const view = motion.sample(renderAt)!;
    if (previous && now > 1500) {
      const speed = (view.x - previous.x) / (now - previous.at) * 1000;
      assert(speed > 58 && speed < 72, `first-burst speed ${speed} at ${now}`);
    }
    previous = { x: view.x, at: now };
  }
});

test('a 588 ms delivery gap holds the guest endpoint and resumes without a late-history jump', () => {
  const packets = Array.from({ length: 61 }, (_, index) => {
    const source = index * 50;
    const guestAt = Math.max(0, Math.floor((source - 33) / 100) * 100 + 33);
    const arrival = source > 1000 && source < 1600 ? 1600 + index * .01 : source + 12;
    return { source, guestAt, arrival };
  });
  const variants = [false, true].map(capped => ({ capped, timeline: new NpcTimeline(), motion: new NpcMotion<{ x: number; y: number }>({ delayMs: 0 }), frames: [] as { at: number; x: number; renderAt: number }[] }));
  let next = 0, latestGuestAt = epoch;
  for (let frame = 0; frame < 180; frame++) {
    const now = frame * 1000 / 60;
    while (next < packets.length && packets[next].arrival <= now) {
      const packet = packets[next++]; latestGuestAt = epoch + packet.guestAt;
      for (const variant of variants) {
        variant.timeline.receive(epoch + packet.source, packet.arrival);
        variant.motion.push({ x: packet.guestAt * .065, y: 0 }, latestGuestAt);
      }
    }
    for (const variant of variants) {
      const renderAt = variant.timeline.renderTime(now, variant.capped ? latestGuestAt : undefined);
      if (renderAt === undefined) continue;
      variant.frames.push({ at: now, x: variant.motion.sample(renderAt)!.x, renderAt });
      if (variant.capped) assert(renderAt <= latestGuestAt, 'clock must not run beyond the last guest sample');
    }
  }
  const steps = (frames: typeof variants[number]['frames']) => frames.slice(1).map((frame, index) => ({ at: frame.at, distance: frame.x - frames[index].x }));
  const uncapped = steps(variants[0].frames), capped = steps(variants[1].frames);
  assert(Math.max(...uncapped.map(frame => frame.distance)) > 3, 'fixture must reproduce the released late-history jump');
  assert(Math.max(...capped.map(frame => frame.distance)) < 1.3, 'resumed packets must continue with a bounded frame step');
  assert(capped.filter(frame => frame.at > 1400 && frame.at < 1600 && Math.abs(frame.distance) < 1e-7).length >= 5, 'a long outage should hold the known endpoint');
});

test('foreground resync also respects the oldest available NPC sample endpoint', () => {
  const timeline = new NpcTimeline();
  timeline.receive(epoch, 0); timeline.renderTime(0, epoch);
  timeline.receive(epoch + 1000, 1000);
  assert.equal(timeline.renderTime(10000, epoch + 933), epoch + 933);
});

const recordedArrivals = new URL('../artifacts/npc-motion-20261015/live-arrivals.json', import.meta.url);
test('replays the observed 45 second production arrival trace on an authoritative motion timeline', { skip: !existsSync(recordedArrivals) }, () => {
  // Reuse the measured room clock and delivery times. Guest positions follow a
  // controlled 10 Hz trajectory because the recording predates guestsAt.
  const trace = JSON.parse(readFileSync(recordedArrivals, 'utf8')) as { durationMs: number; packets: { at: number; serverNow: number }[] };
  const timeline = new NpcTimeline();
  const motion = new NpcMotion<{ x: number; y: number }>({ delayMs: 0 });
  let next = 0, previous: { x: number; at: number } | undefined;
  const speeds: number[] = [];
  for (let frame = 0; frame * 1000 / 60 < trace.durationMs; frame++) {
    const now = frame * 1000 / 60;
    while (next < trace.packets.length && trace.packets[next].at <= now) {
      const packet = trace.packets[next], source = packet.serverNow - trace.packets[0].serverNow, guestAt = Math.floor(source / 100) * 100;
      timeline.receive(epoch + source, packet.at);
      motion.push({ x: guestAt * .065, y: 200 }, epoch + guestAt);
      next++;
    }
    const renderAt = timeline.renderTime(now);
    if (renderAt === undefined) continue;
    const view = motion.sample(renderAt)!;
    if (previous && now > 2000) speeds.push((view.x - previous.x) / (now - previous.at) * 1000);
    previous = { x: view.x, at: now };
  }
  assert(trace.packets.length > 800 && speeds.length > 2500);
  assert(Math.min(...speeds) > 58, 'measured delivery bursts must not freeze steady motion');
  assert(Math.max(...speeds) < 72, 'measured delivery bursts must not compress the source timeline');
});

test('offset changes and adaptive delay increases adjust speed without moving the clock backwards', () => {
  const timeline = new NpcTimeline();
  timeline.receive(epoch, 0);
  let previous = timeline.renderTime(0)!;
  for (let now = 10; now <= 2500; now += 10) {
    if (now % 50 === 0) timeline.receive(epoch + now + (now >= 1000 ? 80 : 0), now);
    const current = timeline.renderTime(now)!;
    assert(current >= previous);
    assert(current - previous <= 11.001, 'clock correction must not skip buffered history');
    previous = current;
  }
});

test('missing packets hold the last authoritative time and reconnect resets the old epoch', () => {
  let now = 0;
  const timeline = new NpcTimeline({ now: () => now });
  assert.equal(timeline.renderTime(), undefined);
  timeline.receive(epoch);
  for (now = 10; now <= 2000; now += 10) timeline.renderTime();
  assert.equal(timeline.renderTime(), epoch);
  timeline.receive(epoch - 1000, now);
  assert.equal(timeline.getState().latestServerAt, epoch);
  timeline.reset();
  assert.equal(timeline.renderTime(), undefined);
  timeline.receive(epoch - 5000);
  assert.equal(timeline.renderTime(), epoch - 5400);
});

test('a suspended tab resumes near the buffered present after old motion frames expire', () => {
  const timeline = new NpcTimeline();
  const motion = new NpcMotion<{ x: number; y: number }>({ delayMs: 0 });
  timeline.receive(epoch, 0); motion.push({ x: 0, y: 0 }, epoch);
  timeline.renderTime(0); motion.sample(epoch - 400);
  for (let now = 50; now <= 10000; now += 50) {
    timeline.receive(epoch + now, now);
    motion.push({ x: now * .065, y: 0 }, epoch + now);
  }
  const resumedAt = timeline.renderTime(10000)!;
  assert.equal(resumedAt, epoch + 9650);
  const resumed = motion.sample(resumedAt)!;
  assert(Math.abs(resumed.x - 627.25) < 1e-7, 'foreground rendering must use current buffered positions');
  const nextAt = timeline.renderTime(10000 + 1000 / 60)!;
  const next = motion.sample(nextAt)!;
  assert(next.x > resumed.x && next.x - resumed.x < 1.2, 'normal playback must continue immediately after resync');
});

test('a render pause and invalid samples cannot exceed the last authoritative timestamp', () => {
  const timeline = new NpcTimeline();
  timeline.receive(epoch, 0);
  const first = timeline.renderTime(0)!;
  timeline.receive(NaN, 1); timeline.receive(epoch + 20, NaN);
  assert.equal(timeline.getState().latestServerAt, epoch);
  assert.equal(timeline.renderTime(NaN), first);
  const resumed = timeline.renderTime(10000)!;
  assert.equal(resumed, epoch);
  assert.equal(timeline.renderTime(500), resumed);
});
