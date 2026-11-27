import test from 'node:test';
import assert from 'node:assert/strict';
import { FlagRollPhysics, planFlagRoll, resolveRollPair, rollAngleDistance, ROLL_STEP, type RollBody } from '../games/flag-battle/FlagRollPhysics';
import { flagBattleTimeline } from '../games/flag-battle/FlagBattleCues';
import { flagCountries, FLAG_MODES } from '../src/shared/flagBattle';

const R = .085;
const body = (id: number, x: number, y: number, vx: number, vy: number, spin = 0): RollBody => ({ id, x, y, vx, vy, angle: 0, spin, previousX: x, previousY: y, previousAngle: 0, escapedAt: null });
const near = (a: number, b: number, eps = 1e-9) => assert(Math.abs(a - b) < eps, `${a} differs from ${b}`);

test('contacts conserve linear momentum, never add energy and transfer spin through friction', () => {
  for (const [x, y] of [[.16, 0], [.12, .09], [0, .16]]) {
    const a = body(0, 0, 0, .7, .4, 3), b = body(1, x, y, -.5, -.2, -1);
    const px = a.vx + b.vx, py = a.vy + b.vy;
    const energy = (u: RollBody, v: RollBody) => u.vx ** 2 + u.vy ** 2 + v.vx ** 2 + v.vy ** 2 + R * R * (u.spin ** 2 + v.spin ** 2) / 2;
    const before = energy(a, b);
    resolveRollPair(a, b, R);
    near(a.vx + b.vx, px); near(a.vy + b.vy, py);
    assert(energy(a, b) <= before + 1e-9, 'Contact added kinetic energy');
    assert(Math.hypot(a.x - b.x, a.y - b.y) >= R * 2);
  }
  const c = body(2, 0, 0, .4, 1), d = body(3, .16, 0, -.4, -1);
  resolveRollPair(c, d, R);
  assert(c.spin !== 0 && d.spin !== 0, 'Glancing contact should spin both flags');
});

test('overlapping centres separate finitely and separating flags do not bounce again', () => {
  const a = body(0, 0, 0, 1, 0), b = body(1, 0, 0, -1, 0); resolveRollPair(a, b, R);
  assert([a.x, a.y, a.vx, a.vy, b.x, b.y, b.vx, b.vy, a.spin, b.spin].every(Number.isFinite));
  assert(Math.hypot(a.x - b.x, a.y - b.y) >= R * 2);
  const c = body(2, 0, 0, -1, 0), d = body(3, .15, 0, 1, 0); resolveRollPair(c, d, R); near(c.vx, -1); near(d.vx, 1);
});

test('placement has no overlaps and a closed preview keeps every flag inside the ring', () => {
  for (const count of [12, 24, 48]) for (const seed of [0, 1, 93, 2147483647]) {
    const w = new FlagRollPhysics(seed, true, undefined, count);
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) assert(Math.hypot(w.bodies[i].x - w.bodies[j].x, w.bodies[i].y - w.bodies[j].y) >= 2 * w.radius);
    const slow = new Array(count).fill(0);
    for (let step = 0; step < 12 / ROLL_STEP; step++) {
      w.step();
      for (const b of w.bodies) { slow[b.id] = Math.hypot(b.vx, b.vy) < .3 ? slow[b.id] + ROLL_STEP : 0; assert(slow[b.id] < .6, 'A preview flag stayed nearly still'); }
    }
    assert.equal(w.exits.length, 0);
    for (const b of w.bodies) assert(Math.hypot(b.x, b.y) <= 1 - w.radius - .0139);
  }
});

test('30, 60 and 144 fps produce the same fixed-step trajectory and spin', () => {
  const worlds = [30, 60, 144].map(fps => { const w = new FlagRollPhysics(93, true); for (let i = 0; i < fps * 6; i++) w.advance(1 / fps); return w; });
  for (const w of worlds.slice(1)) {
    near(w.time, worlds[0].time);
    for (let i = 0; i < 12; i++) { near(w.bodies[i].x, worlds[0].bodies[i].x); near(w.bodies[i].y, worlds[0].bodies[i].y); near(w.bodies[i].angle, worlds[0].bodies[i].angle); }
  }
});

test('exits are deterministic, bounded, paced and pass through the actual opening in every mode', () => {
  for (const { count, seconds } of FLAG_MODES) {
    const durations: number[] = [];
    for (const seed of [0, 1, 2, 7, 93, 74117, 910493, 1528496907, 2147483647]) {
      const plan = planFlagRoll(seed, count);
      assert.equal(plan.order.length, count); assert.equal(new Set(plan.order).size, count); assert(plan.duration < 90);
      durations.push(plan.duration);
      for (const e of plan.exits) {
        assert(Math.hypot(e.x, e.y) > 1 + R * Math.pow(12 / count, .25));
        assert(Math.abs(rollAngleDistance(Math.atan2(e.y, e.x), e.gap)) < e.halfGap + .03);
      }
      if (count === 12) {
        const replay = new FlagRollPhysics(seed); while (!replay.finished) replay.advance(1 / 60);
        assert.deepEqual(replay.exits, plan.exits); assert.deepEqual(replay.bodies, plan.terminal);
      }
    }
    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    // Playback stays near real time: the simulated median is at most twice the shown round.
    assert(median > seconds * .6 && median < seconds * 2, `Unexpected ${count}-flag pace ${median}`);
  }
});

test('opening moves continuously and contacts do not teleport a flag toward the exit', () => {
  const w = new FlagRollPhysics(93); let lastGap = 0;
  while (!w.finished) {
    const positions = w.bodies.map(b => ({ x: b.x, y: b.y })); w.step();
    assert(Math.abs(w.halfGap - lastGap) <= .341 * ROLL_STEP); lastGap = w.halfGap;
    for (const b of w.bodies) if (b.escapedAt === null) assert(Math.hypot(b.x - positions[b.id].x, b.y - positions[b.id].y) < .05);
  }
});

test('sound score follows the confirmed exits with one result cue and thinned impacts', () => {
  for (const { id, count, seconds } of FLAG_MODES) {
    const plan = planFlagRoll(910493, count), labels = flagCountries(id).map(c => c.id);
    const order = plan.order.map(i => labels[i]), selected = order[0];
    for (const won of [true, false]) {
      const events = flagBattleTimeline(plan, labels, selected, won, seconds);
      const cues = (cue: string) => events.filter(e => e.cue === cue);
      assert.equal(cues('eliminate').length, count - 1); assert.equal(cues('final-two').length, 1); assert.equal(cues('reveal').length, 1);
      assert.equal(cues(won ? 'win' : 'lose').length, 1); assert.equal(cues(won ? 'lose' : 'win').length, 0);
      assert.equal(cues('eliminate').filter(e => e.variant < 0).length, 1, 'The selected flag gets its own exit sound');
      assert(events.every((e, i) => i === 0 || events[i - 1].at <= e.at));
      const impacts = events.filter(e => e.cue === 'collision' || e.cue === 'wall');
      for (let i = 1; i < impacts.length; i++) assert(impacts[i].at - impacts[i - 1].at >= .12 - 1e-9);
      assert(cues('heartbeat').every(e => e.at > cues('final-two')[0].at));
      assert(events.every(e => e.strength > 0 && e.strength <= 1 && Math.abs(e.pan) <= .8));
    }
  }
});

test('restored completed rounds draw only the winner and report physics version 4', async () => {
  const { FlagStage } = await import('../games/flag-battle/FlagStage');
  const rect = { width: 400, height: 400 }, calls: string[] = [];
  const context = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' || key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...args: unknown[]) => { calls.push(String(key)); return args; }, set: () => true });
  const canvas = { width: 0, height: 0, getBoundingClientRect: () => rect, getContext: () => context } as unknown as HTMLCanvasElement;
  Object.assign(globalThis, { Image: class { complete = false; naturalWidth = 0; src = ''; decoding = ''; }, devicePixelRatio: 1 });
  for (const { id, count } of FLAG_MODES) {
    const stage = new FlagStage(canvas), order = flagCountries(id).map(c => c.id).reverse();
    stage.reset({ version: 2, mode: id, country: order[0], order, seed: 93 });
    stage.finish(); stage.tick(0, false, order[0], true);
    const state = stage.getState();
    assert.equal(state.physicsVersion, 4); assert.equal(state.eliminated, count - 1);
    assert.deepEqual(state.order, order.slice(0, -1)); assert.equal(state.winner, order.at(-1));
    assert.equal(state.bodies.filter(b => !b.escaped).length, 1); assert.equal(state.effects, 0);
  }
});
