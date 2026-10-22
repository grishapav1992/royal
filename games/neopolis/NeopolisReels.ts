import { symbolArt } from './art';
import { accentLead, motionClock, type Accent, type MotionOptions } from './NeopolisMotion';

type Reel = {
  viewport: HTMLElement; track: HTMLElement; progress: number; step: number; position: number;
  stopTime?: number; startOffset?: number; stopped: boolean;
};

/** Cosmetic regular symbols scroll while the shared server resolves the move.
 * Only the confirmed first frame is ever used for the landing symbols. */
export class NeopolisReels {
  private layer: HTMLElement;
  private reels: Reel[];
  private loop: ReturnType<typeof motionClock>;
  private observer: ResizeObserver;
  private elapsed = 0;
  private stopAt?: number;
  private targets?: string[][];
  private sequence = 0;
  private destroyed = false;

  constructor(private board: HTMLElement, private options: MotionOptions, private onStop: (col: number) => void,
    private sounds: (col: number) => Accent[] = col=>[{cue:'stop',variant:col}]) {
    const doc = board.ownerDocument;
    const previous = Array.from(board.querySelectorAll<HTMLElement>('[role=gridcell]'));
    this.layer = doc.createElement('div');
    this.layer.className = 'np-reels'; this.layer.setAttribute('aria-hidden', 'true');
    this.reels = Array.from({ length: 5 }, (_, col) => {
      const viewport = doc.createElement('div'), track = doc.createElement('div');
      viewport.className = 'np-reel'; viewport.dataset.phase = 'spinning';
      track.className = 'np-reel-track'; viewport.append(track); this.layer.append(viewport);
      track.append(this.filler(col));
      for (let row = 0; row < 4; row++) track.append(this.cell(previous[row * 5 + col].outerHTML));
      track.append(this.filler(col));
      return { viewport, track, progress: 0, step: 0, position: -1, stopped: false };
    });
    board.append(this.layer); board.classList.add('np-rolling'); board.setAttribute('aria-busy', 'true');
    const resize = () => {
      for (const reel of this.reels) {
        const height = (reel.viewport.clientHeight - 6) / 4;
        reel.step = height + 2;
        reel.track.style.setProperty('--np-reel-cell-height', height + 'px');
        reel.track.style.transform = 'translate3d(0,' + (reel.position * reel.step) + 'px,0)';
      }
    };
    this.observer = new ResizeObserver(resize); this.observer.observe(board); resize();
    this.loop = motionClock(board, options, (elapsed, delta) => this.tick(elapsed, delta));
    this.loop.cue('spin-start',Math.max(120,accentLead(options)),[{cue:'spin'}]);
    options.signal.addEventListener('abort', this.destroy, { once: true });
    if (options.signal.aborted) this.destroy();
  }

  private cell(html: string) {
    const template = this.board.ownerDocument.createElement('template'); template.innerHTML = html;
    const cell = template.content.firstElementChild as HTMLElement;
    cell.removeAttribute('role'); cell.removeAttribute('aria-label'); cell.classList.remove('np-hit');
    return cell;
  }
  private filler(col: number) {
    // These are visual filler, never scatters, WILDs, collected emblems or payouts.
    const symbol = (this.sequence++ * 5 + col * 3) % 6;
    return this.cell('<div class="np-cell" data-symbol="' + symbol + '">' + symbolArt(symbol) + '</div>');
  }
  private tick(elapsed: number, delta: number) {
    this.elapsed = elapsed;
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      const due = this.stopAt !== undefined && elapsed >= this.stopAt + col * (this.options.fast ? 44 : 100);
      if (due && reel.stopTime === undefined) {
        reel.stopTime = elapsed; reel.startOffset = reel.progress - 5;
        reel.track.prepend(...this.targets![col].map(html => this.cell(html)));
        reel.viewport.dataset.phase = 'braking';
        this.loop.cue('reel-'+col,elapsed+(this.options.fast ? 215 : 460),this.sounds(col),()=>{
          reel.viewport.dataset.impact='true'; this.onStop(col);
        });
      }
      let position: number;
      if (reel.stopTime === undefined) {
        reel.progress += delta / 1000 * 19 * Math.min(elapsed / (this.options.fast ? 110 : 200), 1) ** 2;
        while (reel.progress >= 1) {
          reel.progress--;
          reel.track.prepend(this.filler(col)); reel.track.lastElementChild!.remove();
        }
        position = reel.progress - 1;
        reel.track.style.filter = 'blur(' + (Math.min(elapsed / 200, 1) * .65) + 'px)';
      } else {
        const brake=this.options.fast ? 215 : 460,settle=this.options.fast ? 55 : 100;
        const age=elapsed-reel.stopTime,t=Math.min(1,age/brake),bounce=Math.min(1,Math.max(0,(age-brake)/settle));
        position = age<brake ? reel.startOffset! * (1-t) ** 2 : .045*Math.sin(bounce*Math.PI)*Math.exp(-bounce*1.6);
        if (age>=brake) reel.viewport.dataset.phase='settling';
        reel.track.style.filter = 'blur(' + ((1 - t) * .65) + 'px)';
        if (bounce === 1) {
          position = 0; reel.stopped = true; reel.viewport.dataset.phase = 'stopped';
          reel.track.style.filter = '';
        }
      }
      reel.position = position;
      reel.track.style.transform = 'translate3d(0,' + (position * reel.step) + 'px,0)';
    });
    return !this.reels.every(reel => reel.stopped);
  }

  finish(columns: string[][]) {
    if (!this.destroyed) {
      this.targets = columns;
      this.stopAt = Math.max(this.elapsed,this.options.audio?.leadMs ?? 0,this.options.fast ? 150 : 560);
    }
    return this.loop.done;
  }
  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true; this.loop.cancel(); this.observer.disconnect();
    this.options.signal.removeEventListener('abort', this.destroy);
    this.layer.remove(); this.board.classList.remove('np-rolling'); this.board.removeAttribute('aria-busy');
  };
}

/** Reproduce the server's column compaction: survivors fall from their old row,
 * replacement symbols enter above the top edge, rather than fading into place. */
export async function dissolveNeopolisSymbols(board: HTMLElement, removed: number[], options: MotionOptions) {
  const cells=Array.from(board.querySelectorAll<HTMLElement>('[role=gridcell]')).filter((_,index)=>removed.includes(index));
  if (!cells.length || options.signal.aborted) return;
  const lead=accentLead(options),duration=options.fast ? 85 : 145;
  board.dataset.presentation='clear';
  const clock=motionClock(board,options,elapsed=>{
    const t=Math.min(1,Math.max(0,(elapsed-lead)/duration));
    for (const cell of cells) { cell.style.opacity=String(1-t*t); cell.style.transform='scale('+(1+.06*Math.sin(t*Math.PI)-.22*t*t)+')'; }
    return elapsed<lead+duration;
  });
  clock.cue('clear',lead,[{cue:'clear'}],()=>board.dataset.impact='clear');
  await clock.done;
  for (const cell of cells) { cell.style.removeProperty('opacity'); cell.style.removeProperty('transform'); }
  delete board.dataset.impact;
}

export async function dropNeopolisSymbols(board: HTMLElement, removed: number[], options: MotionOptions) {
  const empty = new Set(removed), cells = Array.from(board.querySelectorAll<HTMLElement>('[role=gridcell]'));
  const step = cells[0].offsetHeight + 2;
  const falling: { cell: HTMLElement; offset: number; delay: number }[] = [];
  for (let col = 0; col < 5; col++) {
    const survivingRows = [0, 1, 2, 3].filter(row => !empty.has(row * 5 + col));
    const count = 4 - survivingRows.length;
    if (!count) continue;
    for (let row = 0; row < 4; row++) {
      const from = row < count ? row - count : survivingRows[row - count];
      const offset = (from - row) * step;
      if (offset) falling.push({ cell: cells[row * 5 + col], offset, delay: col * (options.fast ? 6 : 18) });
    }
  }
  if (!falling.length || options.signal.aborted) return;
  const duration = options.fast ? 155 : 300,settle=options.fast ? 45 : 75;
  const lead=Math.max(0,(options.audio?.leadMs ?? 0)+24-duration);
  board.dataset.falling = 'true';
  board.dataset.presentation='fall';
  const render = (elapsed: number) => {
    let active = false;
    for (const item of falling) {
      const age=elapsed-lead-item.delay,t=Math.min(1,Math.max(0,age/duration)),bounce=Math.min(1,Math.max(0,(age-duration)/settle));
      active ||= bounce < 1;
      const y=age<duration ? item.offset*(1-t*t) : step*.035*Math.sin(bounce*Math.PI)*Math.exp(-bounce*2);
      item.cell.style.transform = 'translate3d(0,' + y + 'px,0)';
    }
    return active;
  };
  render(0);
  const clock = motionClock(board, options, render);
  // One soft contact per moving column, independent of its number of symbols.
  for (let col=0;col<5;col++) if (falling.some(item=>cells.indexOf(item.cell)%5===col)) {
    const delay=falling.find(item=>cells.indexOf(item.cell)%5===col)!.delay;
    clock.cue('land-'+col,lead+delay+duration,[{cue:'land',variant:col}],()=>{
      for (const item of falling) if (cells.indexOf(item.cell)%5===col) item.cell.dataset.landed='true';
    });
  }
  await clock.done;
  for (const item of falling) { item.cell.style.removeProperty('transform'); delete item.cell.dataset.landed; }
  delete board.dataset.falling;
  delete board.dataset.presentation;
}

