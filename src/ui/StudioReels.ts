import { tr } from '../i18n/index';
import { STUDIO_INFO, studioStrip } from '../shared/studioGames';
import { slotSymbol, SLOT_SYMBOL_NAMES, type PresentedSlotGame } from './StudioSlotArtwork';
type Reel = { root: HTMLElement; track: HTMLElement; pins: HTMLElement; cells: HTMLElement[]; offset: number; stopped: boolean; stop?: { at: number; from: number; target: number } };
const ITEMS = 20, ACCELERATE = 350, MIN_SPIN = 850, STOP = 530, GAP = 155;

export class StudioReels {
  private reels: Reel[]; private rows: number; private cols: number;
  private frame = 0; private token = ''; private began = 0; private stopAt = 0; private moving = false; private phase = '';
  private shown: number[]; private final?: number[]; private resolve?: (completed: boolean) => void;
  constructor(private host: HTMLElement, private game: PresentedSlotGame, private callbacks: { phase: (value: 'accelerating' | 'spinning' | 'stopping') => void; stop: (index: number) => void }) {
    const info = STUDIO_INFO[game]; this.rows = info.rows; this.cols = info.cols; this.shown = Array.from({ length: this.cols * this.rows }, (_, i) => (i + Math.floor(i / this.cols)) % 3);
    host.style.setProperty('--slot-cols', String(this.cols)); host.style.setProperty('--slot-rows', String(this.rows)); host.style.setProperty('--slot-items', String(ITEMS));
    this.reels = Array.from({ length: this.cols }, (_, col) => {
      const root = document.createElement('div'); root.className = 'slot-reel'; root.dataset.slotReel = String(col); root.dataset.state = 'stopped';
      const track = document.createElement('div'); track.className = 'slot-track'; track.dataset.slotTrack = ''; track.setAttribute('aria-hidden', 'true');
      const result = document.createElement('div'); result.className = 'slot-static';
      const cells = Array.from({ length: this.rows }, (_, row) => { const cell = document.createElement('div'); cell.className = 'slot-cell'; cell.dataset.slotCell = String(row * this.cols + col); cell.setAttribute('role', 'img'); result.append(cell); return cell; });
      const pins = document.createElement('div'); pins.className = 'slot-pins'; pins.setAttribute('aria-hidden', 'true');
      const beam = document.createElement('div'); beam.className = 'slot-expansion'; beam.innerHTML = '<span>WILD</span>'; beam.setAttribute('aria-hidden', 'true');
      root.append(track, result, pins, beam); host.append(root); return { root, track, pins, cells, offset: 0, stopped: true };
    }); this.show(this.shown);
  }
  private setCell(cell: HTMLElement, symbol: number) { cell.dataset.symbol = String(symbol); cell.innerHTML = slotSymbol(this.game, symbol); cell.setAttribute('aria-label', tr`Ячейка ${Number(cell.dataset.slotCell) + 1}: ${SLOT_SYMBOL_NAMES[this.game][symbol]}`); }
  show(grid: readonly number[]) { this.shown = [...grid]; this.reels.forEach((reel, col) => { reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, grid[row * this.cols + col])); }); }
  pins(positions: readonly number[]) { this.reels.forEach((reel, col) => { reel.pins.innerHTML = positions.filter(i => i % this.cols === col).map(i => `<div class="slot-pin" data-slot-pin="${i}" style="top:${Math.floor(i / this.cols) / this.rows * 100}%;height:${100 / this.rows}%">${slotSymbol(this.game, 3)}<span class="slot-lock" aria-hidden="true">●</span></div>`).join(''); }); }
  expand(column: number, sourcePositions: readonly number[]) { const reel = this.reels[column]; reel.root.style.setProperty('--wild-origin', `${Math.floor(sourcePositions[0] / this.cols) / this.rows * 100}%`); reel.root.classList.add('expanding'); }
  clearTransforms() { this.reels.forEach(reel => reel.root.classList.remove('expanding')); }
  begin(token: string, motion: boolean) {
    this.cancel(); this.token = token; this.began = performance.now(); this.stopAt = 0; this.final = undefined; this.phase = ''; this.moving = motion;
    if (!motion) return;
    this.reels.forEach((reel, col) => { const strip = studioStrip(this.game, col); reel.track.innerHTML = Array.from({ length: ITEMS }, (_, i) => `<div class="slot-track-symbol">${slotSymbol(this.game, i < this.rows ? this.shown[i * this.cols + col] : strip[(i - this.rows) % 6])}</div>`).join(''); reel.offset = 0; reel.stop = undefined; reel.stopped = false; reel.root.dataset.state = 'moving'; reel.track.style.transform = 'translate3d(0,0,0)'; });
    this.setPhase('accelerating'); this.frame = requestAnimationFrame(this.tick);
  }
  settle(token: string, grid: readonly number[]) { if (token !== this.token) return Promise.resolve(false); if (!this.moving) { this.show(grid); return Promise.resolve(true); } this.final = [...grid]; this.stopAt = Math.max(performance.now(), this.began + MIN_SPIN); return new Promise<boolean>(resolve => { this.resolve = resolve; }); }
  private setPhase(value: 'accelerating' | 'spinning' | 'stopping') { if (this.phase !== value) { this.phase = value; this.callbacks.phase(value); } }
  private tick = (now: number) => {
    if (!this.moving) return; const elapsed = now - this.began, distance = elapsed < ACCELERATE ? 14 * elapsed ** 2 / (2 * ACCELERATE * 1000) : 14 * (elapsed - ACCELERATE / 2) / 1000;
    if (elapsed >= ACCELERATE && this.phase === 'accelerating') this.setPhase('spinning');
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      if (!reel.stop && this.final && now >= this.stopAt + col * GAP) { const target = Math.ceil(reel.offset + 5); reel.stop = { at: now, from: reel.offset, target }; reel.root.dataset.state = 'stopping'; this.setPhase('stopping'); for (let row = 0; row < this.rows; row++) (reel.track.children[target + row] as HTMLElement).innerHTML = slotSymbol(this.game, this.final[row * this.cols + col]); }
      if (reel.stop) { const progress = Math.min(1, (now - reel.stop.at) / STOP); reel.offset = reel.stop.from + (reel.stop.target - reel.stop.from) * Math.sin(progress * Math.PI / 2); if (progress === 1) { reel.stopped = true; reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, this.final![row * this.cols + col])); this.callbacks.stop(col); } }
      else reel.offset = distance < this.rows ? distance : this.rows + (distance - this.rows) % 6;
      reel.track.style.transform = `translate3d(0,${-reel.offset / ITEMS * 100}%,0)`;
    });
    if (this.final && this.reels.every(reel => reel.stopped)) { this.moving = false; this.shown = [...this.final]; this.frame = 0; const resolve = this.resolve; this.resolve = undefined; resolve?.(true); } else this.frame = requestAnimationFrame(this.tick);
  };
  cancel() { cancelAnimationFrame(this.frame); this.frame = 0; this.moving = false; this.token = ''; this.final = undefined; const resolve = this.resolve; this.resolve = undefined; resolve?.(false); this.clearTransforms(); this.show(this.shown); }
  destroy() { this.cancel(); }
}
