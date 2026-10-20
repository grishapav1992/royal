import { t as translateText, tr } from '../i18n/index';
export type ThemedGameId = 'royal-flight' | 'royal-wheel';
export type ThemedArtState = {
  phase: 'idle' | 'pending' | 'active' | 'cashed_out' | 'crashed';
  multiplier: number;
  rotation: number;
  multipliers: readonly number[];
  selectedSegment: number | null;
};
const TAU = Math.PI * 2;
const SEGMENTS = 50;
const STEP = TAU / SEGMENTS;

/** Segment centers start at twelve o'clock, matching the fixed pointer. */
export function wheelLandingRotation(from: number, segment: number, turns = 5) {
  const target = ((-segment * STEP) % TAU + TAU) % TAU;
  return from + ((target - from % TAU + TAU) % TAU) + turns * TAU;
}
export function wheelSegmentAtPointer(rotation: number) {
  return ((Math.round(-rotation / STEP) % SEGMENTS) + SEGMENTS) % SEGMENTS;
}

/** Original Royal canvas artwork, inspired by Flameout's layered flight presentation. */
export class ThemedGameArt {
  private context: CanvasRenderingContext2D;
  private state: ThemedArtState = { phase: 'idle', multiplier: 1, rotation: 0, multipliers: [], selectedSegment: null };
  private frame = 0;
  private alive = true;
  private width = 920;
  private height = 520;
  private dpr = 1;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private observer: ResizeObserver;
  private terminalAt = 0;
  private shipImage?: HTMLImageElement;
  private visibility = () => { cancelAnimationFrame(this.frame); if (!document.hidden) this.loop(); };
  private motion = () => this.draw(performance.now());

  constructor(private canvas: HTMLCanvasElement, private gameId: ThemedGameId) {
    this.context = canvas.getContext('2d')!;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    document.addEventListener('visibilitychange', this.visibility);
    this.reduced.addEventListener('change', this.motion);
    if (gameId === 'royal-flight') {
      const image = new Image();
      image.onload = () => { if (this.alive) { this.shipImage = image; this.draw(performance.now()); } };
      image.src = '/assets/royal-orbit-ship.png';
    }
    this.resize(); this.loop();
  }
  update(state: Partial<ThemedArtState>) {
    if (state.phase && state.phase !== this.state.phase && ['crashed', 'cashed_out'].includes(state.phase)) this.terminalAt = performance.now();
    this.state = { ...this.state, ...state };
    if (this.gameId === 'royal-wheel') {
      this.canvas.dataset.rotation = String(this.state.rotation);
      this.canvas.dataset.segment = this.state.selectedSegment === null ? '' : String(this.state.selectedSegment);
      this.canvas.setAttribute('aria-label', this.state.selectedSegment === null ? translateText('Колесо Royal Fortune, 50 секторов') : tr`Колесо Royal Fortune: сектор ${this.state.selectedSegment + 1} из 50, ${this.state.multipliers[this.state.selectedSegment]}×`);
    }
    this.draw(performance.now());
  }
  destroy() {
    this.alive = false; cancelAnimationFrame(this.frame); this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motion);
  }
  private resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.width = Math.max(1, bounds.width); this.height = Math.max(1, bounds.height);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.draw(performance.now());
  }
  private loop = () => {
    if (!this.alive || document.hidden) return;
    this.draw(performance.now()); this.frame = requestAnimationFrame(this.loop);
  };
  private draw(now: number) {
    const c = this.context, scale = this.gameId === 'royal-wheel' ? Math.min(this.width / 540, this.height / 520) : Math.max(this.width / 920, this.height / 520);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = '#080e1d'; c.fillRect(0, 0, this.width, this.height);
    c.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * (this.width - 920 * scale) / 2, this.dpr * (this.height - 520 * scale) / 2);
    if (this.gameId === 'royal-flight') this.flight(c, this.reduced.matches ? 0 : now);
    else this.wheel(c, this.reduced.matches ? 0 : now);
  }
  private flight(c: CanvasRenderingContext2D, now: number) {
    const active = this.state.phase === 'active', t = now / 1000;
    const sky = c.createLinearGradient(0, 0, 920, 520);
    sky.addColorStop(0, '#05091b'); sky.addColorStop(.5, '#172043'); sky.addColorStop(1, '#273657');
    c.fillStyle = sky; c.fillRect(0, 0, 920, 520);
    for (let cloud = 0; cloud < 3; cloud++) {
      const x = 360 + cloud * 210, y = 55 + cloud * 80;
      const mist = c.createRadialGradient(x, y, 1, x, y, 260);
      mist.addColorStop(0, cloud === 1 ? '#714fb82b' : '#408abb22'); mist.addColorStop(1, '#00000000');
      c.fillStyle = mist; c.fillRect(0, 0, 920, 520);
    }
    for (let i = 0; i < 145; i++) {
      const depth = 1 + i % 3, drift = active ? t * 12 * depth : t * depth;
      const x = ((i * 157.31 - drift) % 960 + 960) % 960 - 20, y = (i * 97.13) % 510;
      c.globalAlpha = .35 + .45 * ((Math.sin(t + i * 1.7) + 1) / 2);
      c.fillStyle = i % 9 === 0 ? '#d8b7ff' : '#e8f6ff';
      if (active && depth === 3) c.fillRect(x, y, 4, 1); else c.fillRect(x, y, depth * .7, depth * .7);
    }
    c.globalAlpha = 1;
    const moon = c.createRadialGradient(770, 98, 3, 790, 105, 46);
    moon.addColorStop(0, '#fcdfb3'); moon.addColorStop(.65, '#926682'); moon.addColorStop(1, '#2f274d');
    c.fillStyle = moon; c.beginPath(); c.arc(785, 105, 45, 0, TAU); c.fill();
    c.fillStyle = '#070e27cc'; c.beginPath(); c.arc(804, 96, 44, 0, TAU); c.fill();
    const earthGlow = c.createRadialGradient(165, 670, 310, 165, 670, 490);
    earthGlow.addColorStop(0, '#082947'); earthGlow.addColorStop(.79, '#136395'); earthGlow.addColorStop(.81, '#78d7f3aa'); earthGlow.addColorStop(.88, '#5996d226'); earthGlow.addColorStop(1, '#00000000');
    c.fillStyle = earthGlow; c.fillRect(0, 0, 920, 520);
    c.save(); c.translate(165, 670); c.rotate(-.33);
    c.strokeStyle = '#b6e5ff18'; c.lineWidth = 2;
    for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(0, 0, 388 + i * 13, 260 + i * 18, 0, Math.PI, TAU); c.stroke(); }
    c.restore();
    const path = c.createLinearGradient(150, 415, 655, 180); path.addColorStop(0, '#3d8cca00'); path.addColorStop(1, '#7ddfffee');
    c.strokeStyle = path; c.lineWidth = 1.2; c.setLineDash([4, 9]);
    c.beginPath(); c.moveTo(100, 455); c.bezierCurveTo(290, 435, 370, 215, 659, 184); c.stroke(); c.setLineDash([]);
    const terminal = now && this.terminalAt ? Math.min(1, (performance.now() - this.terminalAt) / 1300) : 1;
    const shipX = 623, shipY = 204 + (active ? Math.sin(t * 1.8) * 4 : Math.sin(t) * 2);
    if (this.state.phase === 'crashed') {
      if (terminal < 1) {
        c.save(); c.globalAlpha = 1 - terminal;
        for (let i = 0; i < 28; i++) { const angle = i * 2.4, radius = 20 + terminal * (55 + i * 3); c.fillStyle = i % 2 ? '#ffd7a8' : '#b586ff'; c.beginPath(); c.arc(shipX + Math.cos(angle) * radius, shipY + Math.sin(angle) * radius, (1 - terminal) * 4 + 1, 0, TAU); c.fill(); }
        c.restore();
      }
    } else {
      const depart = this.state.phase === 'cashed_out' ? terminal * 160 : 0;
      c.save(); c.translate(shipX + depart, shipY - depart * .34); c.rotate(-.1);
      if (active || this.state.phase === 'cashed_out') {
        const flame = c.createLinearGradient(-170, 0, -40, 0); flame.addColorStop(0, '#6478ff00'); flame.addColorStop(.5, '#759aff88'); flame.addColorStop(.9, '#a2e7ff'); flame.addColorStop(1, '#ffffff');
        c.fillStyle = flame; c.beginPath(); c.moveTo(-42, -7); c.quadraticCurveTo(-105, -20, -175 - Math.sin(t * 20) * 10, 0); c.quadraticCurveTo(-100, 15, -42, 7); c.fill();
      }
      if (this.shipImage) c.drawImage(this.shipImage, -85, -42.5, 170, 85);
      else this.ship(c);
      c.restore();
    }
    c.fillStyle = '#a8ccdd99'; c.font = '10px sans-serif'; c.letterSpacing = '2px';
    c.fillText('ROYAL AEROSPACE', 110, 482); c.letterSpacing = '0px';
    c.strokeStyle = '#9ed7f544'; c.lineWidth = 1; c.beginPath(); c.moveTo(110, 465); c.lineTo(216, 465); c.moveTo(886, 470); c.lineTo(886, 432); c.stroke();
  }
  private ship(c: CanvasRenderingContext2D) {
    c.shadowColor = '#8ce4ff'; c.shadowBlur = 18;
    const body = c.createLinearGradient(0, -24, 0, 25); body.addColorStop(0, '#f6eee0'); body.addColorStop(.4, '#acc4d6'); body.addColorStop(1, '#405275');
    c.fillStyle = '#514278'; c.strokeStyle = '#e6c285'; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(12, 0); c.lineTo(-48, -48); c.lineTo(-57, -42); c.lineTo(-37, -2); c.lineTo(-56, 42); c.lineTo(-43, 43); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = body; c.beginPath(); c.moveTo(75, 0); c.bezierCurveTo(45, -22, -9, -18, -48, -10); c.lineTo(-52, 10); c.bezierCurveTo(-7, 18, 40, 19, 75, 0); c.fill(); c.stroke();
    c.shadowBlur = 0; c.fillStyle = '#1d3553'; c.beginPath(); c.ellipse(31, -3, 20, 9, -.08, 0, TAU); c.fill();
    c.strokeStyle = '#91e9ff'; c.beginPath(); c.moveTo(13, -5); c.quadraticCurveTo(30, -13, 48, -3); c.stroke();
    c.fillStyle = '#ffe1a5'; c.fillRect(-37, -5, 10, 3); c.fillRect(-37, 4, 10, 3);
  }
  private wheel(c: CanvasRenderingContext2D, now: number) {
    const background = c.createRadialGradient(460, 260, 30, 460, 260, 510);
    background.addColorStop(0, '#202d45'); background.addColorStop(.6, '#0c192c'); background.addColorStop(1, '#050c17');
    c.fillStyle = background; c.fillRect(0, 0, 920, 520);
    c.strokeStyle = '#c1a16425'; c.lineWidth = 1;
    for (let side = 0; side < 2; side++) {
      c.save(); if (side) { c.translate(920, 0); c.scale(-1, 1); }
      for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(28 + i * 12, 490); c.lineTo(28 + i * 12, 110 + i * 17); c.lineTo(200, 18 + i * 14); c.stroke(); }
      c.restore();
    }
    c.save(); c.translate(460, 268);
    const outer = c.createRadialGradient(0, 0, 190, 0, 0, 222);
    outer.addColorStop(0, '#dfbc74'); outer.addColorStop(.38, '#725d3b'); outer.addColorStop(.56, '#f5d892'); outer.addColorStop(.79, '#a08149'); outer.addColorStop(1, '#302a23');
    c.shadowColor = '#f8ca6830'; c.shadowBlur = 30; c.fillStyle = outer; c.beginPath(); c.arc(0, 0, 220, 0, TAU); c.fill(); c.shadowBlur = 0;
    c.strokeStyle = '#f8dda6'; c.lineWidth = .8; c.beginPath(); c.arc(0, 0, 213, 0, TAU); c.stroke();
    for (let i = 0; i < 50; i++) {
      const angle = i * STEP, pulse = .6 + .4 * Math.sin(now / 750 + i * .45);
      c.fillStyle = `rgba(255,227,169,${pulse})`; c.beginPath(); c.arc(Math.sin(angle) * 209, -Math.cos(angle) * 209, 1.9, 0, TAU); c.fill();
    }
    c.save(); c.rotate(this.state.rotation);
    for (let i = 0; i < 50; i++) {
      const a = i * STEP - Math.PI / 2, value = this.state.multipliers[i] ?? 0;
      c.fillStyle = value >= 10 ? '#ddbd79' : value >= 2 ? '#8f7450' : value > 0 ? '#324960' : '#122239';
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 197, a - STEP / 2, a + STEP / 2); c.closePath(); c.fill();
      c.strokeStyle = '#d7bb7038'; c.lineWidth = .7; c.stroke();
      if (i === this.state.selectedSegment) { c.fillStyle = '#fff2b43d'; c.fill(); c.strokeStyle = '#ffe9a9'; c.lineWidth = 2; c.stroke(); }
      c.save(); c.rotate(a); c.translate(167, 0); c.rotate(Math.PI / 2);
      c.font = `600 ${value >= 10 ? 12 : 11}px sans-serif`; c.textAlign = 'center'; c.fillStyle = value >= 10 ? '#192338' : '#eee3c5'; c.fillText(`${value}×`, 0, 4); c.restore();
    }
    c.restore();
    c.fillStyle = '#111c30'; c.strokeStyle = '#ceae6c'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 80, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = '#ceae6c60'; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, 73, 0, TAU); c.stroke();
    c.fillStyle = '#e5c787'; c.textAlign = 'center'; c.font = '14px serif'; c.letterSpacing = '3px'; c.fillText('ROYAL', 0, -4); c.font = '12px sans-serif'; c.letterSpacing = '2px'; c.fillText('FORTUNE', 0, 17); c.letterSpacing = '0px';
    c.beginPath(); c.moveTo(0, -53); c.lineTo(7, -42); c.lineTo(0, -31); c.lineTo(-7, -42); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-28, 35); c.lineTo(0, 43); c.lineTo(28, 35); c.stroke();
    c.restore();
    c.fillStyle = '#f8df9c'; c.strokeStyle = '#9e7945'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(449, 40); c.lineTo(471, 40); c.lineTo(460, 80); c.closePath(); c.fill(); c.stroke();
  }
}
