import { drawGoalFrame, drawGoalNet, goalBallPosition, NET_TRAVEL, NET_SETTLE } from '../../../../../src/ui/crLeoGoal';
import { drawFootball } from '../../../../../src/ui/crLeoBall';
import { drawPitch, PITCH, type Pitch } from './pitch';
import { penaltyZone, shotZone, type PenaltyHero, type PenaltyRisk, type PenaltyShot, type PenaltyView } from '../../../../../src/shared/crLeo';
import { celebrationPose, celebrationTime, celebrationDuration, CR_JUMP_TAKEOFF, CR_JUMP_LANDING, flightPosition, keeperPlacement, PENALTY_CONTACT, PENALTY_RESULT, shotTarget, shotTiming, shotBallRadius, shotBallRotation, strikePlacement } from '../../../../../src/ui/crLeoTimeline';
import { freeKickFlight, isWallHit, wallMotion, wallCrossing, wallContact, type FreeKickWall } from '../../../../../src/ui/crLeoFreeKick';
import { drawClouds, drawCrowd, platePlacement, type Plate } from './crowd';
import { Camera, type Shot } from './camera';
import { Effects } from './effects';
import type { Assets } from './assets';

export type SceneEvent = 'kick' | 'goal' | 'post' | 'save' | 'wall' | 'celebrate';
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => { n = clamp(n); return n * n * (3 - 2 * n); };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const KIT = { cr: ['#ffffff', '#f3f1e6', '#142621', '#ff8a2a'], leo: ['#23408f', '#8f1d3f', '#f5c53a', '#ffffff'] } as const;
const FLARE = { cr: ['#ffb36b', '#fff0d8'], leo: ['#d6284f', '#f5c53a'] } as const;
const RUN_FROM = .42, STEP = .24, BACKSWING = .90, MOVE = .8;
/** The calm walk-off after an ordinary cashout. The full jump and shirt belong to five goals. */
const CASHOUT_SECONDS = 2.6;

function pitchAt(width: number, height: number, distance: number, cameraX: number): Pitch {
  const cameraZ = distance + 6.5, horizon = height * .385, focal = Math.min(height * .94, width * .72) * 17.5 / PITCH.goalWidth;
  const rise = height * (.84 - .385) * 6.5, scale = (z: number) => focal / (cameraZ - z);
  const project = (x: number, z: number, up = 0) => ({ x: width / 2 + (x - cameraX) * scale(z), y: horizon + rise / (cameraZ - z) - up * scale(z) });
  const mouth = (z: number) => ({ x: project(0, z).x, bottom: project(0, z).y, width: PITCH.goalWidth * scale(z), height: PITCH.goalHeight * scale(z) });
  const ground = project(cameraX, distance);
  return { width, height, distance, cameraX, cameraZ, horizon, scale, project, goal: { ...mouth(0), rear: mouth(-PITCH.goalDepth) }, ball: { x: ground.x, y: ground.y - height * .028 }, standBottom: project(0, -PITCH.standBehindGoal).y };
}
const spotOf = (hero: PenaltyHero, risk: PenaltyRisk) => ({ distance: risk === 'safe' ? 11 : risk === 'sharp' ? 20 : 30, cameraX: risk === 'safe' ? 0 : hero === 'cr' ? -1.1 : 1.1 });
function wallAt(pitch: Pitch, h: number, risk: PenaltyRisk): FreeKickWall | undefined {
  if (risk === 'safe') return;
  const z = pitch.distance - 9.15, g = pitch.project(pitch.cameraX * z / pitch.distance, z);
  return { x: g.x, bottom: g.y, size: pitch.scale(z) * 1.85 / .90, spacing: pitch.scale(z) * .50, height: h, count: risk === 'extreme' ? 3 : 5, crossing: wallCrossing(risk), risk };
}
/** Keeps the accepted end time; the last metres are slightly slower so the goal line reads. */
export function easeFlight(u: number, risk: PenaltyRisk, blocked: boolean) {
  if (blocked || u <= 0 || u >= 1) return u;
  const from = risk === 'safe' ? 0 : wallCrossing(risk); if (u <= from) return u;
  const v = (u - from) / (1 - from); return from + (1 - from) * (v + .62 * v * v * (1 - v));
}

type Sprite = { cell: number; x: number; bottom: number; size: number; grounded?: boolean; alpha?: number; sx?: number; sy?: number };
export class MatchScene {
  private ctx: CanvasRenderingContext2D;
  private camera = new Camera(); private fx = new Effects();
  private hero: PenaltyHero = 'cr'; private previewRisk: PenaltyRisk = 'safe'; private celebrationRisk?: PenaltyRisk;
  private view?: PenaltyView; private started = 0; private mode: 'idle' | 'shot' | 'celebrate' | 'restored' = 'idle';
  private fired = new Set<string>(); private last = 0; private alive = true;
  private move = { key: '', start: -9, distance: 11, cameraX: 0, risk: 'safe' as PenaltyRisk, oldRisk: 'safe' as PenaltyRisk };
  private entered = -9; private heat = .1;
  private ballDrop = -9; private waveAt = -9; private waves = 0; private flashes: { at: number; x: number; y: number }[] = [];
  private flares: { x: number; y: number; color: string; next: number }[] = []; private flareEnd = -9;
  readonly stats: Record<string, unknown> = {};
  constructor(private canvas: HTMLCanvasElement, private assets: Assets, private sound: (e: SceneEvent) => void,
    private clock: () => number = () => performance.now(), public reduced = matchMedia('(prefers-reduced-motion: reduce)').matches) {
    this.ctx = canvas.getContext('2d')!;
  }
  select(hero: PenaltyHero, risk = this.previewRisk) {
    if (hero !== this.hero) this.entered = this.clock() / 1000;
    this.hero = hero; this.previewRisk = risk; this.mode = 'idle'; this.view = undefined; this.celebrationRisk = undefined; this.calm();
  }
  chooseRisk(risk: PenaltyRisk) { this.previewRisk = risk; }
  private calm() { this.flares = []; this.flashes = []; }
  show(view: PenaltyView, animate: boolean, cashout = false) {
    this.celebrationRisk = cashout ? this.previewRisk : undefined;
    this.hero = view.hero; this.previewRisk = this.celebrationRisk ?? view.risk; this.view = structuredClone(view);
    this.started = this.clock(); this.fired.clear(); this.flares = []; this.flashes = [];
    this.mode = !animate || this.reduced ? 'restored' : cashout ? 'celebrate' : 'shot';
    if (this.mode !== 'restored') this.fx.clear();
  }
  private emit(name: SceneEvent) { if (!this.fired.has(name)) { this.fired.add(name); this.sound(name); } }
  private once(name: string, run: () => void) { if (!this.fired.has(name)) { this.fired.add(name); run(); } }
  private celebrationLength(full: boolean) { return full ? celebrationDuration(this.hero, true) : CASHOUT_SECONDS; }
  state(now = this.clock()) {
    const t = (now - this.started) / 1000, paid = this.view?.status === 'complete', lost = this.view?.status === 'lost';
    const timing = shotTiming(this.view?.risk ?? this.previewRisk, this.view?.shots.at(-1)), length = this.celebrationLength(!!paid);
    const duration = this.mode === 'celebrate' ? length : this.mode === 'shot' ? paid ? timing.celebration + length : lost ? timing.result + 2.3 : timing.ready : 0;
    return { busy: t < duration, reveal: this.mode !== 'shot' || t >= timing.result, phase: this.mode === 'shot' && t < timing.result ? 'shooting' : this.view?.status ?? 'idle', t };
  }
  /** True once the celebration reaches the landing or the raised shirt. */
  shout(now = this.clock()) {
    if (this.view?.status !== 'complete' || this.mode !== 'shot') return false;
    const t = (now - this.started) / 1000 - shotTiming(this.view.risk, this.view.shots.at(-1)).celebration;
    return this.hero === 'cr' ? celebrationTime(t, 'cr', true) >= CR_JUMP_LANDING : t >= 1.75;
  }
  private sprite(name: string, s: Sprite) {
    const f = this.assets.frames.get(name)?.[s.cell]; if (!f) return;
    const c = this.ctx, pivot = s.grounded ? f.y + f.height : .94;
    c.save(); c.globalAlpha *= s.alpha ?? 1; c.translate(s.x, s.bottom); c.scale(s.sx ?? 1, s.sy ?? 1);
    c.drawImage(f.image, (f.x - .5) * s.size, (f.y - pivot) * s.size, f.width * s.size, f.height * s.size); c.restore();
  }
  private wall(wall: FreeKickWall, u: number, hit: boolean, seconds: number, alpha: number) {
    const name = wall.count === 3 ? 'wall-far' : 'wall', motion = wallMotion(u, wall.height, hit, wall.crossing), frames = this.assets.frames.get(name);
    const frame = frames?.[motion.row], ref = frames?.[0]; if (!frame || !ref) return;
    const c = this.ctx, size = wall.size * .90 / ref.height; c.save(); c.globalAlpha = alpha;
    // Shadows spread and lighten as the players leave the ground.
    const air = clamp(motion.jump / (wall.height * .045)); c.fillStyle = `rgba(23,39,29,${.24 - air * .11})`;
    for (let i = 0; i < wall.count; i++) { c.beginPath(); c.ellipse(wall.x + (i - (wall.count - 1) / 2) * wall.spacing, wall.bottom + 1, wall.spacing * (.48 + air * .08), wall.height * .009, 0, 0, Math.PI * 2); c.fill(); }
    const since = u - wall.crossing, shake = hit && since >= 0 ? Math.sin(since * 46) * Math.max(0, 1 - since * 3.2) * wall.height * .010 : 0;
    const sway = u < 0 && !this.reduced ? Math.sin(seconds * 1.6) * wall.spacing * .025 : 0, breathe = u < 0 && !this.reduced ? 1 + Math.sin(seconds * 2.3) * .004 : 1;
    this.sprite(name, { cell: motion.row, x: wall.x + shake + sway - (frame.x + frame.width / 2 - .5) * size, bottom: wall.bottom - motion.jump, size, grounded: true, sy: breathe });
    c.restore();
  }
  private excitement(u: number, seconds: number) {
    let e = this.heat;
    const s = seconds - this.waveAt;
    for (let i = 0; i < this.waves; i++) { const at = (s - i * .85) / 1.5; if (at > -.2 && at < 1.2) e = Math.max(e, Math.exp(-(((u - at) / .15) ** 2))); }
    return e;
  }
  private flash(c: CanvasRenderingContext2D, seconds: number, h: number) {
    let lit = 0;
    for (const f of this.flashes) {
      const age = seconds - f.at; if (age < 0 || age > .13) continue; lit++;
      const k = 1 - age / .13, r = h * .026 * (.6 + k * .4), g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(255,255,255,${k})`); g.addColorStop(.25, `rgba(255,255,255,${k * .55})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(f.x - r, f.y - r, r * 2, r * 2); c.fillStyle = `rgba(255,255,255,${k * .8})`; c.fillRect(f.x - r, f.y - .6, r * 2, 1.2); c.fillRect(f.x - .6, f.y - r * .7, 1.2, r * 1.4);
    }
    this.stats.flashes = lit;
  }
  /** Small camera flashes in the stands, spaced so there are never more than three in one second. */
  private scheduleFlashes(seconds: number, count: number, at: Plate, w: number) {
    for (let i = 0; i < count; i++) { const row = Math.random() < .5 ? 285 + Math.random() * 22 : 372 + Math.random() * 34; this.flashes.push({ at: seconds + .12 + i * .37, x: (.04 + Math.random() * .92) * w, y: at.y + row * at.scale }); }
  }
  private runPose(t: number) {
    if (t < RUN_FROM) return 0;
    if (t < RUN_FROM + STEP) return 1;
    if (t < BACKSWING) return 2;
    if (t < PENALTY_CONTACT - .015) return 3;
    return t < 1.25 ? 4 : t < 1.48 ? 5 : 6;
  }
  paint(now = this.clock()) {
    if (!this.alive) return;
    const canvas = this.canvas, w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2); if (!w || !h) return;
    const seconds = now / 1000, dt = clamp(seconds - this.last, 0, .05); this.last = seconds;
    const state = this.state(now), t = state.t, view = this.view, shot = view?.shots.at(-1), shotRisk = shot?.risk ?? view?.risk ?? this.previewRisk, timing = shotTiming(shotRisk, shot);
    const still = this.reduced, animated = this.mode === 'shot';
    const playing = animated && !(view?.status === 'playing' && t >= timing.ready);
    // The scorer keeps his fist up for a moment after the next choice is already available.
    const afterGoal = animated && view?.status === 'playing' && t >= timing.ready && t < timing.ready + .75;
    const full = view?.status === 'complete';
    const celebrating = this.mode === 'celebrate' || playing && full && t >= timing.celebration || this.mode === 'restored' && (view?.status === 'banked' || full);
    const risk = celebrating && this.celebrationRisk ? this.celebrationRisk : playing || celebrating || this.mode === 'restored' && view?.status === 'lost' ? shotRisk : this.previewRisk;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    this.camera.snap(w, h);
    // Camera travel to another spot. It always ends before the foot reaches the ball.
    const goalSpot = spotOf(this.hero, risk), key = goalSpot.distance + ':' + goalSpot.cameraX;
    if (this.move.key !== key) {
      const first = !this.move.key, was = first ? goalSpot : this.lastSpot;
      this.move = { key, start: first || still ? -9 : seconds, distance: was.distance, cameraX: was.cameraX, oldRisk: first ? risk : this.move.risk, risk };
    }
    this.move.risk = risk;
    const k = animated && t >= PENALTY_CONTACT - .1 && playing ? 1 : smooth((seconds - this.move.start) / MOVE);
    const spot = { distance: mix(this.move.distance, goalSpot.distance, k), cameraX: mix(this.move.cameraX, goalSpot.cameraX, k) };
    this.lastSpot = spot;
    const pitch = pitchAt(w, h, spot.distance, spot.cameraX), goal = pitch.goal, from = pitch.ball, free = risk !== 'safe', wall = wallAt(pitch, h, risk);
    const oldWall = k < 1 && this.move.oldRisk !== risk ? wallAt(pitch, h, this.move.oldRisk) : undefined;
    const place = platePlacement(w, pitch.standBottom), sign = this.hero === 'cr' ? 1 : -1;
    const wallHit = free && isWallHit(shot, risk), zone = shot ? shotZone(shot, view?.risk) : penaltyZone(13), side = zone.side, target = shot ? shotTarget(shot, goal) : { x: goal.x, y: goal.bottom };
    const flight = playing && !!shot && t >= PENALTY_CONTACT;
    const raw = ((playing ? t : 0) - PENALTY_CONTACT) / (timing.flightEnd - PENALTY_CONTACT);
    const ballAt = (u: number) => {
      const e = easeFlight(clamp(u), risk, wallHit);
      return wall && shot ? freeKickFlight(e, from, target, wall, shot) : { ...flightPosition(PENALTY_CONTACT + (PENALTY_RESULT - PENALTY_CONTACT) * e, from, target, zone.row === 2 ? .025 : zone.row === 1 ? .12 : .30, side * goal.width * (zone.column === 0 || zone.column === 5 ? .025 : .008)), route: '' };
    };
    const p = ballAt(raw), progress = easeFlight(raw, risk, wallHit), crossing = wallCrossing(risk), r = shotBallRadius(h, risk, p.u, wallHit);
    const netAge = t - timing.result - NET_TRAVEL, netActive = animated && !!shot?.goal && risk === shotRisk && netAge > 0 && netAge < NET_SETTLE && !celebrating;
    const netImpact = netActive ? { x: zone.x, y: zone.y, age: netAge } : undefined;
    const goals = view ? view.shots.filter(s => s.goal).length - (state.reveal || !shot?.goal ? 0 : 1) : 0;

    // Confirmed moments only.
    if (playing && t >= PENALTY_CONTACT) { this.emit('kick'); this.once('turf', () => { this.fx.turf(from.x, from.y + shotBallRadius(h, risk), h, 26, sign * .7, 1); this.camera.knock(h * .010); }); }
    if (playing && t >= timing.result && shot) {
      this.emit(shot.goal ? 'goal' : wallHit ? 'wall' : shot.finish === 'post' ? 'post' : 'save');
      this.once('impact', () => {
        if (shot.goal) { this.waveAt = seconds; this.waves = Math.min(3, 1 + Math.floor(goals / 2)); this.camera.knock(h * .006); this.scheduleFlashes(seconds, full ? 9 : 2 + goals, place, w); }
        else if (wallHit && wall) { const at = wallContact(shot, wall); this.fx.dust(at.x, at.y, h * .05, 12); this.camera.knock(h * .006); }
        else if (shot.finish === 'post') { this.fx.sparks(target.x, target.y, h * .07); this.camera.knock(h * .008); }
        else if (shot.finish === 'save') { this.fx.dust(target.x, target.y, h * .035, 8, '#ffffff'); this.camera.knock(h * .006); }
      });
    }
    const fullStart = celebrating && full && this.mode !== 'restored';
    if (fullStart) {
      this.once('party', () => {
        this.emit('celebrate'); const colors = KIT[this.hero];
        this.fx.confetti(w, h, colors, 120); this.fx.cannon(-w * .01, h * .86, h, 1, colors, 60); this.fx.cannon(w * 1.01, h * .86, h, -1, colors, 60);
        this.waveAt = seconds; this.waves = 5;
        const flare = FLARE[this.hero]; this.flareEnd = seconds + 4.4;
        this.flares = [.07, .24, .77, .93].map((u, i) => ({ x: u * w, y: place.y + (i % 2 ? 392 : 300) * place.scale, color: flare[i % 2], next: 0 }));
      });
      if (t - timing.celebration > 1.6) this.once('rain', () => this.fx.confetti(w, h, KIT[this.hero], 90));
    }
    const heat = still ? 0 : fullStart ? .85 : this.mode === 'celebrate' && state.busy ? .55 : animated && state.reveal && state.busy ? shot?.goal ? .6 : .03 : animated && t > PENALTY_CONTACT && !state.reveal ? .34 : view?.status === 'lost' ? .03 : .10 + goals * .06;
    this.heat += (heat - this.heat) * (1 - Math.exp(-(heat > this.heat ? 7 : 1.6) * dt));
    for (const f of this.flares) if (seconds < this.flareEnd && seconds > f.next) { f.next = seconds + .055; this.fx.smoke(f.x, f.y, h * .05, f.color); }
    this.fx.step(dt);

    // Where the television camera looks.
    const ct = this.mode === 'celebrate' ? t : this.mode === 'restored' ? this.celebrationLength(full) : t - timing.celebration;
    const close = free ? 1.16 : 1.07;
    const goalY = goal.bottom - goal.height * .42, sinceResult = t - timing.result;
    const breath = still ? 0 : Math.sin(seconds * .55) * .004;
    let look: Shot = { zoom: 1.015 + breath, x: w / 2, y: h / 2, rate: 3.2 };
    if (celebrating && !still && state.busy) look = full ? { zoom: w < h ? 1.06 : 1.12, x: goal.x, y: h * (this.hero === 'leo' ? .52 : .56), rate: 2.2 } : { zoom: 1.07, x: goal.x, y: h * .54, rate: 2 };
    else if (playing && !still) {
      if (t < PENALTY_CONTACT) look = { zoom: 1.015 + .025 * smooth(t / PENALTY_CONTACT), x: mix(w / 2, (from.x + goal.x) / 2, .5), y: h * .5, rate: 5 };
      else if (sinceResult < (shot?.goal ? .45 : 1)) { const b = ballAt(Math.min(1, raw)); look = { zoom: close, x: mix(goal.x, b.x, .15), y: mix(h * .5, goalY, .7), rate: 1 + 2.5 * clamp((t - PENALTY_CONTACT) / .2) }; }
    }
    if (still) this.camera.reset(w, h); else this.camera.follow(look, dt);

    const c = this.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); c.save(); this.camera.apply(c, w, h);
    drawPitch(c, pitch, this.assets.images.get('plate'), () => {
      if (!still) { drawClouds(c, this.assets.images.get('clouds')!, place, seconds); drawCrowd(c, this.assets.crowd, place, seconds, u => this.excitement(u, seconds), w); }
      this.fx.draw(c, ['smoke']);
      for (const f of this.flares) if (seconds < this.flareEnd) { const q = h * (.016 + Math.random() * .006), g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, q * 2.4); g.addColorStop(0, '#fff'); g.addColorStop(.3, f.color); g.addColorStop(1, f.color + '00'); c.fillStyle = g; c.fillRect(f.x - q * 3, f.y - q * 3, q * 6, q * 6); }
      this.flash(c, seconds, h);
    });
    const postHit = playing && shot?.finish === 'post' && sinceResult > 0 && sinceResult < 1 ? Math.sin(sinceResult * 68) * Math.exp(-sinceResult * 5) * goal.width * .006 : 0;
    const shownGoal = postHit ? { ...goal, x: goal.x + postHit } : goal;
    drawGoalNet(c, shownGoal, netImpact);

    // Goalkeeper.
    const ref = this.assets.frames.get('keeper')![0], keeperScale = goal.height * (1.90 / 2.44) / (ref.height * h * .27), baseSize = h * .27 * keeperScale;
    const groundY = goal.bottom + (.94 - ref.y - ref.height) * baseSize, readyX = goal.x + (free ? sign * goal.width * .31 * k : 0);
    let name = 'keeper', cell = 0, kx = readyX, ky = groundY, ks = baseSize, ksy = 1; let held: { x: number; y: number } | undefined;
    if (!flight && !still && !celebrating) { const hop = playing ? Math.abs(Math.sin(t * 9)) : Math.max(0, Math.sin(seconds * 2.6)); kx += Math.sin(seconds * 1.3) * goal.width * .010; ky -= hop * goal.height * (playing ? .020 : .010); ksy = playing && t > .86 ? .95 : 1 - (1 - hop) * .012; }
    if (flight && shot && !celebrating && !wallHit) {
      const reaction = shot.goal ? penaltyZone(zone.row * 6 + (side > 0 ? 0 : 5)) : zone, central = reaction.column === 2 || reaction.column === 3, high = reaction.row === 0, reach = high || central;
      const catchName = reach ? 'keeper-reach' : 'keeper-dive', catchCell = reach ? high ? central ? 2 : reaction.side < 0 ? 0 : 1 : 3 : (reaction.row === 1 ? 0 : 2) + (reaction.side < 0 ? 0 : 1);
      const landName = central ? 'keeper-reach' : 'keeper', landCell = central ? 3 : reaction.side < 0 ? 3 : 6;
      const sizeFor = (n: string) => baseSize * (n.startsWith('keeper-') ? .78 : 1), handFor = (n: string, q: number) => this.assets.frames.get(n)?.[q]?.hand ?? { x: central ? .5 : reaction.side < 0 ? .18 : .88, y: high ? .15 : .67 };
      const dest = { x: goal.x - goal.width / 2 + goal.width * reaction.x, y: goal.bottom - goal.height + goal.height * reaction.y };
      const landSize = sizeFor(landName), landHand = handFor(landName, landCell), landX = central ? dest.x : goal.x + reaction.side * goal.width * .30, landY = goal.bottom + h * .05 * keeperScale;
      const landBall = { x: landX + (landHand.x - .5) * landSize, y: landY + (landHand.y - .94) * landSize };
      const u = clamp(raw), drop = clamp((sinceResult - .15) / .55), settle = drop * drop * (3 - 2 * drop);
      const landed = settle > .42; name = landed ? landName : catchName; cell = landed ? landCell : catchCell; ks = sizeFor(name);
      const glove = { x: mix(dest.x, landBall.x, settle), y: mix(dest.y, landBall.y, settle) }, put = keeperPlacement(glove, handFor(name, cell), ks), go = 1 - (1 - u) ** 2;
      kx += (put.x - kx) * go; ky += (put.bottom - ky) * go - Math.sin(Math.PI * u) * h * .025 * keeperScale;
      if (shot.finish === 'save' && sinceResult >= 0) held = glove;
      if (u < .15) { name = 'keeper'; cell = reaction.side < 0 ? 1 : 4; ks = baseSize; }
      if (landed) {
        const since = sinceResult - .15 - .55 * .44; ksy = 1 - .10 * Math.exp(-since * 9) * Math.cos(since * 22);
        if (!central) this.once('land', () => { this.fx.turf(landX, goal.bottom + h * .004, h * .55, 14, reaction.side * .6, .55); this.fx.dust(landX, goal.bottom, goal.height * .22, 7, '#dfe6c4'); this.camera.knock(h * .004); });
      }
      if (shot.goal && sinceResult > .95) { name = 'keeper'; cell = 7; kx = readyX; ky = groundY; ks = baseSize; ksy = 1; }
    }
    if (afterGoal) cell = 7;
    if (celebrating || this.mode === 'restored' && view?.status === 'lost') cell = 7;
    // Keep the beaten keeper in view beside the celebrating player.
    if (celebrating) kx = goal.x + sign * goal.width * .34;
    this.sprite(name, { cell, x: kx, bottom: ky, size: ks, sy: ksy });

    // Kicker. Portrait windows use a smaller figure so the far side of the goal stays open.
    const tall = Math.min(h * .59, w * .70);
    let size = tall * (this.hero === 'cr' ? 1 : .93), footY = h * .945, hx: number, pose = 0, sx = 1, sy = 1, air = 0, alpha = 1;
    const run = playing ? clamp((t - RUN_FROM) / (PENALTY_CONTACT - RUN_FROM)) : 0, advance = run * .45 + run * run * .55;
    const strike = strikePlacement(this.hero, from, size, shotBallRadius(h, risk));
    const idleX = from.x - sign * Math.max(size * .34, Math.min(size * .38, from.x - size * .20)); hx = mix(idleX, strike.x, advance); footY = mix(footY, strike.bottom, advance);
    if (playing && !celebrating) {
      pose = this.runPose(t);
      if (t >= RUN_FROM && t < BACKSWING) {
        const stepPhase = (t - RUN_FROM) / STEP; air = Math.abs(Math.sin(Math.PI * stepPhase)) * h * .010;
      }
      if (t < RUN_FROM) { sy = 1 - .016 * Math.sin(Math.PI * t / RUN_FROM); sx = 1 + .010 * Math.sin(Math.PI * t / RUN_FROM); }
      if (shot && !shot.goal && sinceResult >= 0) pose = sinceResult < .95 ? 12 : this.hero === 'cr' && sinceResult < 1.7 ? 13 : this.hero === 'cr' ? 14 : 13;
      if (shot?.goal && sinceResult >= (w < h ? .34 : .12)) pose = 7;
      if (sinceResult > .2) { const back = smooth((sinceResult - .2) / .4); hx = mix(hx, idleX, back); footY = mix(footY, h * .945, back); }
    } else if (afterGoal) { pose = t < timing.ready + .45 ? 7 : 6; air = 0; }
    else if (this.mode === 'restored' && view?.status === 'lost') pose = this.hero === 'cr' ? 14 : 13;
    else if (!celebrating && !still) { sy = 1 + Math.sin(seconds * 2.1) * .005; hx += Math.sin(seconds * .8) * size * .004; }
    if (celebrating) {
      // He walks from where the kick left him to the middle of the picture.
      const walk = this.mode === 'restored' || still ? 1 : smooth(ct / .5);
      if (full && this.mode === 'shot') { const inner = goal.x - sign * goal.width / 2, half = size * (this.hero === 'cr' ? .25 : .17); hx = sign > 0 ? Math.max(size * .09, Math.min(idleX, inner - half + size * .02)) : Math.min(w - size * .09, Math.max(idleX, inner + half - size * .02)); }
      hx = mix(hx, goal.x, walk); footY = mix(footY, h * .945, walk); size *= 1 + .06 * walk;
      if (full) {
        pose = celebrationPose(ct, this.hero, true);
        const m = celebrationTime(ct, this.hero, true);
        if (this.hero === 'cr' && m >= CR_JUMP_TAKEOFF && m < CR_JUMP_LANDING) air = Math.sin(clamp((m - CR_JUMP_TAKEOFF) / (CR_JUMP_LANDING - CR_JUMP_TAKEOFF)) * Math.PI) * h * .085;
        if (this.hero === 'cr' && m >= CR_JUMP_LANDING && this.mode !== 'restored') { this.once('stomp', () => { this.fx.turf(hx - size * .18, footY, h, 14, -.5, .7); this.fx.turf(hx + size * .18, footY, h, 14, .5, .7); this.camera.knock(h * .012); }); const a = m - CR_JUMP_LANDING; sy = 1 - .06 * Math.exp(-a * 8) * Math.cos(a * 20); }
        if (this.hero === 'leo' && ct > 1.75) sy = 1 + Math.sin(ct * 6) * .006;
      } else { pose = ct < 2.1 || this.mode === 'restored' ? 7 : 0; air = this.mode === 'restored' ? 0 : Math.max(0, Math.sin(ct * 8)) * h * .010 * Math.max(0, 1 - ct / 1.6); }
    }
    // The follow-through carries him clear of the goal mouth. He stays in the picture the whole time.
    const clear = playing && !celebrating && t > PENALTY_CONTACT ? smooth((t - PENALTY_CONTACT - .05) / .42) : afterGoal ? 1 - smooth((t - timing.ready - .1) / .6) : 0;
    if (clear) { const half = size * (this.hero === 'cr' ? .25 : .17), inner = goal.x - sign * goal.width / 2, spotX = sign > 0 ? Math.max(size * .09, Math.min(hx, inner - half + size * .02)) : Math.min(w - size * .09, Math.max(hx, inner + half - size * .02)); hx = mix(hx, spotX, clear); }
    const arrive = still ? 1 : smooth((seconds - this.entered) / .38); if (arrive < 1 && !playing) { hx -= sign * w * .22 * (1 - arrive); alpha = arrive; }

    const rotation = flight ? shotBallRotation(t, this.hero, risk, timing.result, !!held) : 0; let drawn = 0;
    const balls = this.assets.frames.get('ball')!;
    const drawBall = () => {
      if (celebrating) return; drawn++;
      if (!flight) {
        // A new ball settles on the spot when the next decision opens.
        const rr = shotBallRadius(h, risk), since = this.ballDrop > 0 && !still ? seconds - this.ballDrop : 9, lift = since < .5 ? Math.abs(Math.cos(since * 9)) * Math.exp(-since * 6) * h * .10 : 0;
        c.save(); c.fillStyle = `rgba(16,42,35,${.5 - Math.min(.3, lift / h * 4)})`; c.beginPath(); c.ellipse(from.x, from.y + rr * .88, rr * 1.15, rr * .28, 0, 0, Math.PI * 2); c.fill(); c.restore();
        drawFootball(c, balls, from.x, from.y - lift, rr, lift / h * 20 * sign, clamp(since * 9)); this.stats.ball = from; return;
      }
      let bx = p.x, by = p.y, a = 1; const after = Math.max(0, sinceResult);
      if (sinceResult >= 0 && shot?.goal) { const inside = goalBallPosition(goal, { x: zone.x, y: zone.y, age: netAge }, r); bx = inside.x; by = inside.y; }
      if (after && shot?.finish === 'post') { const floor = goal.bottom + h * .03, bar = target.y <= goal.bottom - goal.height + 1; bx += side * Math.min(after, 1.2) * goal.width * (bar ? .10 : .26); by = Math.min(floor, by + goal.height * ((bar ? -1.5 : -.6) * after + 3.2 * after * after)); }
      if (after && shot?.finish === 'wide' && !wallHit) { bx += side * clamp(after / .6) * goal.width * .22; if (zone.row === 0) by -= clamp(after / .6) * goal.height * .25; a = 1 - clamp(after / .7); }
      if (held) { bx = held.x; by = held.y; }
      if (!held && sinceResult < .02) {
        // The trail uses the same path, so curl around or over the wall stays visible.
        const speed = timing.flightEnd - PENALTY_CONTACT;
        for (let i = 9; i >= 1; i--) { const u = raw - i * .013 / speed; if (u <= 0) continue; const q = ballAt(u), rr = shotBallRadius(h, risk, q.u, wallHit); c.globalAlpha = .30 * (1 - i / 10); c.fillStyle = '#fffef0'; c.beginPath(); c.arc(q.x, q.y, rr * (1 - i * .055), 0, Math.PI * 2); c.fill(); } c.globalAlpha = 1;
      }
      if (!held && a > .3 && (!shot?.goal || sinceResult < .2)) { const gy = mix(from.y + shotBallRadius(h, risk) * .9, goal.bottom, clamp(p.u)), up = clamp((gy - by) / (h * .4)); c.fillStyle = `rgba(16,42,30,${.34 - up * .2})`; c.beginPath(); c.ellipse(bx, Math.max(gy, by + r * .8), r * (1 + up * .5), r * .26, 0, 0, Math.PI * 2); c.fill(); }
      drawFootball(c, balls, bx, by, r, rotation, a); this.stats.ball = { x: bx, y: by };
    };
    if (afterGoal || !playing && this.mode === 'shot' && view?.status === 'playing') this.once('ball', () => { this.ballDrop = seconds; });
    if (playing) this.ballDrop = -9;
    const behindWall = !!wall && flight && p.u > crossing && !wallHit, atGoal = flight && progress >= .985 && !wallHit && !(shot?.finish === 'post' && sinceResult > 0);
    if (atGoal) drawBall();
    drawGoalFrame(c, shownGoal);
    if (behindWall && !atGoal) drawBall();
    if (oldWall) this.wall(oldWall, -1, false, seconds, 1 - smooth(k * 1.8));
    const party = celebrating ? still || !state.busy ? 0 : 1 - smooth((this.mode === 'celebrate' ? t : t - timing.celebration) / .5) : 1;
    if (wall && party > .01) this.wall(wall, playing ? progress : -1, wallHit && playing, seconds, party * (this.move.oldRisk !== risk ? smooth((k - .35) / .6) : 1));
    if (!behindWall && !atGoal) drawBall();
    this.drawHero(pose, hx, footY, size, air, alpha, sx, sy, celebrating);
    this.fx.draw(c, ['grass', 'dust', 'spark']);
    c.restore();
    const shade = c.createLinearGradient(0, h * .72, 0, h); shade.addColorStop(0, '#071b1500'); shade.addColorStop(1, '#071b1577'); c.fillStyle = shade; c.fillRect(0, h * .72, w, h * .28);
    const sky = c.createLinearGradient(0, 0, 0, Math.min(150, h * .28)); sky.addColorStop(0, '#0a234068'); sky.addColorStop(1, '#0a234000'); c.fillStyle = sky; c.fillRect(0, 0, w, Math.min(150, h * .28));
    this.fx.draw(c, ['paper']);
    Object.assign(this.stats, { pose, hx, footY, size, alpha, zoom: this.camera.zoom, goal, w, h, r, ballDraws: drawn, particles: this.fx.count, cam: { x: this.camera.x, y: this.camera.y } });
  }
  private lastSpot = { distance: 11, cameraX: 0 };
  private drawHero(pose: number, x: number, bottom: number, size: number, air: number, alpha: number, sx: number, sy: number, celebrating: boolean) {
    if (alpha <= .01) return; const c = this.ctx, lift = clamp(air / (size * .16));
    c.fillStyle = `rgba(23,39,29,${(.26 - lift * .12) * alpha})`; c.beginPath(); c.ellipse(x, bottom - size * .02, size * (.21 - lift * .03), size * .045, 0, 0, Math.PI * 2); c.fill();
    this.sprite(this.hero, { cell: pose, x, bottom: bottom - air, size, alpha, sx, sy, grounded: celebrating && this.hero === 'leo' });
  }
  destroy() { this.alive = false; this.fx.clear(); }
}
