/** Presentation physics only. Countries and money never enter the solver. */
export const FLAG_BODY_RADIUS = .085;
export const FLAG_PHYSICS_STEP = 1 / 240;
export const FLAG_WALL_RADIUS = 1;
const POST_RADIUS = .012;
const TAU = Math.PI * 2;
export interface FlagBody {
  id: number; x: number; y: number; vx: number; vy: number;
  previousX: number; previousY: number; escapedAt: number | null;
}
export interface FlagExit { id: number; time: number; x: number; y: number; gap: number; halfGap: number }
export interface FlagPhysicsPlan { seed: number; duration: number; halfGap: number; order: number[]; exits: FlagExit[]; terminal: FlagBody[] }
export const angleDistance = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function seeded(seed: number) {
  let state = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
/** Equal masses: correct penetration and exchange only the approaching normal impulse. */
export function resolveFlagPair(a: FlagBody, b: FlagBody) {
  let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
  const diameter = FLAG_BODY_RADIUS * 2;
  if (distance >= diameter || a.escapedAt !== null || b.escapedAt !== null) return;
  if (distance < 1e-10) { dx = 1; dy = 0; distance = 0; }
  const nx = distance ? dx / distance : dx, ny = distance ? dy / distance : dy;
  const correction = (diameter - distance + 1e-8) / 2;
  a.x -= nx * correction; a.y -= ny * correction; b.x += nx * correction; b.y += ny * correction;
  const approaching = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (approaching > 0) { a.vx -= approaching * nx; a.vy -= approaching * ny; b.vx += approaching * nx; b.vy += approaching * ny; }
}

export class FlagPhysics {
  readonly bodies: FlagBody[];
  readonly exits: FlagExit[] = [];
  time = 0;
  private accumulator = 0;
  private opening = 0;
  private openingVelocity = 0;
  constructor(readonly seed: number, readonly preview = false) {
    const random = seeded(seed);
    this.bodies = [];
    for (let id = 0; id < 12; id++) {
      let x = 0, y = 0, found = false;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const a = random() * TAU, r = Math.sqrt(random()) * .73;
        x = Math.cos(a) * r; y = Math.sin(a) * r;
        if (this.bodies.every(b => Math.hypot(x - b.x, y - b.y) > FLAG_BODY_RADIUS * 2 + .025)) { found = true; break; }
      }
      if (!found) throw Error('Flag physics could not place separated bodies');
      const angle = random() * TAU, speed = .85 + random() * .35;
      this.bodies.push({ id, x, y, previousX: x, previousY: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, escapedAt: null });
    }
  }
  get finished() { return this.exits.length === 11; }
  get interpolation() { return this.accumulator / FLAG_PHYSICS_STEP; }
  get gap() { return Math.PI / 3 + this.time * .58 + Math.sin(this.time * .21) * .16; }
  get halfGap() { return this.opening; }
  private updateOpening() {
    const quiet = this.time - (this.exits.at(-1)?.time ?? 1.3);
    const normal = Math.min(1.15, .3 + this.time * .002 + Math.max(0, quiet - 4) * .07 + (this.exits.length >= 9 ? .13 : 0));
    const desired = this.preview || this.time < 1.3 ? 0 : Math.min(Math.PI, Math.max(normal, (this.time - 65) * .3));
    const change = Math.max(-.18 * FLAG_PHYSICS_STEP, Math.min(.3 * FLAG_PHYSICS_STEP, desired - this.opening));
    this.opening += change; this.openingVelocity = change / FLAG_PHYSICS_STEP;
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid physics delta');
    this.accumulator += seconds;
    while (this.accumulator + 1e-10 >= FLAG_PHYSICS_STEP && !this.finished) {
      this.step(); this.accumulator -= FLAG_PHYSICS_STEP;
    }
    if (this.finished) this.accumulator = 0;
    this.accumulator = Math.max(0, this.accumulator);
  }
  step() {
    if (this.finished) return;
    this.time += FLAG_PHYSICS_STEP;
    this.updateOpening();
    for (const b of this.bodies) {
      b.previousX = b.x; b.previousY = b.y;
      b.vy += (b.escapedAt === null ? .045 : .65) * FLAG_PHYSICS_STEP;
      b.x += b.vx * FLAG_PHYSICS_STEP; b.y += b.vy * FLAG_PHYSICS_STEP;
    }
    // Revisit the wall after pair corrections, so a cluster cannot push through the rim.
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < this.bodies.length; i++) for (let j = i + 1; j < this.bodies.length; j++) resolveFlagPair(this.bodies[i], this.bodies[j]);
      for (const b of this.bodies) if (b.escapedAt === null) this.wall(b);
    }
    for (const b of this.bodies) {
      if (this.finished) break;
      if (b.escapedAt === null && Math.hypot(b.x, b.y) > FLAG_WALL_RADIUS + FLAG_BODY_RADIUS + POST_RADIUS) {
        b.escapedAt = this.time;
        this.exits.push({ id: b.id, time: this.time, x: b.x, y: b.y, gap: this.gap, halfGap: this.halfGap });
      }
    }
  }
  private wall(b: FlagBody) {
    const distance = Math.hypot(b.x, b.y), limit = FLAG_WALL_RADIUS - FLAG_BODY_RADIUS - POST_RADIUS;
    const angle = Math.atan2(b.y, b.x), half = this.halfGap;
    if (distance > limit && (half === 0 || Math.abs(angleDistance(angle, this.gap)) >= half)) {
      const nx = b.x / distance, ny = b.y / distance, speed = b.vx * nx + b.vy * ny;
      b.x = nx * limit; b.y = ny * limit;
      if (speed > 0) { b.vx -= 2 * speed * nx; b.vy -= 2 * speed * ny; }
    }
    if (half > 0 && half < Math.PI) {
      const omega = .58 + .16 * .21 * Math.cos(this.time * .21);
      for (const side of [-1, 1]) {
        const a = this.gap + side * half, px = Math.cos(a), py = Math.sin(a);
        const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy), r = FLAG_BODY_RADIUS + POST_RADIUS;
        if (d >= r) continue;
        const nx = d > 1e-10 ? dx / d : -px, ny = d > 1e-10 ? dy / d : -py;
        const endpointOmega = omega + side * this.openingVelocity;
        const wallX = -py * endpointOmega, wallY = px * endpointOmega;
        const dot = (b.vx - wallX) * nx + (b.vy - wallY) * ny;
        b.x = px + nx * (r + 1e-8); b.y = py + ny * (r + 1e-8);
        if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
      }
    }
  }
  restore(plan: FlagPhysicsPlan) {
    this.time = plan.duration; this.accumulator = 0; this.opening = plan.halfGap; this.openingVelocity = 0;
    this.exits.splice(0, this.exits.length, ...plan.exits.map(e => ({ ...e })));
    for (const b of plan.terminal) Object.assign(this.bodies[b.id], b, { previousX: b.x, previousY: b.y });
  }
}

/** Replay anonymous trajectories, then label them using the saved server order. */
export function planFlagPhysics(seed: number): FlagPhysicsPlan {
  const world = new FlagPhysics(seed);
  while (!world.finished && world.time < 90) world.step();
  if (!world.finished) throw Error('Flag physics did not finish within its bounded presentation');
  const winner = world.bodies.find(b => b.escapedAt === null)!;
  return { seed, duration: world.time, halfGap: world.halfGap, order: [...world.exits.map(e => e.id), winner.id], exits: world.exits.map(e => ({ ...e })), terminal: world.bodies.map(b => ({ ...b })) };
}
