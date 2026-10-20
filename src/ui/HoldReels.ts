import { tr, locale } from '../i18n/index';
import { STUDIO_INFO, studioStrip } from '../shared/studioGames';
import { holdSymbol, HOLD_SYMBOL_NAMES, type HoldSlotGame } from './HoldArtwork';
import {slotLocalRect} from './slotKit/SlotGeometry';
export type HoldPin = {position:number;payoutUnits:string};
const amount = (units:string) => (Number(units)/100).toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
type Reel = { root: HTMLElement; track: HTMLElement; cells: HTMLElement[]; offset: number; stopped: boolean; stop?: { at: number; from: number; target: number } };
const ITEMS = 22, ACCELERATE = 350, MIN_SPIN = 850, STOP = 530, GAP = 155;

export class HoldReels {
  private reels: Reel[]; private rows: number; private cols: number;
  private frame = 0; private token = ''; private began = 0; private stopAt = 0; private moving = false; private phase = '';
  private flights = new Set<Animation>(); private line?: readonly number[]; private observer: ResizeObserver;
  private pins = new Map<number,string>();
  private shown: number[]; private final?: number[]; private resolve?: (completed: boolean) => void;
  constructor(private host: HTMLElement, private game: HoldSlotGame, private callbacks: { phase: (value: 'accelerating' | 'spinning' | 'stopping') => void; stop: (index: number) => void }) {
    const info = STUDIO_INFO[game]; this.rows = info.rows; this.cols = info.cols; this.shown = Array.from({ length: this.cols * this.rows }, (_, i) => (i + Math.floor(i / this.cols)) % 3);
    host.style.setProperty('--hold-cols', String(this.cols)); host.style.setProperty('--hold-rows', String(this.rows)); host.style.setProperty('--hold-items', String(ITEMS));
    this.reels = Array.from({ length: this.cols }, (_, col) => {
      const root = document.createElement('div'); root.className = 'hold-reel'; root.dataset.holdReel = String(col); root.dataset.state = 'stopped';
      const track = document.createElement('div'); track.className = 'hold-track'; track.dataset.holdTrack = ''; track.setAttribute('aria-hidden', 'true');
      const result = document.createElement('div'); result.className = 'hold-static';
      const cells = Array.from({ length: this.rows }, (_, row) => { const cell = document.createElement('div'); cell.className = 'hold-cell'; cell.dataset.holdCell = String(row * this.cols + col); cell.setAttribute('role', 'img'); result.append(cell); return cell; });
      const overlays=document.createElement('div');overlays.className='hold-pins';for(let row=0;row<this.rows;row++){const pin=document.createElement('div');pin.className='hold-pin';pin.dataset.holdPin=String(row*this.cols+col);pin.setAttribute('aria-hidden','true');overlays.append(pin);}
      root.append(track, result, overlays); host.append(root); return { root, track, cells, offset: 0, stopped: true };
    }); this.show(this.shown); this.observer = new ResizeObserver(() => this.paintLine()); this.observer.observe(host);
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); lines.classList.add('hold-line-overlay'); lines.dataset.holdLineOverlay = ''; lines.setAttribute('aria-hidden', 'true'); host.append(lines);
  }
  private content(position:number,symbol:number,paid?:string) {return holdSymbol(this.game,symbol)+(symbol===5?(paid===undefined?tr`<small class="hold-weight" data-hold-weight="${2+position%4}">ВЕС ${2+position%4}</small>`:`<small class="hold-coin-money" data-hold-coin-money="${paid}">${amount(paid)}</small>`):'');}
  private setCell(cell:HTMLElement,symbol:number){const position=Number(cell.dataset.holdCell),paid=this.pins.get(position);symbol=paid===undefined?symbol:5;cell.dataset.symbol=String(symbol);cell.dataset.held=String(paid!==undefined);cell.classList.toggle('held',paid!==undefined);cell.innerHTML=this.content(position,symbol,paid);cell.setAttribute('aria-label',tr`Ячейка ${position+1}: ${HOLD_SYMBOL_NAMES[this.game][symbol]}${symbol===5?paid===undefined?tr`, вес ${2+position%4}`:tr`, закреплена, ${amount(paid)} монет`:''}`);}
  setPins(pins:readonly HoldPin[]){this.pins=new Map(pins.map(pin=>[pin.position,pin.payoutUnits]));this.host.querySelectorAll<HTMLElement>('[data-hold-pin]').forEach(pin=>{const position=Number(pin.dataset.holdPin),paid=this.pins.get(position);pin.classList.toggle('held',paid!==undefined);pin.dataset.paidUnits=paid??'';pin.innerHTML=paid===undefined?'':this.content(position,5,paid);});this.show(this.shown);}
  revealCoin(position:number){this.host.querySelector<HTMLElement>(`[data-hold-cell="${position}"]`)?.classList.add('coin-reveal');this.host.querySelector<HTMLElement>(`[data-hold-pin="${position}"]`)?.classList.add('coin-reveal');}
  show(grid: readonly number[]) { this.shown = [...grid]; this.reels.forEach((reel, col) => { reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, grid[row * this.cols + col])); }); }
  markExpansion(positions: readonly number[]) { this.host.querySelectorAll<HTMLElement>('[data-hold-cell]').forEach(cell => cell.classList.toggle('expanding', positions.includes(Number(cell.dataset.holdCell)))); }
  clearTransforms() { this.host.querySelectorAll<HTMLElement>('[data-hold-cell]').forEach(cell => cell.classList.remove('expanding', 'holding', 'coin-reveal')); this.host.querySelectorAll('.hold-pin').forEach(pin=>pin.classList.remove('coin-reveal')); this.clearFlights(); this.line = undefined; this.paintLine(); }
  lineView(rows?: readonly number[]) { this.line = rows; this.paintLine(); }
  private paintLine() {
    const svg = this.host.querySelector<SVGSVGElement>('[data-hold-line-overlay]'); if (!svg) return;
    svg.replaceChildren(); if (!this.line) return;
    const bounds = this.host.getBoundingClientRect(); svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const points = this.line.map((row, col) => { const cell = this.host.querySelector<HTMLElement>(`[data-hold-cell="${row * this.cols + col}"]`)!; const point = cell.getBoundingClientRect(); return `${point.left + point.width / 2 - bounds.left},${point.top + point.height / 2 - bounds.top}`; }).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); path.setAttribute('points', points); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#fff0b8'); path.setAttribute('stroke-width', '3'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
  }
  async collect(token: string, winIndex: number, collector: number, coins: readonly {position: number; rawValue: number}[]) {
    if (token !== this.token) return false;
    const target = slotLocalRect(this.host.querySelector<HTMLElement>(`[data-hold-cell="${collector}"]`)!,this.host);
    const destination = this.host.querySelector<HTMLElement>(`[data-hold-cell="${collector}"]`)!; destination.classList.add('holding');
    const pending = coins.map(coin => {
      const source = slotLocalRect(this.host.querySelector<HTMLElement>(`[data-hold-cell="${coin.position}"]`)!,this.host);
      const copy = document.createElement('div'); copy.className = 'hold-flight'; copy.dataset.holdFlight = ''; copy.dataset.sourcePosition = String(coin.position); copy.dataset.collector = String(collector); copy.dataset.winIndex = String(winIndex); copy.dataset.rawValue = String(coin.rawValue); copy.setAttribute('aria-hidden', 'true'); copy.innerHTML = holdSymbol(this.game, 5);
      const size = Math.min(source.width, source.height) * .65; Object.assign(copy.style, {left: `${source.left + (source.width - size) / 2}px`, top: `${source.top + (source.height - size) / 2}px`, width: `${size}px`, height: `${size}px`}); this.host.append(copy);
      const dx = target.left + target.width / 2 - (source.left + source.width / 2), dy = target.top + target.height / 2 - (source.top + source.height / 2);
      const animation = copy.animate([{transform: 'translate(0,0) scale(1)', opacity: 1}, {transform: `translate(${dx}px,${dy}px) scale(.3) rotate(22deg)`, opacity: .15}], {duration: 430, easing: 'cubic-bezier(.18,.66,.33,1)', fill: 'forwards'}); this.flights.add(animation);
      return animation.finished.then(() => true, () => false).finally(() => { this.flights.delete(animation); copy.remove(); });
    });
    const results = await Promise.all(pending); destination.classList.remove('holding'); return token === this.token && results.every(Boolean);
  }
  private clearFlights() { this.flights.forEach(animation => animation.cancel()); this.flights.clear(); this.host.querySelectorAll('[data-hold-flight]').forEach(node => node.remove()); }
  begin(token: string, motion: boolean, pins:readonly HoldPin[] = []) {
    this.cancel(); this.token = token; this.began = performance.now(); this.stopAt = 0; this.final = undefined; this.phase = ''; this.moving = motion; this.setPins(pins);
    if (!motion) return;
    this.reels.forEach((reel, col) => { const strip = studioStrip(this.game, col); reel.track.innerHTML = Array.from({ length: ITEMS }, (_, i) => `<div class="hold-track-symbol">${holdSymbol(this.game, i < this.rows ? this.shown[i * this.cols + col] : strip[(i - this.rows) % 6])}</div>`).join(''); reel.offset = 0; reel.stop = undefined; reel.stopped = false; reel.root.dataset.state = 'moving'; reel.track.style.transform = 'translate3d(0,0,0)'; });
    this.setPhase('accelerating'); this.frame = requestAnimationFrame(this.tick);
  }
  settle(token: string, grid: readonly number[]) { if (token !== this.token) return Promise.resolve(false); if (!this.moving) { this.show(grid); return Promise.resolve(true); } this.final = [...grid]; this.stopAt = Math.max(performance.now(), this.began + MIN_SPIN); return new Promise<boolean>(resolve => { this.resolve = resolve; }); }
  private setPhase(value: 'accelerating' | 'spinning' | 'stopping') { if (this.phase !== value) { this.phase = value; this.callbacks.phase(value); } }
  private tick = (now: number) => {
    if (!this.moving) return; const elapsed = now - this.began, distance = elapsed < ACCELERATE ? 14 * elapsed ** 2 / (2 * ACCELERATE * 1000) : 14 * (elapsed - ACCELERATE / 2) / 1000;
    if (elapsed >= ACCELERATE && this.phase === 'accelerating') this.setPhase('spinning');
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      if (!reel.stop && this.final && now >= this.stopAt + col * GAP) { const target = Math.ceil(reel.offset + 5); reel.stop = { at: now, from: reel.offset, target }; reel.root.dataset.state = 'stopping'; this.setPhase('stopping'); for (let row = 0; row < this.rows; row++) (reel.track.children[target + row] as HTMLElement).innerHTML = holdSymbol(this.game, this.final[row * this.cols + col]); }
      if (reel.stop) { const progress = Math.max(0, Math.min(1, (now - reel.stop.at) / STOP)); reel.offset = reel.stop.from + (reel.stop.target - reel.stop.from) * Math.sin(progress * Math.PI / 2); if (progress === 1) { reel.stopped = true; reel.root.dataset.state = 'stopped'; reel.cells.forEach((cell, row) => this.setCell(cell, this.final![row * this.cols + col])); this.callbacks.stop(col); } }
      else reel.offset = distance < this.rows ? distance : this.rows + (distance - this.rows) % 6;
      reel.track.style.transform = `translate3d(0,${-reel.offset / ITEMS * 100}%,0)`;
    });
    if (this.final && this.reels.every(reel => reel.stopped)) { this.moving = false; this.shown = [...this.final]; this.frame = 0; const resolve = this.resolve; this.resolve = undefined; resolve?.(true); } else this.frame = requestAnimationFrame(this.tick);
  };
  cancel() { cancelAnimationFrame(this.frame); this.frame = 0; this.moving = false; this.token = ''; this.final = undefined; const resolve = this.resolve; this.resolve = undefined; resolve?.(false); this.clearTransforms(); this.show(this.shown); }
  destroy() { this.cancel(); this.observer.disconnect(); }
}
