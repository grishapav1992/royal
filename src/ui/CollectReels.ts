import { tr } from '../i18n/index';
import { STUDIO_INFO, studioStrip } from '../shared/studioGames';
import { collectSymbol, COLLECT_SYMBOL_NAMES, type CollectSlotGame } from './CollectArtwork';
import {slotLocalRect} from './slotKit/SlotGeometry';
type Reel = { root: HTMLElement; track: HTMLElement; cells: HTMLElement[]; offset: number; stopped: boolean; stop?: { at: number; from: number; target: number } };
const ITEMS = 22, ACCELERATE = 350, MIN_SPIN = 850, STOP = 530, GAP = 155;

export class CollectReels {
  private reels: Reel[]; private rows: number; private cols: number;
  private frame = 0; private token = ''; private began = 0; private stopAt = 0; private moving = false; private phase = '';
  private flights = new Set<Animation>(); private line?: readonly number[]; private observer: ResizeObserver;
  private shown: number[]; private final?: number[]; private resolve?: (completed: boolean) => void;
  constructor(private host: HTMLElement, private game: CollectSlotGame, private callbacks: { phase: (value: 'accelerating' | 'spinning' | 'stopping') => void; stop: (index: number) => void }) {
    const info = STUDIO_INFO[game]; this.rows = info.rows; this.cols = info.cols; this.shown = Array.from({ length: this.cols * this.rows }, (_, i) => (i + Math.floor(i / this.cols)) % 3);
    host.style.setProperty('--collect-cols', String(this.cols)); host.style.setProperty('--collect-rows', String(this.rows)); host.style.setProperty('--collect-items', String(ITEMS));
    this.reels = Array.from({ length: this.cols }, (_, col) => {
      const root = document.createElement('div'); root.className = 'collect-reel'; root.dataset.collectReel = String(col); root.dataset.state = 'stopped';
      const track = document.createElement('div'); track.className = 'collect-track'; track.dataset.collectTrack = ''; track.setAttribute('aria-hidden', 'true');
      const result = document.createElement('div'); result.className = 'collect-static';
      const cells = Array.from({ length: this.rows }, (_, row) => { const cell = document.createElement('div'); cell.className = 'collect-cell'; cell.dataset.collectCell = String(row * this.cols + col); cell.setAttribute('role', 'img'); result.append(cell); return cell; });
      root.append(track, result); host.append(root); return { root, track, cells, offset: 0, stopped: true };
    }); this.show(this.shown); this.observer = new ResizeObserver(() => this.paintLine()); this.observer.observe(host);
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); lines.classList.add('collect-line-overlay'); lines.dataset.collectLineOverlay = ''; lines.setAttribute('aria-hidden', 'true'); host.append(lines);
  }
  private setCell(cell: HTMLElement, symbol: number) { const position = Number(cell.dataset.collectCell); cell.dataset.symbol = String(symbol); cell.innerHTML = collectSymbol(this.game, symbol) + (symbol === 5 ? tr`<small class="collect-weight" data-collect-weight="${2 + position % 4}">ВЕС ${2 + position % 4}</small>` : ''); cell.setAttribute('aria-label', tr`Ячейка ${position + 1}: ${COLLECT_SYMBOL_NAMES[this.game][symbol]}${symbol === 5 ? tr`, вес ${2 + position % 4}` : ''}`); }
  show(grid: readonly number[]) { this.shown = [...grid]; this.reels.forEach((reel, col) => { reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, grid[row * this.cols + col])); }); }
  markExpansion(positions: readonly number[]) { this.host.querySelectorAll<HTMLElement>('[data-collect-cell]').forEach(cell => cell.classList.toggle('expanding', positions.includes(Number(cell.dataset.collectCell)))); }
  clearTransforms() { this.host.querySelectorAll<HTMLElement>('[data-collect-cell]').forEach(cell => cell.classList.remove('expanding', 'collecting')); this.clearFlights(); this.line = undefined; this.paintLine(); }
  lineView(rows?: readonly number[]) { this.line = rows; this.paintLine(); }
  private paintLine() {
    const svg = this.host.querySelector<SVGSVGElement>('[data-collect-line-overlay]'); if (!svg) return;
    svg.replaceChildren(); if (!this.line) return;
    const bounds = this.host.getBoundingClientRect(); svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const points = this.line.map((row, col) => { const cell = this.host.querySelector<HTMLElement>(`[data-collect-cell="${row * this.cols + col}"]`)!; const point = cell.getBoundingClientRect(); return `${point.left + point.width / 2 - bounds.left},${point.top + point.height / 2 - bounds.top}`; }).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); path.setAttribute('points', points); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#fff0b8'); path.setAttribute('stroke-width', '3'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
  }
  async collect(token: string, winIndex: number, collector: number, coins: readonly {position: number; rawValue: number}[]) {
    if (token !== this.token) return false;
    const target = slotLocalRect(this.host.querySelector<HTMLElement>(`[data-collect-cell="${collector}"]`)!,this.host);
    const destination = this.host.querySelector<HTMLElement>(`[data-collect-cell="${collector}"]`)!; destination.classList.add('collecting');
    const pending = coins.map(coin => {
      const source = slotLocalRect(this.host.querySelector<HTMLElement>(`[data-collect-cell="${coin.position}"]`)!,this.host);
      const copy = document.createElement('div'); copy.className = 'collect-flight'; copy.dataset.collectFlight = ''; copy.dataset.sourcePosition = String(coin.position); copy.dataset.collector = String(collector); copy.dataset.winIndex = String(winIndex); copy.dataset.rawValue = String(coin.rawValue); copy.setAttribute('aria-hidden', 'true'); copy.innerHTML = collectSymbol(this.game, 5);
      const size = Math.min(source.width, source.height) * .65; Object.assign(copy.style, {left: `${source.left + (source.width - size) / 2}px`, top: `${source.top + (source.height - size) / 2}px`, width: `${size}px`, height: `${size}px`}); this.host.append(copy);
      const dx = target.left + target.width / 2 - (source.left + source.width / 2), dy = target.top + target.height / 2 - (source.top + source.height / 2);
      const animation = copy.animate([{transform: 'translate(0,0) scale(1)', opacity: 1}, {transform: `translate(${dx}px,${dy}px) scale(.3) rotate(22deg)`, opacity: .15}], {duration: 430, easing: 'cubic-bezier(.18,.66,.33,1)', fill: 'forwards'}); this.flights.add(animation);
      return animation.finished.then(() => true, () => false).finally(() => { this.flights.delete(animation); copy.remove(); });
    });
    const results = await Promise.all(pending); destination.classList.remove('collecting'); return token === this.token && results.every(Boolean);
  }
  private clearFlights() { this.flights.forEach(animation => animation.cancel()); this.flights.clear(); this.host.querySelectorAll('[data-collect-flight]').forEach(node => node.remove()); }
  begin(token: string, motion: boolean) {
    this.cancel(); this.token = token; this.began = performance.now(); this.stopAt = 0; this.final = undefined; this.phase = ''; this.moving = motion;
    if (!motion) return;
    this.reels.forEach((reel, col) => { const strip = studioStrip(this.game, col); reel.track.innerHTML = Array.from({ length: ITEMS }, (_, i) => `<div class="collect-track-symbol">${collectSymbol(this.game, i < this.rows ? this.shown[i * this.cols + col] : strip[(i - this.rows) % 6])}</div>`).join(''); reel.offset = 0; reel.stop = undefined; reel.stopped = false; reel.root.dataset.state = 'moving'; reel.track.style.transform = 'translate3d(0,0,0)'; });
    this.setPhase('accelerating'); this.frame = requestAnimationFrame(this.tick);
  }
  settle(token: string, grid: readonly number[]) { if (token !== this.token) return Promise.resolve(false); if (!this.moving) { this.show(grid); return Promise.resolve(true); } this.final = [...grid]; this.stopAt = Math.max(performance.now(), this.began + MIN_SPIN); return new Promise<boolean>(resolve => { this.resolve = resolve; }); }
  private setPhase(value: 'accelerating' | 'spinning' | 'stopping') { if (this.phase !== value) { this.phase = value; this.callbacks.phase(value); } }
  private tick = (now: number) => {
    if (!this.moving) return; const elapsed = now - this.began, distance = elapsed < ACCELERATE ? 14 * elapsed ** 2 / (2 * ACCELERATE * 1000) : 14 * (elapsed - ACCELERATE / 2) / 1000;
    if (elapsed >= ACCELERATE && this.phase === 'accelerating') this.setPhase('spinning');
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      if (!reel.stop && this.final && now >= this.stopAt + col * GAP) { const target = Math.ceil(reel.offset + 5); reel.stop = { at: now, from: reel.offset, target }; reel.root.dataset.state = 'stopping'; this.setPhase('stopping'); for (let row = 0; row < this.rows; row++) (reel.track.children[target + row] as HTMLElement).innerHTML = collectSymbol(this.game, this.final[row * this.cols + col]); }
      if (reel.stop) { const progress = Math.max(0, Math.min(1, (now - reel.stop.at) / STOP)); reel.offset = reel.stop.from + (reel.stop.target - reel.stop.from) * Math.sin(progress * Math.PI / 2); if (progress === 1) { reel.stopped = true; reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, this.final![row * this.cols + col])); this.callbacks.stop(col); } }
      else reel.offset = distance < this.rows ? distance : this.rows + (distance - this.rows) % 6;
      reel.track.style.transform = `translate3d(0,${-reel.offset / ITEMS * 100}%,0)`;
    });
    if (this.final && this.reels.every(reel => reel.stopped)) { this.moving = false; this.shown = [...this.final]; this.frame = 0; const resolve = this.resolve; this.resolve = undefined; resolve?.(true); } else this.frame = requestAnimationFrame(this.tick);
  };
  cancel() { cancelAnimationFrame(this.frame); this.frame = 0; this.moving = false; this.token = ''; this.final = undefined; const resolve = this.resolve; this.resolve = undefined; resolve?.(false); this.clearTransforms(); this.show(this.shown); }
  destroy() { this.cancel(); this.observer.disconnect(); }
}
