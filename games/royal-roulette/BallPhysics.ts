/**
 * Presentation physics for the roulette ball. The server receipt chooses the
 * pocket; this model only animates a physically plausible way of reaching it.
 *
 * Units: wheel pixels (outer radius 200) and seconds. Angles are radians,
 * measured clockwise from the top of the wheel. World axes: x to the right,
 * y towards the viewer (down the screen) and z up from the bowl surface.
 */
export const BALL_RADIUS = 5;
export const POCKETS = 37;
export const STEP = 2 * Math.PI / POCKETS;
export const WHEEL = Object.freeze({
  rim: 200, wall: 191, track: 186, diamond: 163, rotor: 150,
  pocketOuter: 128, pocketInner: 107, rest: 112.2, cone: 104,
  fretHalf: .8, fretHeight: 4.4, diamondHeight: 5.5,
});
export const PHYSICS = Object.freeze({
  gravity: 4900, slope: {stator: 2550, ring: 2250, pocket: 700},
  rim: {base: 620, wall: .07}, rolling: {stator: 150, rotor: 95}, air: 1.1e-5,
  grip: {ring: 430, pocket: 420}, diamond: {restitution: .55, hop: .22}, fret: {restitution: .56, hop: .45},
  rotorDecay: .42, brake: 1.1, glide: .45, captureSpeed: 14, captureTime: .16,
});
export const SAMPLE_RATE = 240;
export const SAMPLE_STRIDE = 6;

export type Surface = 'rim' | 'stator' | 'ring' | 'pocket' | 'air';
const SURFACES: readonly Surface[] = ['rim', 'stator', 'ring', 'pocket', 'air'];
export type Contact = {t: number; kind: 'diamond' | 'fret' | 'floor' | 'wall' | 'rest'; strength: number; angle: number};
export type RotorShape = {
  theta0: number; omega0: number; te: number; omegaE: number; offset: number;
  shape: 'early' | 'late'; exponent: number; lock: number; omegaLock: number;
};
export type BallStart = {wheel: number; wheelVelocity: number; ball: number; ballVelocity: number; radius: number};
export type BallSimulation = {
  duration: number; te: number; lock: number; settled: number; pocket: number; natural: boolean; seed: number;
  lockPhi: number; lockRadius: number; targetPhi: number; rotor: RotorShape; samples: Float64Array; contacts: Contact[];
};

/** Small deterministic generator for presentation noise. It never sees game randomness. */
export function presentationRandom(seed: number) {
  let state = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

const TAU = 2 * Math.PI;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const signedWrap = (a: number) => { const w = wrap(a); return w > Math.PI ? w - TAU : w; };
export const angleOf = (x: number, y: number) => Math.atan2(x, -y);
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Rotor angle and speed in the frame the ball physically interacts with. */
function baseRotor(r: Pick<RotorShape, 'theta0' | 'omega0' | 'te' | 'omegaE'>, t: number) {
  if (!Number.isFinite(r.te)) return {theta: r.theta0 + r.omega0 * t, omega: r.omega0};
  if (t < r.te) return {theta: r.theta0 + r.omega0 * t - (r.omega0 - r.omegaE) * t * t / (2 * r.te), omega: r.omega0 - (r.omega0 - r.omegaE) * t / r.te};
  const thetaE = r.theta0 + (r.omega0 + r.omegaE) * r.te / 2, decay = Math.exp(-PHYSICS.rotorDecay * (t - r.te));
  return {theta: thetaE + r.omegaE * (1 - decay) / PHYSICS.rotorDecay, omega: r.omegaE * decay};
}

/**
 * Rotor shown on screen. Before the ball first reaches the rotor its speed
 * profile is reshaped (still monotonically decreasing) so that afterwards the
 * rotor is advanced by a whole number of pockets. Every pocket has the same
 * shape, so the ball's motion is unchanged and only the number under it
 * changes. After the ball locks into its pocket the rotor brakes to rest.
 */
export function displayRotor(r: RotorShape, t: number) {
  if (t < r.te) {
    const u = Math.max(0, t / r.te), span = r.omega0 - r.omegaE, k = r.exponent;
    if (r.shape === 'late') return {theta: r.theta0 + r.omegaE * t + span * r.te * (u - u ** (k + 1) / (k + 1)), omega: r.omegaE + span * (1 - u ** k)};
    return {theta: r.theta0 + r.omegaE * t + span * r.te * (1 - (1 - u) ** (k + 1)) / (k + 1), omega: r.omegaE + span * (1 - u) ** k};
  }
  if (t < r.lock) { const b = baseRotor(r, t); return {theta: b.theta + r.offset, omega: b.omega}; }
  const at = baseRotor(r, r.lock), tau = Math.min(PHYSICS.brake, t - r.lock), w = r.omegaLock;
  return {theta: at.theta + r.offset + w * (tau - tau * tau / (2 * PHYSICS.brake)), omega: w * (1 - tau / PHYSICS.brake)};
}

const releaseSpeed = (omega0: number, te: number) => Math.max(omega0 * .05, Math.min(omega0 * .24, omega0 - 9.5 / te));

type Run = {samples: number[]; contacts: Contact[]; te: number; lock: number; slot: number; natural: boolean; frets: number; lockPhi: number; lockRadius: number};

/** Integrates one trajectory until the ball comes to rest in a pocket of the rotor. */
function simulate(start: BallStart, seed: number): Run {
  const P = PHYSICS, random = presentationRandom(seed), noise = (spread: number) => 1 + (random() * 2 - 1) * spread;
  const b0 = start.ball * Math.PI / 180, omega0 = start.wheelVelocity * Math.PI / 180;
  const rotor = {theta0: start.wheel * Math.PI / 180, omega0, te: Infinity, omegaE: omega0};
  const r0 = Math.min(WHEEL.track, Math.max(WHEEL.rotor + 2, start.radius)), spin = start.ballVelocity * Math.PI / 180 * noise(.02);
  let x = r0 * Math.sin(b0), y = -r0 * Math.cos(b0), vx = spin * -y, vy = spin * x, z = 0, vz = 0;
  const diamonds = Array.from({length: 8}, (_, i) => {
    const a = (i + .5) * TAU / 8, upright = i % 2 === 0;
    return {x: WHEEL.diamond * Math.sin(a), y: -WHEEL.diamond * Math.cos(a), tx: Math.cos(a), ty: Math.sin(a), half: upright ? .8 : 4.2, radius: upright ? 3.3 : 1.9};
  });
  const samples: number[] = [], contacts: Contact[] = [];
  const dt = 1 / 960, every = 960 / SAMPLE_RATE, limit = 12;
  let t = 0, step = 0, onRim = true, still = 0, te = Infinity, frets = 0, lastContact = -1, ux = 0, uy = 0, surface = 0;
  const contact = (kind: Contact['kind'], strength: number) => {
    if (strength < 25) return;
    if (kind === 'fret') frets++;
    const last = contacts[contacts.length - 1];
    if (last && t - lastContact < .045) { if (strength > last.strength) { last.strength = strength; last.kind = kind; } return; }
    lastContact = t; contacts.push({t, kind, strength, angle: angleOf(x, y)});
  };
  const record = () => { samples.push(x, y, z, ux, uy, surface); };
  record();
  while (t < limit) {
    t += dt; step++;
    let r = Math.hypot(x, y);
    if (!Number.isFinite(te) && r < WHEEL.rotor + .5) { te = t; rotor.te = t; rotor.omegaE = releaseSpeed(omega0, t); }
    const rot = baseRotor(rotor, t), w = Number.isFinite(te) ? rot.omega : 0;
    const zone: Surface = r > WHEEL.rotor ? (onRim ? 'rim' : 'stator') : r > WHEEL.pocketOuter ? 'ring' : 'pocket';
    const moving = zone === 'ring' || zone === 'pocket';
    ux = vx - (moving ? w * -y : 0); uy = vy - (moving ? w * x : 0);
    const airborne = z > 0 || vz > 0;
    surface = SURFACES.indexOf(airborne ? 'air' : zone);
    const speed = Math.hypot(vx, vy);
    let ax = -P.air * speed * vx, ay = -P.air * speed * vy;
    if (!airborne) {
      const nx = x / r, ny = y / r, slope = P.slope[zone === 'rim' ? 'stator' : zone];
      ax -= slope * nx; ay -= slope * ny;
      const slip = Math.hypot(ux, uy);
      if (slip > 1e-9) {
        let drag = moving ? P.rolling.rotor : P.rolling.stator;
        if (zone === 'rim') { const vt = vx * ny - vy * nx; drag = P.rim.base + P.rim.wall * Math.max(0, vt * vt / r - slope); }
        if (moving) drag += Math.min(zone === 'pocket' ? P.grip.pocket : P.grip.ring, slip * 7);
        const d = Math.min(drag, slip / dt) / slip;
        ax -= ux * d; ay -= uy * d;
      }
    }
    vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
    if (airborne) {
      vz -= P.gravity * dt; z += vz * dt;
      if (z <= 0) { const impact = -vz; z = 0; vz = impact > 90 ? impact * .32 : 0; contact('floor', impact * .55); }
    }
    r = Math.hypot(x, y);
    // Outer wall of the ball track.
    if (r > WHEEL.track) {
      const nx = x / r, ny = y / r, vr = vx * nx + vy * ny;
      x = nx * WHEEL.track; y = ny * WHEEL.track; r = WHEEL.track;
      if (vr > 0) { vx -= 1.15 * vr * nx; vy -= 1.15 * vr * ny; if (!onRim) contact('wall', vr * .5); }
    } else if (onRim && r < WHEEL.track - .35) onRim = false;
    // Diamonds on the stator cone deflect the ball and kick it up.
    if (z < WHEEL.diamondHeight && Math.abs(r - WHEEL.diamond) < 10) {
      for (const d of diamonds) {
        const along = Math.max(-d.half, Math.min(d.half, (x - d.x) * d.tx + (y - d.y) * d.ty));
        const dx = x - d.x - d.tx * along, dy = y - d.y - d.ty * along, dist = Math.hypot(dx, dy), reach = BALL_RADIUS + d.radius;
        if (dist >= reach || dist < 1e-9) continue;
        const nx = dx / dist, ny = dy / dist, vn = vx * nx + vy * ny;
        x += nx * (reach - dist); y += ny * (reach - dist);
        if (vn >= 0) continue;
        const e = P.diamond.restitution * noise(.18);
        vx -= (1 + e) * vn * nx; vy -= (1 + e) * vn * ny;
        const vt = -vx * ny + vy * nx; vx += .12 * vt * ny; vy -= .12 * vt * nx;
        vz = Math.min(330, Math.max(vz, -vn * P.diamond.hop * noise(.3))); z = Math.max(z, .01);
        contact('diamond', -vn);
      }
    }
    // Frets between pockets move with the rotor.
    if (Number.isFinite(te) && r < WHEEL.pocketOuter + BALL_RADIUS + 1 && z < WHEEL.fretHeight) {
      const index = Math.floor(wrap(angleOf(x, y) - rot.theta) / STEP - .5);
      for (const i of [index, index + 1]) {
        const a = rot.theta + (i + .5) * STEP, ex = Math.sin(a), ey = -Math.cos(a);
        const along = Math.max(WHEEL.pocketInner, Math.min(WHEEL.pocketOuter, x * ex + y * ey));
        const cx = ex * along, cy = ey * along, dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy), reach = BALL_RADIUS + WHEEL.fretHalf;
        if (dist >= reach || dist < 1e-9) continue;
        const nx = dx / dist, ny = dy / dist, fx = w * -cy, fy = w * cx;
        let rx = vx - fx, ry = vy - fy;
        const vn = rx * nx + ry * ny;
        x += nx * (reach - dist); y += ny * (reach - dist);
        if (vn >= 0) continue;
        const e = P.fret.restitution * noise(.2);
        rx -= (1 + e) * vn * nx; ry -= (1 + e) * vn * ny;
        const vt = -rx * ny + ry * nx; rx += .2 * vt * ny; ry -= .2 * vt * nx;
        vx = rx + fx; vy = ry + fy;
        vz = Math.min(300, Math.max(vz, -vn * P.fret.hop * noise(.35))); z = Math.max(z, .01);
        contact('fret', -vn);
      }
    }
    // Inner wall of the pockets, at the foot of the centre cone.
    r = Math.hypot(x, y);
    const inner = WHEEL.pocketInner + BALL_RADIUS;
    if (r < inner) {
      const nx = x / r, ny = y / r, vr = vx * nx + vy * ny;
      x = nx * inner; y = ny * inner; r = inner;
      if (vr < 0) { vx -= 1.3 * vr * nx; vy -= 1.3 * vr * ny; contact('wall', -vr * .6); }
    }
    // A ball resting in a pocket relative to the rotor is captured by it.
    const relative = Math.hypot(vx - w * -y, vy - w * x);
    still = Number.isFinite(te) && r < WHEEL.pocketOuter - 1 && z === 0 && vz === 0 && relative < P.captureSpeed ? still + dt : 0;
    const natural = still > P.captureTime;
    if (natural || (Number.isFinite(te) && t > te + 5.2 && r < WHEEL.pocketOuter + BALL_RADIUS) || t > limit - 1) {
      const phi = wrap(angleOf(x, y) - rot.theta), slot = Math.round(phi / STEP) % POCKETS;
      record();
      return {samples, contacts, te, lock: t, slot, natural, frets, lockPhi: slot === 0 && phi > Math.PI ? phi - TAU : phi, lockRadius: r};
    }
    if (step % every === 0) record();
  }
  throw Error('Roulette ball simulation did not finish');
}

/** Tries a few presentation seeds, then reshapes the rotor so the ball rests in `pocket`. */
export function simulateLanding(start: BallStart, pocket: number, seed: number): BallSimulation {
  if (!Number.isInteger(pocket) || pocket < 0 || pocket >= POCKETS) throw Error('Invalid roulette pocket');
  if (!(start.wheelVelocity > 60) || !(start.ballVelocity < -200) || ![start.wheel, start.ball, start.radius].every(Number.isFinite)) throw Error('Invalid roulette presentation pose');
  let best: Run | undefined, bestScore = -Infinity, bestSeed = seed;
  for (let attempt = 0; attempt < 6; attempt++) {
    const trial = (seed + attempt * 0x6d2b79f5) >>> 0, run = simulate(start, trial), flight = run.lock - run.te;
    const good = run.natural && flight > 1.1 && flight < 4.2 && run.frets >= 2;
    const score = (run.natural ? 4 : 0) + (flight > 1.1 && flight < 4.2 ? 2 : 0) + Math.min(run.frets, 4) * .5 - Math.abs(flight - 2.3) * .3;
    if (score > bestScore) { best = run; bestScore = score; bestSeed = trial; }
    if (good) break;
  }
  const run = best!;
  const offset = signedWrap((((run.slot - pocket) % POCKETS) + POCKETS) % POCKETS * STEP);
  const omega0 = start.wheelVelocity * Math.PI / 180, omegaE = releaseSpeed(omega0, run.te);
  const fill = .5 + offset / ((omega0 - omegaE) * run.te);
  if (!(fill > .01 && fill < .99)) throw Error('Roulette rotor cannot absorb the pocket offset');
  const late = fill >= .5;
  const rotor: RotorShape = {theta0: start.wheel * Math.PI / 180, omega0, te: run.te, omegaE, offset, shape: late ? 'late' : 'early', exponent: late ? fill / (1 - fill) : 1 / fill - 1, lock: run.lock, omegaLock: 0};
  rotor.omegaLock = baseRotor(rotor, run.lock).omega;
  const settled = run.lock + PHYSICS.glide;
  const contacts = [...run.contacts, {t: settled, kind: 'rest' as const, strength: 30, angle: 0}];
  return {duration: run.lock + PHYSICS.brake, te: run.te, lock: run.lock, settled, pocket, natural: run.natural, seed: bestSeed,
    lockPhi: run.lockPhi - offset, lockRadius: run.lockRadius, targetPhi: run.slot * STEP - offset, rotor, samples: Float64Array.from(run.samples), contacts};
}

/** Ball state at time `t` (seconds after the plan started) in world coordinates. */
export function ballAt(sim: BallSimulation, t: number) {
  if (t >= sim.lock) {
    const g = smooth(Math.min(1, (t - sim.lock) / PHYSICS.glide)), rotor = displayRotor(sim.rotor, t);
    const phi = sim.lockPhi + (sim.targetPhi - sim.lockPhi) * g, r = sim.lockRadius + (WHEEL.rest - sim.lockRadius) * g, a = rotor.theta + phi;
    return {x: r * Math.sin(a), y: -r * Math.cos(a), z: 0, ux: 0, uy: 0, surface: 'pocket' as Surface, settled: t >= sim.settled};
  }
  const s = sim.samples, n = s.length / SAMPLE_STRIDE, f = Math.max(0, Math.min(n - 1, t * SAMPLE_RATE));
  const i = Math.min(n - 2, Math.floor(f)), u = f - i, a = i * SAMPLE_STRIDE, b = a + SAMPLE_STRIDE, mix = (k: number) => s[a + k] + (s[b + k] - s[a + k]) * u;
  return {x: mix(0), y: mix(1), z: Math.max(0, mix(2)), ux: mix(3), uy: mix(4), surface: SURFACES[Math.round(s[(u < .5 ? a : b) + 5])], settled: false};
}
