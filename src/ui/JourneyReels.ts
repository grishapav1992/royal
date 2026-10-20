import { t as translateText, tr } from '../i18n/index';
import { STUDIO_INFO, studioStrip } from '../shared/studioGames';
import { journeySymbol, JOURNEY_SYMBOL_NAMES, type JourneySlotGame } from './JourneyArtwork';
type Reel = { root: HTMLElement; track: HTMLElement; cells: HTMLElement[]; offset: number; stopped: boolean; stop?: { at: number; from: number; target: number } };
export type JourneyPin = { position: number; symbol: number };
const ITEMS = 20, ACCELERATE = 350, MIN_SPIN = 850, STOP = 530, GAP = 155;

export class JourneyReels {
  private reels: Reel[]; private rows: number; private cols: number;
  private frame = 0; private token = ''; private began = 0; private stopAt = 0; private moving = false; private phase = '';
  private shown: number[]; private final?: number[]; private resolve?: (completed: boolean) => void;
  private pins = new Map<number, number>();
  constructor(private host: HTMLElement, private game: JourneySlotGame, private callbacks: { phase: (value: 'accelerating' | 'spinning' | 'stopping') => void; stop: (index: number) => void }) {
    const info = STUDIO_INFO[game]; this.rows = info.rows; this.cols = info.cols; this.shown = Array.from({ length: this.cols * this.rows }, (_, i) => (i + Math.floor(i / this.cols)) % 3);
    host.style.setProperty('--journey-cols', String(this.cols)); host.style.setProperty('--journey-rows', String(this.rows)); host.style.setProperty('--journey-items', String(ITEMS));
    this.reels = Array.from({ length: this.cols }, (_, col) => {
      const root = document.createElement('div'); root.className = 'journey-reel'; root.dataset.journeyReel = String(col); root.dataset.state = 'stopped';
      const track = document.createElement('div'); track.className = 'journey-track'; track.dataset.journeyTrack = ''; track.setAttribute('aria-hidden', 'true');
      const result = document.createElement('div'); result.className = 'journey-static';
      const cells = Array.from({ length: this.rows }, (_, row) => { const cell = document.createElement('div'); cell.className = 'journey-cell'; cell.dataset.journeyCell = String(row * this.cols + col); cell.setAttribute('role', 'img'); result.append(cell); return cell; });
      const pins = document.createElement('div'); pins.className = 'journey-pins'; pins.setAttribute('aria-hidden', 'true');
      for (let row = 0; row < this.rows; row++) { const pin = document.createElement('div'); pin.className = 'journey-pin'; pin.dataset.journeyPin = String(row * this.cols + col); pins.append(pin); }
      root.append(track, result, pins); host.append(root); return { root, track, cells, offset: 0, stopped: true };
    }); this.show(this.shown);
  }
  private setCell(cell: HTMLElement, symbol: number) { const position = Number(cell.dataset.journeyCell), held = this.pins.has(position); symbol = this.pins.get(position) ?? symbol; cell.dataset.symbol = String(symbol); cell.dataset.held = String(held); cell.classList.toggle('held', held); cell.innerHTML = journeySymbol(this.game, symbol) + (held ? '<span class="journey-pin-badge" aria-hidden="true">◆</span>' : ''); cell.setAttribute('aria-label', tr`Ячейка ${position + 1}: ${JOURNEY_SYMBOL_NAMES[this.game][symbol]}${held ? translateText(', закреплён') : ''}`); }
  show(grid: readonly number[]) { this.shown = [...grid]; this.reels.forEach((reel, col) => { reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, grid[row * this.cols + col])); }); }
  setPins(values: readonly JourneyPin[]) {
    this.pins = new Map(values.map(pin => [pin.position, pin.symbol]));
    this.host.querySelectorAll<HTMLElement>('[data-journey-pin]').forEach(pin => { const symbol = this.pins.get(Number(pin.dataset.journeyPin)); pin.dataset.symbol = symbol === undefined ? '' : String(symbol); pin.classList.toggle('held', symbol !== undefined); pin.innerHTML = symbol === undefined ? '' : journeySymbol(this.game, symbol) + '<span class="journey-pin-badge">◆</span>'; });
    this.show(this.shown);
  }
  pinReveal(positions: readonly number[]) { this.host.querySelectorAll<HTMLElement>('[data-journey-cell]').forEach(cell => cell.classList.toggle('pin-reveal', positions.includes(Number(cell.dataset.journeyCell)))); }
  walk(column: number) { this.reels[column].root.classList.add('walking'); }
  clearTransforms() { this.reels.forEach(reel => { reel.root.classList.remove('walking'); reel.cells.forEach(cell => cell.classList.remove('pin-reveal')); }); }
  begin(token: string, motion: boolean, pins: readonly JourneyPin[] = []) {
    this.cancel(); this.token = token; this.began = performance.now(); this.stopAt = 0; this.final = undefined; this.phase = ''; this.moving = motion;
    this.setPins(pins);
    if (!motion) return;
    this.reels.forEach((reel, col) => { const strip = studioStrip(this.game, col); reel.track.innerHTML = Array.from({ length: ITEMS }, (_, i) => `<div class="journey-track-symbol">${journeySymbol(this.game, i < this.rows ? this.shown[i * this.cols + col] : strip[(i - this.rows) % 6])}</div>`).join(''); reel.offset = 0; reel.stop = undefined; reel.stopped = false; reel.root.dataset.state = 'moving'; reel.track.style.transform = 'translate3d(0,0,0)'; });
    this.setPhase('accelerating'); this.frame = requestAnimationFrame(this.tick);
  }
  settle(token: string, grid: readonly number[]) { if (token !== this.token) return Promise.resolve(false); if (!this.moving) { this.show(grid); return Promise.resolve(true); } this.final = [...grid]; this.stopAt = Math.max(performance.now(), this.began + MIN_SPIN); return new Promise<boolean>(resolve => { this.resolve = resolve; }); }
  private setPhase(value: 'accelerating' | 'spinning' | 'stopping') { if (this.phase !== value) { this.phase = value; this.callbacks.phase(value); } }
  private tick = (now: number) => {
    if (!this.moving) return; const elapsed = now - this.began, distance = elapsed < ACCELERATE ? 14 * elapsed ** 2 / (2 * ACCELERATE * 1000) : 14 * (elapsed - ACCELERATE / 2) / 1000;
    if (elapsed >= ACCELERATE && this.phase === 'accelerating') this.setPhase('spinning');
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      if (!reel.stop && this.final && now >= this.stopAt + col * GAP) { const target = Math.ceil(reel.offset + 5); reel.stop = { at: now, from: reel.offset, target }; reel.root.dataset.state = 'stopping'; this.setPhase('stopping'); for (let row = 0; row < this.rows; row++) (reel.track.children[target + row] as HTMLElement).innerHTML = journeySymbol(this.game, this.final[row * this.cols + col]); }
      if (reel.stop) { const progress = Math.max(0, Math.min(1, (now - reel.stop.at) / STOP)); reel.offset = reel.stop.from + (reel.stop.target - reel.stop.from) * Math.sin(progress * Math.PI / 2); if (progress === 1) { reel.stopped = true; reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, this.final![row * this.cols + col])); this.callbacks.stop(col); } }
      else reel.offset = distance < this.rows ? distance : this.rows + (distance - this.rows) % 6;
      reel.track.style.transform = `translate3d(0,${-reel.offset / ITEMS * 100}%,0)`;
    });
    if (this.final && this.reels.every(reel => reel.stopped)) { this.moving = false; this.shown = [...this.final]; this.frame = 0; const resolve = this.resolve; this.resolve = undefined; resolve?.(true); } else this.frame = requestAnimationFrame(this.tick);
  };
  cancel() { cancelAnimationFrame(this.frame); this.frame = 0; this.moving = false; this.token = ''; this.final = undefined; const resolve = this.resolve; this.resolve = undefined; resolve?.(false); this.clearTransforms(); this.show(this.shown); }
  destroy() { this.cancel(); }
}
