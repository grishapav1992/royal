/**
 * Presentation physics v4 for Flag Battle only. Countries and money never enter the solver:
 * the server order labels anonymous trajectories after the replay. Flag Tote and the lobby
 * preview keep FlagPhysics v3.
 */
export const ROLL_PHYSICS_VERSION = 4;
export const ROLL_STEP = 1 / 240;
export const ROLL_WALL_RADIUS = 1;
const BASE_RADIUS = .085;
const POST_RADIUS = .014;
const TAU = Math.PI * 2;
const BALL_RESTITUTION = .9;
const WALL_RESTITUTION = .93;
const FRICTION = .18;
const MIN_SPEED = .78;
const MAX_SPEED = 1.9;
/** Target simulated length per mode, so playback speed stays close to real time. */
const PACE: Record<number, number> = { 12: 23, 24: 28, 48: 36 };
const GATE_START = 1.3;

export interface RollBody {
  id: number; x: number; y: number; vx: number; vy: number; angle: number; spin: number;
  previousX: number; previousY: number; previousAngle: number; escapedAt: number | null;
}
export interface RollContact {
  kind: 'collision' | 'wall'; time: number; strength: number;
  x: number; y: number; nx: number; ny: number; a: number; b: number;
}
export interface RollExit { id: number; time: number; x: number; y: number; gap: number; halfGap: number }
export interface RollPlan { seed: number; duration: number; halfGap: number; contacts: RollContact[]; order: number[]; exits: RollExit[]; terminal: RollBody[] }
export const rollAngleDistance = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function seeded(seed: number) {
  let state = (seed ^ 0x6d2b79f5) >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

/** Equal solid discs: restitution on the normal, Coulomb friction on the slip, spin from torque. */
export function resolveRollPair(a: RollBody, b: RollBody, radius: number): number {
  let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
  const diameter = radius * 2;
  if (distance >= diameter || a.escapedAt !== null || b.escapedAt !== null) return 0;
  if (distance < 1e-10) { dx = 1; dy = 0; distance = 0; }
  const nx = distance ? dx / distance : dx, ny = distance ? dy / distance : dy, tx = -ny, ty = nx;
  const correction = (diameter - distance + 1e-8) / 2;
  a.x -= nx * correction; a.y -= ny * correction; b.x += nx * correction; b.y += ny * correction;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return 0;
  const jn = -(1 + BALL_RESTITUTION) * vn / 2;
  // Slip of b's contact point relative to a's along the tangent. Disc inertia is r^2 / 2.
  const slip = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - radius * (a.spin + b.spin);
  const jt = Math.max(-FRICTION * jn, Math.min(FRICTION * jn, -slip / 6));
  const ix = jn * nx + jt * tx, iy = jn * ny + jt * ty;
  a.vx -= ix; a.vy -= iy; b.vx += ix; b.vy += iy;
  const torque = -2 * jt / radius;
  a.spin += torque; b.spin += torque;
  return -vn;
}

export class FlagRollPhysics {
  readonly bodies: RollBody[];
  readonly radius: number;
  readonly exits: RollExit[] = [];
  time = 0;
  private accumulator = 0;
  private opening = 0;
  private openingVelocity = 0;
  private readonly pace: number;
  constructor(readonly seed: number, readonly preview = false, private contact?: (event: RollContact) => void, readonly count = 12) {
    if (![12, 24, 48].includes(count)) throw Error('Invalid flag body count');
    this.radius = BASE_RADIUS * Math.pow(12 / count, .25);
    this.pace = PACE[count];
    const random = seeded(seed);
    this.bodies = [];
    for (let id = 0; id < this.count; id++) {
      let x = 0, y = 0, found = false;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const a = random() * TAU, r = Math.sqrt(random()) * .73;
        x = Math.cos(a) * r; y = Math.sin(a) * r;
        if (this.bodies.every(b => Math.hypot(x - b.x, y - b.y) > this.radius * 2 + .025)) { found = true; break; }
      }
      if (!found) throw Error('Flag physics could not place separated bodies');
      const heading = random() * TAU, speed = 1.05 + random() * .4, angle = (random() - .5) * .6, spin = (random() - .5) * 6;
      this.bodies.push({ id, x, y, previousX: x, previousY: y, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, angle, previousAngle: angle, spin, escapedAt: null });
    }
  }
  get finished() { return this.exits.length === this.count - 1; }
  get interpolation() { return this.accumulator / ROLL_STEP; }
  get gap() { return Math.PI / 3 + this.time * .62 + Math.sin(this.time * .23) * .18; }
  get halfGap() { return this.opening; }
  private gateSpeed() { return .62 + .18 * .23 * Math.cos(this.time * .23); }
  /** The gate widens when the round falls behind an even elimination schedule. */
  private updateOpening() {
    let desired = 0;
    if (!this.preview && this.time >= GATE_START) {
      const progress = Math.min(1, (this.time - GATE_START) / (this.pace - GATE_START));
      const expected = (this.count - 1) * Math.pow(progress, .92);
      const behind = Math.max(0, expected - this.exits.length);
      const quiet = this.time - (this.exits.at(-1)?.time ?? GATE_START);
      const endgame = this.exits.length >= this.count - 3 ? .12 : 0;
      desired = Math.min(1.25, .3 + behind * .14 + Math.max(0, quiet - 2.5) * .05 + endgame);
      desired = Math.min(Math.PI, Math.max(desired, (this.time - this.pace - 8) * .3));
    }
    const change = Math.max(-.2 * ROLL_STEP, Math.min(.34 * ROLL_STEP, desired - this.opening));
    this.opening += change; this.openingVelocity = change / ROLL_STEP;
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid physics delta');
    this.accumulator += seconds;
    while (this.accumulator + 1e-10 >= ROLL_STEP && !this.finished) { this.step(); this.accumulator -= ROLL_STEP; }
    if (this.finished) this.accumulator = 0;
    this.accumulator = Math.max(0, this.accumulator);
  }
  /** Pair pass with a cheap box reject; at 48 bodies this beats a grid in practice. */
  private collide(active: RollBody[]) {
    const diameter = this.radius * 2;
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j], dx = b.x - a.x, dy = b.y - a.y;
        if (dx > diameter || dx < -diameter || dy > diameter || dy < -diameter || dx * dx + dy * dy >= diameter * diameter) continue;
        const impulse = resolveRollPair(a, b, this.radius);
        if (impulse > .18 && this.contact) {
          const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          this.contact({ kind: 'collision', time: this.time, strength: impulse, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, nx: (b.x - a.x) / d, ny: (b.y - a.y) / d, a: a.id, b: b.id });
        }
      }
    }
  }
  step() {
    if (this.finished) return;
    this.time += ROLL_STEP;
    this.updateOpening();
    for (const b of this.bodies) {
      b.previousX = b.x; b.previousY = b.y; b.previousAngle = b.angle;
      if (b.escapedAt === null) {
        b.vy += .05 * ROLL_STEP;
        const speed = Math.hypot(b.vx, b.vy);
        // Soft energy regulation keeps inelastic impacts lively without random kicks.
        // A slowed flag regains pace within about half a second; a stopped one rolls along the rim.
        if (speed < 1e-6) { const d = Math.hypot(b.x, b.y) || 1; b.vx = -b.y / d * .05 || .05; b.vy = b.x / d * .05; }
        else if (speed < MIN_SPEED) { const k = Math.min(MIN_SPEED, speed + 1.5 * ROLL_STEP) / speed; b.vx *= k; b.vy *= k; }
        else if (speed > MAX_SPEED) { const k = 1 - 1.4 * ROLL_STEP; b.vx *= k; b.vy *= k; }
        b.spin *= 1 - .35 * ROLL_STEP;
      } else {
        b.vy += .65 * ROLL_STEP;
      }
      b.x += b.vx * ROLL_STEP; b.y += b.vy * ROLL_STEP; b.angle += b.spin * ROLL_STEP;
    }
    const active = this.bodies.filter(b => b.escapedAt === null);
    for (let pass = 0; pass < 4; pass++) {
      this.collide(active);
      for (const b of active) this.wall(b);
    }
    for (const b of this.bodies) {
      if (this.finished) break;
      if (b.escapedAt === null && Math.hypot(b.x, b.y) > ROLL_WALL_RADIUS + this.radius + POST_RADIUS) {
        b.escapedAt = this.time;
        this.exits.push({ id: b.id, time: this.time, x: b.x, y: b.y, gap: this.gap, halfGap: this.halfGap });
      }
    }
  }
  /** Rim contact: restitution, friction against the rim and a spin transfer that makes flags roll. */
  private bounce(b: RollBody, nx: number, ny: number, wallX: number, wallY: number, contactX: number, contactY: number) {
    const rvx = b.vx - wallX, rvy = b.vy - wallY, vn = rvx * nx + rvy * ny;
    if (vn <= 0) return;
    const tx = -ny, ty = nx;
    const jn = (1 + WALL_RESTITUTION) * vn;
    const slip = rvx * tx + rvy * ty + this.radius * b.spin;
    const jt = Math.max(-FRICTION * jn, Math.min(FRICTION * jn, slip / 3));
    b.vx -= jn * nx + jt * tx; b.vy -= jn * ny + jt * ty;
    b.spin -= 2 * jt / this.radius;
    if (vn > .18) this.contact?.({ kind: 'wall', time: this.time, strength: vn, x: contactX, y: contactY, nx, ny, a: b.id, b: -1 });
  }
  private wall(b: RollBody) {
    const distance = Math.hypot(b.x, b.y), limit = ROLL_WALL_RADIUS - this.radius - POST_RADIUS;
    const angle = Math.atan2(b.y, b.x), half = this.halfGap;
    if (distance > limit && (half === 0 || Math.abs(rollAngleDistance(angle, this.gap)) >= half)) {
      const nx = b.x / distance, ny = b.y / distance;
      b.x = nx * limit; b.y = ny * limit;
      this.bounce(b, nx, ny, 0, 0, nx * ROLL_WALL_RADIUS, ny * ROLL_WALL_RADIUS);
    }
    if (half > 0 && half < Math.PI) {
      const omega = this.gateSpeed();
      for (const side of [-1, 1]) {
        const a = this.gap + side * half, px = Math.cos(a), py = Math.sin(a);
        const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy), r = this.radius + POST_RADIUS;
        if (d >= r) continue;
        const nx = d > 1e-10 ? dx / d : -px, ny = d > 1e-10 ? dy / d : -py;
        const endpointOmega = omega + side * this.openingVelocity;
        b.x = px + nx * (r + 1e-8); b.y = py + ny * (r + 1e-8);
        this.bounce(b, -nx, -ny, -py * endpointOmega, px * endpointOmega, px, py);
      }
    }
  }
  restore(plan: RollPlan) {
    this.time = plan.duration; this.accumulator = 0; this.opening = plan.halfGap; this.openingVelocity = 0;
    this.exits.splice(0, this.exits.length, ...plan.exits.map(e => ({ ...e })));
    for (const b of plan.terminal) Object.assign(this.bodies[b.id], b, { previousX: b.x, previousY: b.y, previousAngle: b.angle });
  }
}

/** Replay anonymous trajectories, then label them using the saved server order. */
export function planFlagRoll(seed: number, count = 12): RollPlan {
  const contacts: RollContact[] = [];
  const world = new FlagRollPhysics(seed, false, event => contacts.push(event), count);
  while (!world.finished && world.time < 90) world.step();
  if (!world.finished) throw Error('Flag physics did not finish within its bounded presentation');
  const winner = world.bodies.find(b => b.escapedAt === null)!;
  return { seed, duration: world.time, halfGap: world.halfGap, contacts, order: [...world.exits.map(e => e.id), winner.id], exits: world.exits.map(e => ({ ...e })), terminal: world.bodies.map(b => ({ ...b })) };
}
