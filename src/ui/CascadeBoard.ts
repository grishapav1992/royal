import { tr } from '../i18n/index';
import { studioStrip, type StudioCascadePresentation } from '../shared/studioGames';
import { cascadeSymbol, CASCADE_NAMES, type CascadeGame } from './CascadeArtwork';
import {slotLocalRect} from './slotKit/SlotGeometry';
type Reel = { root: HTMLElement; track: HTMLElement; cells: HTMLElement[]; offset: number; stopped: boolean; stop?: { at: number; from: number; target: number } };
const ROWS = 5, COLS = 6, ITEMS = ROWS * 2 + 12, ACCELERATE = 350, MIN_SPIN = 800, STOP = 530, GAP = 110;

/** Cosmetic base reels and exact, server-described gravity overlays. */
export class CascadeBoard {
  private reels: Reel[]; private overlay: HTMLElement; private frame = 0; private motionFrame = 0; private token = ''; private began = 0; private stopAt = 0; private moving = false; private phase = '';
  private shown = Array.from({ length: 30 }, (_, i) => (i + Math.floor(i / COLS)) % 3); private final?: number[]; private resolve?: (completed: boolean) => void;
  constructor(private host: HTMLElement, private game: CascadeGame, private callbacks: { phase: (value: 'accelerating' | 'spinning' | 'stopping') => void; stop: (index: number) => void }) {
    host.style.setProperty('--cascade-items', String(ITEMS));
    this.reels = Array.from({ length: COLS }, (_, col) => {
      const root = document.createElement('div'); root.className = 'cascade-reel'; root.dataset.cascadeReel = String(col); root.dataset.state = 'stopped';
      const track = document.createElement('div'); track.className = 'cascade-track'; track.dataset.cascadeTrack = ''; track.setAttribute('aria-hidden', 'true');
      const result = document.createElement('div'); result.className = 'cascade-static';
      const cells = Array.from({ length: ROWS }, (_, row) => { const cell = document.createElement('div'); cell.className = 'cascade-cell'; cell.dataset.slotCell = cell.dataset.cascadeCell = String(row * COLS + col); cell.setAttribute('role', 'img'); result.append(cell); return cell; });
      root.append(track, result); host.append(root); return { root, track, cells, offset: 0, stopped: true };
    });
    this.overlay = document.createElement('div'); this.overlay.className = 'cascade-overlay'; this.overlay.dataset.cascadeOverlay = ''; this.overlay.setAttribute('aria-hidden', 'true'); host.append(this.overlay); this.show(this.shown);
  }
  private setCell(cell: HTMLElement, symbol: number) { cell.dataset.symbol = String(symbol); cell.innerHTML = cascadeSymbol(this.game, symbol); cell.setAttribute('aria-label', tr`Ячейка ${Number(cell.dataset.cascadeCell) + 1}: ${CASCADE_NAMES[this.game][symbol]}`); }
  show(grid: readonly number[]) { this.shown = [...grid]; this.reels.forEach((reel, col) => { reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, grid[row * COLS + col])); }); }
  begin(token: string, motion: boolean) {
    this.cancel(); this.token = token; this.began = performance.now(); this.stopAt = 0; this.final = undefined; this.phase = ''; this.moving = motion; if (!motion) return;
    this.reels.forEach((reel, col) => { const strip = studioStrip(this.game, col); reel.track.innerHTML = Array.from({ length: ITEMS }, (_, i) => `<div class="cascade-track-symbol">${cascadeSymbol(this.game, i < ROWS ? this.shown[i * COLS + col] : strip[(i - ROWS) % 6])}</div>`).join(''); reel.offset = 0; reel.stop = undefined; reel.stopped = false; reel.root.dataset.state = 'moving'; reel.track.style.transform = 'translate3d(0,0,0)'; }); this.setPhase('accelerating'); this.frame = requestAnimationFrame(this.tick);
  }
  settle(token: string, grid: readonly number[]) { if (token !== this.token) return Promise.resolve(false); if (!this.moving) { this.show(grid); return Promise.resolve(true); } this.final = [...grid]; this.stopAt = Math.max(performance.now(), this.began + MIN_SPIN); return new Promise<boolean>(resolve => { this.resolve = resolve; }); }
  private setPhase(value: 'accelerating' | 'spinning' | 'stopping') { if (value !== this.phase) { this.phase = value; this.callbacks.phase(value); } }
  private tick = (now: number) => {
    if (!this.moving) return; const elapsed = Math.max(0, now - this.began), distance = elapsed < ACCELERATE ? 14 * elapsed ** 2 / (2 * ACCELERATE * 1000) : 14 * (elapsed - ACCELERATE / 2) / 1000;
    if (elapsed >= ACCELERATE && this.phase === 'accelerating') this.setPhase('spinning');
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      if (!reel.stop && this.final && now >= this.stopAt + col * GAP) { const target = Math.ceil(reel.offset + 5); reel.stop = { at: now, from: reel.offset, target }; reel.root.dataset.state = 'stopping'; this.setPhase('stopping'); for (let row = 0; row < ROWS; row++) (reel.track.children[target + row] as HTMLElement).innerHTML = cascadeSymbol(this.game, this.final[row * COLS + col]); }
      if (reel.stop) { const progress = Math.max(0, Math.min(1, (now - reel.stop.at) / STOP)); reel.offset = reel.stop.from + (reel.stop.target - reel.stop.from) * Math.sin(progress * Math.PI / 2); if (progress === 1) { reel.stopped = true; reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, this.final![row * COLS + col])); this.callbacks.stop(col); } }
      else reel.offset = distance < ROWS ? distance : ROWS + (distance - ROWS) % 6;
      reel.track.style.transform = `translate3d(0,${-reel.offset / ITEMS * 100}%,0)`;
    });
    if (this.final && this.reels.every(reel => reel.stopped)) { this.moving = false; this.shown = [...this.final]; this.frame = 0; const resolve = this.resolve; this.resolve = undefined; resolve?.(true); } else this.frame = requestAnimationFrame(this.tick);
  };
  remove(positions: readonly number[]) { const set = new Set(positions); this.reels.forEach(reel => reel.cells.forEach(cell => cell.classList.toggle('removing', set.has(Number(cell.dataset.cascadeCell))))); }
  drops(drops: StudioCascadePresentation['drops']) {
    this.host.classList.add('overlay-active'); this.overlay.replaceChildren();
    for (const drop of drops) { const token = this.overlayToken(drop.from, drop.symbol); token.dataset.cascadeDrop = ''; token.dataset.from = String(drop.from); token.dataset.to = String(drop.to); token.dataset.symbol = String(drop.symbol); token.dataset.distance = String(Math.floor(drop.to / COLS) - Math.floor(drop.from / COLS)); token.dataset.shiftY=String(slotLocalRect(this.reels[drop.to%COLS].cells[Math.floor(drop.to/COLS)],this.overlay).top-slotLocalRect(this.reels[drop.from%COLS].cells[Math.floor(drop.from/COLS)],this.overlay).top); }
  }
  animateDrops() { this.overlay.getBoundingClientRect(); this.motionFrame = requestAnimationFrame(() => { this.motionFrame = 0; this.overlay.querySelectorAll<HTMLElement>('[data-cascade-drop]').forEach(token => { token.style.transition = 'transform 380ms cubic-bezier(.18,.7,.25,1)'; token.style.transform = `translate3d(0,${Number(token.dataset.shiftY)}px,0)`; }); }); }
  refills(refills: StudioCascadePresentation['refills']) {
    for (const refill of refills) { const token = this.overlayToken(refill.position, refill.symbol), col = refill.position % COLS, fill = refills.filter(item => item.position % COLS === col).length; token.dataset.cascadeRefill = ''; token.dataset.to = String(refill.position); token.dataset.symbol = String(refill.symbol); const pitch=slotLocalRect(this.reels[col].cells[1],this.overlay).top-slotLocalRect(this.reels[col].cells[0],this.overlay).top;token.style.transform = `translate3d(0,${-fill*pitch}px,0)`; }
  }
  animateRefills() { this.overlay.getBoundingClientRect(); this.motionFrame = requestAnimationFrame(() => { this.motionFrame = 0; this.overlay.querySelectorAll<HTMLElement>('[data-cascade-refill]').forEach(token => { token.style.transition = `transform 420ms cubic-bezier(.18,.65,.25,1) ${(Number(token.dataset.to) % COLS) * 30}ms`; token.style.transform = 'translate3d(0,0,0)'; }); }); }
  private overlayToken(position: number, symbol: number) { const token = document.createElement('div'); token.className = 'cascade-falling-symbol'; const rect=slotLocalRect(this.reels[position%COLS].cells[Math.floor(position/COLS)],this.overlay);Object.assign(token.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});token.innerHTML = cascadeSymbol(this.game, symbol); this.overlay.append(token); return token; }
  clearOverlay() { cancelAnimationFrame(this.motionFrame); this.motionFrame = 0; this.host.classList.remove('overlay-active'); this.overlay.replaceChildren(); this.reels.forEach(reel => reel.cells.forEach(cell => cell.classList.remove('removing'))); }
  cancel() { cancelAnimationFrame(this.frame); this.frame = 0; this.moving = false; this.token = ''; this.final = undefined; const resolve = this.resolve; this.resolve = undefined; resolve?.(false); this.clearOverlay(); this.show(this.shown); }
  destroy() { this.cancel(); }
}
