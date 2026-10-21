import { drawGoalFrame, drawGoalNet } from './crLeoGoal';
import { extractSpriteFrames, type SpriteFrame } from './crLeoSprites';
import { penaltyZone, shotZone, type PenaltyHero, type PenaltyRisk, type PenaltyView } from '../shared/crLeo';
import { celebrationPose, flightPosition, keeperPlacement, PENALTY_CELEBRATION, PENALTY_CONTACT, shotPose, shotTarget, shotTiming, shotBallRadius, strikePlacement } from './crLeoTimeline';
import { freeKickFlight, isWallHit, shotLayout, wallMotion, wallCrossing, type FreeKickWall } from './crLeoFreeKick';

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export class CrLeoScene {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();
  private frames = new Map<string, SpriteFrame[]>();
  private hero: PenaltyHero = 'cr';
  private previewRisk: PenaltyRisk = 'safe';
  private celebrationRisk?: PenaltyRisk;
  private view?: PenaltyView;
  private started = 0;
  private mode: 'idle' | 'shot' | 'celebrate' | 'restored' = 'idle';
  private fired = new Set<string>();
  private alive = true;
  private painted = '';
  private renderedFrames = 0;
  private presentationRevision = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(private canvas: HTMLCanvasElement, private sound: (event: 'kick' | 'goal' | 'post' | 'save' | 'wall' | 'celebrate') => void) {
    this.ctx = canvas.getContext('2d')!;
    canvas.dataset.renderer = 'canvas2d'; canvas.dataset.assets = '0';
    for (const name of ['stadium', 'stadium-free', 'cr', 'leo', 'keeper', 'keeper-reach', 'keeper-dive', 'wall', 'wall-far']) {
      const img = new Image(); img.onload = () => { if (!this.alive) return; try { if (!name.startsWith('stadium')) this.frames.set(name, extractSpriteFrames(img, name.startsWith('keeper-') || name.startsWith('wall') ? 2 : 4, name.startsWith('keeper') || name.startsWith('wall') ? 2 : 4, name === 'cr' || name.startsWith('wall'), name === 'keeper' ? [undefined,undefined,'left','left',undefined,'right','right',undefined] : name === 'keeper-reach' ? ['left','right','high','center'] : name === 'keeper-dive' ? ['left','right','left','right'] : undefined, name === 'wall-far' ? 3 : name === 'wall' ? 5 : 1)); } catch { canvas.dataset.assetError = name; return; } this.images.set(name, img); canvas.dataset.spriteFrames = String([...this.frames.values()].reduce((n, a) => n + a.length, 0)); canvas.dataset.assets = String(this.images.size); }; img.onerror = () => { if (this.alive) canvas.dataset.assetError = name; }; img.src = '/assets/cr-vs-leo/v1/' + (name === 'cr' ? 'cr-white' : name) + (name === 'keeper' ? '-empty' : '') + '.png';
    }
  }
  ready() { return this.images.size === 9; }
  select(hero: PenaltyHero, risk = this.previewRisk) { this.presentationRevision++; this.hero = hero; this.previewRisk = risk; this.mode = 'idle'; this.view = undefined; this.celebrationRisk = undefined; }
  chooseRisk(risk: PenaltyRisk) { this.presentationRevision++; this.previewRisk = risk; }
  show(view: PenaltyView, animate: boolean, cashout = false) {
    this.presentationRevision++;
    this.celebrationRisk = cashout ? this.previewRisk : undefined;
    this.hero = view.hero; this.previewRisk = this.celebrationRisk ?? view.risk; this.view = structuredClone(view); this.started = performance.now(); this.fired.clear();
    this.mode = !animate || this.reduced ? 'restored' : cashout ? 'celebrate' : 'shot';
  }
  private emit(name: 'kick' | 'goal' | 'post' | 'save' | 'wall' | 'celebrate') { if (!this.fired.has(name)) { this.fired.add(name); this.sound(name); } }
  state(now = performance.now()) {
    const t = (now - this.started) / 1000;
    const paid = this.view?.status === 'complete', lost = this.view?.status === 'lost';
    const timing = shotTiming(this.view?.risk ?? this.previewRisk, this.view?.shots.at(-1));
    const duration = this.mode === 'celebrate' ? PENALTY_CELEBRATION : this.mode === 'shot' ? paid ? timing.celebration + PENALTY_CELEBRATION : lost ? timing.result + 2.3 : timing.ready : 0;
    return { busy: t < duration, reveal: this.mode !== 'shot' || t >= timing.result, phase: this.mode === 'shot' && t < timing.result ? 'shooting' : this.view?.status ?? 'idle', t };
  }
  private wall(wall: FreeKickWall, u: number, hit: boolean) {
    const name = wall.count === 3 ? 'wall-far' : 'wall', motion = wallMotion(u, wall.height, hit, wall.crossing), frame = this.frames.get(name)?.[motion.row];
    if (!frame) return;
    const reference = this.frames.get(name)?.[0] ?? frame;
    const size = wall.count === 3 ? wall.size * .90 / reference.height : wall.count * wall.spacing / reference.width, c = this.ctx;
    c.fillStyle = '#17271d35';
    for (let i = 0; i < wall.count; i++) { c.beginPath(); c.ellipse(wall.x + (i-(wall.count-1)/2)*wall.spacing, wall.bottom + 1, wall.spacing*.48, wall.height*.009, 0, 0, Math.PI*2); c.fill(); }
    const shake = hit && u >= wall.crossing ? Math.sin((u-wall.crossing)*40)*Math.max(0,1-(u-wall.crossing)*4)*wall.height*.007 : 0;
    this.sprite(name, motion.row, wall.x + shake, wall.bottom-motion.jump, size, 2, 2, 1, true);
  }
  private sprite(name: string, cell: number, x: number, bottom: number, size: number, cols = 4, rows = 4, alpha = 1, grounded = false) {
    const img = this.images.get(name); if (!img) return;
    const c = this.ctx, sw = img.width / cols, sh = img.height / rows;
    c.save(); c.globalAlpha = alpha; const frame = this.frames.get(name)?.[cell], pivot = grounded && frame ? frame.y + frame.height : .94; if (frame) c.drawImage(frame.image, x - size / 2 + frame.x * size, bottom - size * pivot + frame.y * size, frame.width * size, frame.height * size); else c.drawImage(img, (cell % cols) * sw, Math.floor(cell / cols) * sh, sw, sh, x - size / 2, bottom - size * .94, size, size); c.restore();
  }
  private ball(x: number, y: number, radius: number, rotation: number, alpha = 1) {
    const c = this.ctx; c.save(); c.globalAlpha = alpha; c.translate(x, y); c.rotate(rotation);
    const g = c.createRadialGradient(-radius * .3, -radius * .4, 1, 0, 0, radius); g.addColorStop(0, '#ffffff'); g.addColorStop(.65, '#eeeeea'); g.addColorStop(1, '#939e9c'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#17242a'; for (let i = 0; i < 5; i++) { const a = i * Math.PI * .4; c.beginPath(); c.moveTo(Math.cos(a) * radius * .65, Math.sin(a) * radius * .65); c.lineTo(Math.cos(a + .45) * radius * .45, Math.sin(a + .45) * radius * .45); c.lineTo(Math.cos(a - .45) * radius * .45, Math.sin(a - .45) * radius * .45); c.fill(); } c.restore();
  }
  paint(now: number) {
    if (!this.alive) return;
    const canvas = this.canvas, w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const state = this.state(now), t = state.t, view = this.view, shot = view?.shots.at(-1), timing = shotTiming(shot?.risk ?? view?.risk ?? this.previewRisk, shot), playing = this.mode === 'shot' && !(view?.status === 'playing' && t >= timing.ready);
    const celebrating = this.mode === 'celebrate' || playing && view?.status === 'complete' && t >= timing.celebration || this.mode === 'restored' && (view?.status === 'banked' || view?.status === 'complete');
    const risk = celebrating && this.celebrationRisk ? this.celebrationRisk : playing || celebrating || this.mode === 'restored' && view?.status === 'lost' ? shot?.risk ?? view?.risk ?? this.previewRisk : this.previewRisk;
    const paintKey = JSON.stringify([w,h,dpr,this.images.size,this.hero,risk,view?.revision,this.mode,playing,celebrating,this.presentationRevision,state.busy?now:0]);
    if (this.painted === paintKey) return;
    this.painted = paintKey; canvas.dataset.renderedFrames = String(++this.renderedFrames);
    const c = this.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const layout = shotLayout(w, h, this.hero, risk), wallHit = layout.free && isWallHit(shot, risk), goalX = layout.goal.x, gw = layout.goal.width, gb = layout.goal.bottom, gh = layout.goal.height, keeperScale = layout.keeperScale;
    const bg = this.images.get(layout.free ? 'stadium-free' : 'stadium'); if (bg) c.drawImage(bg, 0, 0, w, h); else { c.fillStyle = '#346d35'; c.fillRect(0, 0, w, h); }
    const ct = this.mode === 'celebrate' ? t : this.mode === 'restored' ? PENALTY_CELEBRATION : t - timing.celebration;
    const shotTime = playing ? t : 0, flight = playing && shot && t >= PENALTY_CONTACT;
    const geometry = { x: goalX, bottom: gb, width: gw, height: gh }, zone = shot ? shotZone(shot, view?.risk) : penaltyZone(13), side = zone.side;
    const netImpact = flight && shot.goal && t >= timing.result ? { x: zone.x, y: zone.y, age: t-timing.result } : undefined;
    // Ground lines use the same goal geometry and always remain behind the players.
    const boxFront = layout.far ? h*.61 : layout.near ? h*.73 : gb+h*.20;
    c.strokeStyle = '#ffffff90'; c.lineWidth = 2; c.beginPath(); c.moveTo(goalX - gw * .7, gb + h * .025); c.lineTo(goalX - gw * 1.05, boxFront); c.lineTo(goalX + gw * 1.05, boxFront); c.lineTo(goalX + gw * .7, gb + h * .025); c.stroke();
    if (layout.free) { c.beginPath(); c.moveTo(goalX-gw*.32,boxFront); c.quadraticCurveTo(goalX,boxFront+h*.085,goalX+gw*.32,boxFront); c.stroke(); }
    drawGoalNet(c, geometry, netImpact);
    const target = shot ? shotTarget(shot, geometry) : { x: goalX, y: gb };
    const keeperReadyX = goalX + (layout.free ? (this.hero === 'cr' ? 1 : -1) * gw * .31 : 0);
    let keeperName = 'keeper', keeperFrame = 0, kx = keeperReadyX, ky = gb + h * .025 * keeperScale, ks = h * .27 * keeperScale;
    let caughtBall: {x:number;y:number} | undefined;
    if (flight && shot && !celebrating && !wallHit) {
      const reaction = shot.goal ? penaltyZone(zone.row * 6 + (side > 0 ? 0 : 5)) : zone;
      const central = reaction.column === 2 || reaction.column === 3, high = reaction.row === 0, reach = high || central;
      const catchName = reach ? 'keeper-reach' : 'keeper-dive', catchCell = reach ? high ? central ? 2 : reaction.side < 0 ? 0 : 1 : 3 : (reaction.row === 1 ? 0 : 2) + (reaction.side < 0 ? 0 : 1);
      const landName = central ? 'keeper-reach' : 'keeper', landCell = central ? 3 : reaction.side < 0 ? 3 : 6;
      const sizeFor = (name: string) => h * .27 * keeperScale * (name.startsWith('keeper-') ? .78 : 1);
      const handFor = (name: string, cell: number) => this.frames.get(name)?.[cell]?.hand ?? { x: central ? .5 : reaction.side < 0 ? .18 : .88, y: high ? .15 : .67 };
      const destination = { x: goalX - gw / 2 + gw * reaction.x, y: gb - gh + gh * reaction.y };
      const landedSize = sizeFor(landName), landedHand = handFor(landName, landCell), landX = central ? destination.x : goalX + reaction.side * gw * .30, landY = gb + h * .05 * keeperScale;
      const landBall = { x: landX + (landedHand.x - .5) * landedSize, y: landY + (landedHand.y - .94) * landedSize };
      const u = clamp((t - PENALTY_CONTACT) / (timing.flightEnd - PENALTY_CONTACT)), settle = clamp((t - timing.result - .15) / .55);
      keeperName = settle > .35 ? landName : catchName; keeperFrame = settle > .35 ? landCell : catchCell; ks = sizeFor(keeperName);
      const glove = { x: destination.x + (landBall.x - destination.x) * settle, y: destination.y + (landBall.y - destination.y) * settle };
      const placement = keeperPlacement(glove, handFor(keeperName, keeperFrame), ks), travel = 1 - (1 - u) ** 2;
      kx += (placement.x - kx) * travel; ky += (placement.bottom - ky) * travel - Math.sin(Math.PI * u) * h * .025 * keeperScale;
      if (shot.finish === 'save' && t >= timing.result) caughtBall = glove;
      if (u < .15) { keeperName = 'keeper'; keeperFrame = reaction.side < 0 ? 1 : 4; ks = h * .27 * keeperScale; }
      if (shot.goal && t > timing.result + .8) { keeperName = 'keeper'; keeperFrame = 7; kx = keeperReadyX; ky = gb + h * .025 * keeperScale; ks = h * .27 * keeperScale; }
    }
    if (celebrating) keeperFrame = 7;
    this.sprite(keeperName, keeperFrame, kx, ky, ks, keeperName.startsWith('keeper-') ? 2 : 4, 2);
    let heroSize = h * (this.hero === 'cr' ? .59 : .55), footY = h * .93;
    const sign = this.hero === 'cr' ? 1 : -1;
    const run = playing ? clamp((t - .46) / (PENALTY_CONTACT - .46)) : 0;
    const from = layout.ball, strike = strikePlacement(this.hero, from, heroSize);
    let hx = from.x - sign * heroSize * .34; hx += (strike.x - hx) * run; footY += (strike.bottom - footY) * run;
    if (layout.free && playing && !celebrating) {
      const step = clamp((t-PENALTY_CONTACT-.08)/.34), ease = step*step*(3-2*step);
      hx -= sign*heroSize*.46*ease; footY -= h*.015*ease;
    }
    let pose = this.mode === 'restored' && view?.status === 'lost' ? 14 : playing ? shotPose(t, this.hero, shot, risk) : 0;
    if (celebrating) {
      pose = celebrationPose(ct, this.hero); hx = goalX; heroSize *= 1.06; footY = h * .94;
      if (this.hero === 'cr' && ct >= .80 && ct < 1.35) footY -= Math.sin(clamp((ct - .80) / .55) * Math.PI) * h * .07;
    }
    const progress = (shotTime-PENALTY_CONTACT)/(timing.flightEnd-PENALTY_CONTACT);
    const p = layout.wall && shot ? freeKickFlight(progress,from,target,layout.wall,shot) : flightPosition(shotTime, from, target, zone.row === 2 ? .025 : zone.row === 1 ? .12 : .30, side * gw * (zone.column === 0 || zone.column === 5 ? .025 : .008));
    const crossing = wallCrossing(risk);
    const r = shotBallRadius(h, risk, p.u, wallHit);
    let ballDraws = 0;
    const drawBall = () => { if (!celebrating) {
      ballDraws++;
      if (!flight) this.ball(from.x, from.y, shotBallRadius(h, risk), 0);
      else {
        let bx = p.x, by = p.y, alpha = 1;
        if (t > timing.result && shot?.goal) by = Math.min(gb - r, by + clamp((t - timing.result) / .4) * gh * .3);
        if (t > timing.result && shot?.finish === 'post') { bx -= side * clamp((t - timing.result) / .6) * gw * .23; by += clamp((t - timing.result) / .6) * h * .12; }
        if (t > timing.result && shot?.finish === 'wide' && !wallHit) { bx += side * clamp((t - timing.result) / .6) * gw * .22; if (zone.row === 0) by -= clamp((t - timing.result) / .6) * gh * .25; alpha = 1 - clamp((t - timing.result) / .7); }
        if (caughtBall) { bx = caughtBall.x; by = caughtBall.y; }
        this.ball(bx, by, r, t * 17, alpha);
      }
    } };
    const behindWall = !!layout.wall && !!flight && p.u > crossing && !wallHit;
    const atGoal = !!flight && progress >= .985 && !wallHit;
    if (atGoal) drawBall();
    drawGoalFrame(c, geometry);
    if (behindWall && !atGoal) drawBall();
    if (layout.wall) this.wall(layout.wall, playing ? progress : -1, wallHit && !!playing);
    c.fillStyle = '#17271d42'; c.beginPath(); c.ellipse(hx, footY - heroSize * .02, heroSize * .21, heroSize * .045, 0, 0, Math.PI * 2); c.fill();
    this.sprite(this.hero, pose, hx, footY, heroSize, 4, 4, 1, celebrating && this.hero === 'leo');
    if (!behindWall && !atGoal) drawBall();
    const shade = c.createLinearGradient(0, h * .72, 0, h); shade.addColorStop(0, '#071b1500'); shade.addColorStop(1, '#071b1577'); c.fillStyle = shade; c.fillRect(0, h * .72, w, h * .28);
    canvas.dataset.ballDraws = String(ballDraws); canvas.dataset.ballHeld = String(!!caughtBall);
    canvas.dataset.ballRadius = String(flight ? r : shotBallRadius(h,risk));
    canvas.dataset.goalGeometry = JSON.stringify(geometry); canvas.dataset.netMoving = String(!!netImpact && netImpact.age > 0 && netImpact.age < .8);
    canvas.dataset.hero = this.hero; canvas.dataset.pose = String(pose); canvas.dataset.phase = state.phase; canvas.dataset.reveal = String(state.reveal); canvas.dataset.kickingFoot = this.hero === 'cr' ? 'right' : 'left';
    canvas.dataset.zone = shot && state.reveal ? String(zone.id) : ''; canvas.dataset.keeperPose = keeperName + ':' + keeperFrame;
    canvas.dataset.scene = layout.far ? 'far-free-kick' : layout.near ? 'near-free-kick' : 'penalty'; canvas.dataset.wallCount = String(layout.wall?.count ?? 0);
    canvas.dataset.wallPose = layout.wall ? String(wallMotion(playing?progress:-1,h,wallHit,crossing).row) : '';
    canvas.dataset.route = layout.wall && shot && state.reveal ? freeKickFlight(progress,from,target,layout.wall,shot).route : '';
    canvas.dataset.ballLayer = behindWall ? 'behind-wall' : 'front';
    if (playing && t >= PENALTY_CONTACT) this.emit('kick');
    if (playing && t >= timing.result && shot) this.emit(shot.goal ? 'goal' : wallHit ? 'wall' : shot.finish === 'post' ? 'post' : 'save');
    if (celebrating && this.mode !== 'restored') this.emit('celebrate');
  }
  destroy() { this.alive = false; for (const image of this.images.values()) { image.onload = null; image.onerror = null; } this.images.clear(); this.frames.clear(); }
}
