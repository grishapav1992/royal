import { tr } from '../../i18n/index';
import {slotLocalRect,type SlotLocalRect} from './SlotGeometry';

export type SlotGravityFrame = {
  drops: {from:number;to:number;symbol:number}[];
  refills: {position:number;symbol:number}[];
};
export type SlotCascadeArtwork = {
  symbol(id:number):string;
  name(id:number):string;
  preview:readonly number[];
  strip(column:number):readonly number[];
};
export type SlotCascadeCallbacks = {
  phase:(value:'accelerating'|'spinning'|'stopping')=>void;
  stop:(index:number)=>void;
};

type Reel = { root: HTMLElement; track: HTMLElement; cells: HTMLElement[]; offset: number; stopped: boolean; stop?: { at: number; from: number; target: number } };
const ROWS = 5, COLS = 6, ITEMS = ROWS * 2 + 12, ACCELERATE = 350, MIN_SPIN = 800, STOP = 530, GAP = 110;

/** Cosmetic base reels and exact, server-described gravity overlays. */
export class SlotCascadeBoard {
  private reels: Reel[]; private overlay: HTMLElement; private frame = 0; private motionFrame = 0; private token = ''; private began = 0; private stopAt = 0; private moving = false; private phase = ''; private speed = 1;
  private shown:number[]; private final?: number[]; private resolve?: (completed: boolean) => void;
  constructor(private host:HTMLElement,private callbacks:SlotCascadeCallbacks,private artwork:SlotCascadeArtwork) {
    this.shown=[...artwork.preview];
    host.style.setProperty('--cc-items', String(ITEMS));
    this.reels = Array.from({ length: COLS }, (_, col) => {
      const root = document.createElement('div'); root.className = 'cc-reel'; root.dataset.ccReel = String(col); root.dataset.state = 'stopped';
      const track = document.createElement('div'); track.className = 'cc-track'; track.dataset.ccTrack = ''; track.setAttribute('aria-hidden', 'true');
      const result = document.createElement('div'); result.className = 'cc-static';
      const cells = Array.from({ length: ROWS }, (_, row) => { const cell = document.createElement('div'); cell.className = 'cc-cell'; cell.dataset.slotCell = cell.dataset.ccCell = String(row * COLS + col); cell.setAttribute('role', 'img'); result.append(cell); return cell; });
      root.append(track, result); host.append(root); return { root, track, cells, offset: 0, stopped: true };
    });
    this.overlay = document.createElement('div'); this.overlay.className = 'cc-overlay'; this.overlay.dataset.ccOverlay = ''; this.overlay.setAttribute('aria-hidden', 'true'); host.append(this.overlay); this.show(this.shown);
  }
  private setCell(cell: HTMLElement, symbol: number) { cell.dataset.symbol = String(symbol); cell.innerHTML = this.artwork.symbol(symbol); cell.setAttribute('aria-label', tr`Ячейка ${Number(cell.dataset.ccCell) + 1}: ${this.artwork.name(symbol)}`); }
  show(grid: readonly number[]) { this.shown = [...grid]; this.reels.forEach((reel, col) => { reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, grid[row * COLS + col])); }); }
  begin(token: string, motion: boolean, fast=false) {
    this.cancel(); this.token = token; this.speed=fast?2.5:1; this.began = performance.now(); this.stopAt = 0; this.final = undefined; this.phase = ''; this.moving = motion; if (!motion) return;
    this.reels.forEach((reel, col) => { const strip = this.artwork.strip(col); reel.track.innerHTML = Array.from({ length: ITEMS }, (_, i) => `<div class="cc-track-symbol">${this.artwork.symbol(i < ROWS ? this.shown[i * COLS + col] : strip[(i - ROWS) % strip.length])}</div>`).join(''); reel.offset = 0; reel.stop = undefined; reel.stopped = false; reel.root.dataset.state = 'moving'; reel.track.style.transform = 'translate3d(0,0,0)'; }); this.setPhase('accelerating'); this.frame = requestAnimationFrame(this.tick);
  }
  settle(token: string, grid: readonly number[]) { if (token !== this.token) return Promise.resolve(false); if (!this.moving) { this.show(grid); return Promise.resolve(true); } this.final = [...grid]; this.stopAt = Math.max(performance.now(), this.began + MIN_SPIN/this.speed); return new Promise<boolean>(resolve => { this.resolve = resolve; }); }
  private setPhase(value: 'accelerating' | 'spinning' | 'stopping') { if (value !== this.phase) { this.phase = value; this.callbacks.phase(value); } }
  private tick = (now: number) => {
    if (!this.moving) return; const elapsed = Math.max(0, now - this.began)*this.speed, distance = elapsed < ACCELERATE ? 14 * elapsed ** 2 / (2 * ACCELERATE * 1000) : 14 * (elapsed - ACCELERATE / 2) / 1000;
    if (elapsed >= ACCELERATE && this.phase === 'accelerating') this.setPhase('spinning');
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      if (!reel.stop && this.final && now >= this.stopAt + col * GAP/this.speed) { const target = Math.ceil(reel.offset + 5); reel.stop = { at: now, from: reel.offset, target }; reel.root.dataset.state = 'stopping'; this.setPhase('stopping'); for (let row = 0; row < ROWS; row++) (reel.track.children[target + row] as HTMLElement).innerHTML = this.artwork.symbol(this.final[row * COLS + col]); }
      if (reel.stop) { const progress = Math.max(0, Math.min(1, (now - reel.stop.at)*this.speed / STOP)); reel.offset = reel.stop.from + (reel.stop.target - reel.stop.from) * Math.sin(progress * Math.PI / 2); if (progress === 1) { reel.stopped = true; reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, this.final![row * COLS + col])); this.callbacks.stop(col); } }
      else reel.offset = distance < ROWS ? distance : ROWS + (distance - ROWS) % 6;
      reel.track.style.transform = `translate3d(0,${-reel.offset / ITEMS * 100}%,0)`;
    });
    if (this.final && this.reels.every(reel => reel.stopped)) { this.moving = false; this.shown = [...this.final]; this.frame = 0; const resolve = this.resolve; this.resolve = undefined; resolve?.(true); } else this.frame = requestAnimationFrame(this.tick);
  };
  highlight(positions:readonly number[]){const set=new Set(positions);this.reels.forEach(reel=>reel.cells.forEach(cell=>cell.classList.toggle('cc-winning',set.has(Number(cell.dataset.ccCell)))));}
  remove(positions: readonly number[]) { const set = new Set(positions); this.reels.forEach(reel => reel.cells.forEach(cell => cell.classList.toggle('removing', set.has(Number(cell.dataset.ccCell))))); }
  private cellRect(position:number):SlotLocalRect {
    const row=Math.floor(position/COLS), grid=this.reels[position%COLS].cells[row].parentElement!;
    // Grid tracks keep their full size while the departing cells shrink and rotate.
    const rect=slotLocalRect(grid,this.overlay), style=getComputedStyle(grid);
    const heights=style.gridTemplateRows.split(/\s+/).map(Number.parseFloat), gap=Number.parseFloat(style.rowGap)||0;
    return {left:rect.left,top:rect.top+heights.slice(0,row).reduce((sum,height)=>sum+height,0)+row*gap,width:rect.width,height:heights[row]};
  }
  drops(drops: SlotGravityFrame['drops']) {
    this.host.classList.add('overlay-active'); this.overlay.replaceChildren();
    for (const drop of drops) { const token = this.overlayToken(drop.from, drop.symbol); token.dataset.ccDrop = ''; token.dataset.from = String(drop.from); token.dataset.to = String(drop.to); token.dataset.symbol = String(drop.symbol); token.dataset.distance = String(Math.floor(drop.to / COLS) - Math.floor(drop.from / COLS)); token.dataset.shiftY=String(this.cellRect(drop.to).top-this.cellRect(drop.from).top); }
  }
  animateDrops() { this.overlay.getBoundingClientRect(); this.motionFrame = requestAnimationFrame(() => { this.motionFrame = 0; this.overlay.querySelectorAll<HTMLElement>('[data-cc-drop]').forEach(token => { token.style.transition = 'transform 380ms cubic-bezier(.18,.7,.25,1)'; token.style.transform = `translate3d(0,${Number(token.dataset.shiftY)}px,0)`; }); }); }
  refills(refills: SlotGravityFrame['refills']) {
    for (const refill of refills) { const token = this.overlayToken(refill.position, refill.symbol), col = refill.position % COLS, fill = refills.filter(item => item.position % COLS === col).length; token.dataset.ccRefill = ''; token.dataset.to = String(refill.position); token.dataset.symbol = String(refill.symbol); const pitch=this.cellRect(COLS+col).top-this.cellRect(col).top; token.style.transform = `translate3d(0,${-fill*pitch}px,0)`; }
  }
  animateRefills() { this.overlay.getBoundingClientRect(); this.motionFrame = requestAnimationFrame(() => { this.motionFrame = 0; this.overlay.querySelectorAll<HTMLElement>('[data-cc-refill]').forEach(token => { token.style.transition = `transform 420ms cubic-bezier(.18,.65,.25,1) ${(Number(token.dataset.to) % COLS) * 30}ms`; token.style.transform = 'translate3d(0,0,0)'; }); }); }
  gravity(frame:SlotGravityFrame,fast:boolean){
    this.drops(frame.drops);this.refills(frame.refills);this.overlay.getBoundingClientRect();
    this.motionFrame=requestAnimationFrame(()=>{this.motionFrame=0;this.overlay.querySelectorAll<HTMLElement>('[data-cc-drop],[data-cc-refill]').forEach(token=>{const refill=token.hasAttribute('data-cc-refill');token.style.transition=`transform ${fast?170:400}ms cubic-bezier(.18,.7,.25,1) ${refill?Number(token.dataset.to)%6*(fast?8:20):0}ms`;token.style.transform=refill?'translate3d(0,0,0)':`translate3d(0,${Number(token.dataset.shiftY)}px,0)`;});});
  }
  private overlayToken(position: number, symbol: number) { const token = document.createElement('div'); token.className = 'cc-falling-symbol'; const rect=this.cellRect(position);token.style.left=`${rect.left}px`;token.style.top=`${rect.top}px`;token.style.width=`${rect.width}px`;token.style.height=`${rect.height}px`; token.innerHTML = this.artwork.symbol(symbol); this.overlay.append(token); return token; }
  clearOverlay() {
    cancelAnimationFrame(this.motionFrame); this.motionFrame = 0;
    this.reels.forEach(reel => reel.cells.forEach(cell => {
      if (!cell.classList.contains('removing')) return;
      cell.classList.remove('removing');
      // Reveal the settled cell at full size without reversing its exit transition.
      cell.getAnimations().forEach(animation => animation.cancel());
    }));
    this.host.classList.remove('overlay-active'); this.overlay.replaceChildren();
  }
  cancel() { cancelAnimationFrame(this.frame); this.frame = 0; this.moving = false; this.token = ''; this.final = undefined; const resolve = this.resolve; this.resolve = undefined; resolve?.(false); this.clearOverlay(); this.show(this.shown); }
  destroy() { this.cancel(); }
}
