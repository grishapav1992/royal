import { symbolArt } from './art';

type MotionOptions = { signal: AbortSignal; paused: () => boolean; fast: boolean };

// A visible-time clock keeps motion still in the hall pause state, dialogs and
// hidden tabs. Cancellation always resolves, including during an HTTP request.
function motionClock(element: HTMLElement, options: MotionOptions, tick: (elapsed: number, delta: number) => boolean) {
  const win = element.ownerDocument.defaultView!;
  let request = 0, elapsed = 0, last = win.performance.now(), closed = false;
  let resolve!: () => void;
  const done = new Promise<void>(finish => { resolve = finish; });
  const cancel = () => {
    if (closed) return;
    closed = true; win.cancelAnimationFrame(request);
    options.signal.removeEventListener('abort', cancel); resolve();
  };
  const frame = (now: number) => {
    if (closed) return;
    const delta = Math.min(50, Math.max(0, now - last)); last = now;
    if (!options.paused()) {
      elapsed += delta;
      if (!tick(elapsed, delta)) { cancel(); return; }
    }
    request = win.requestAnimationFrame(frame);
  };
  options.signal.addEventListener('abort', cancel, { once: true });
  if (options.signal.aborted) cancel(); else request = win.requestAnimationFrame(frame);
  return { done, cancel };
}

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

  constructor(private board: HTMLElement, private options: MotionOptions, private onStop: (col: number) => void) {
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
      const due = this.stopAt !== undefined && elapsed >= this.stopAt + col * (this.options.fast ? 50 : 115);
      if (due && reel.stopTime === undefined) {
        reel.stopTime = elapsed; reel.startOffset = reel.progress - 5;
        reel.track.prepend(...this.targets![col].map(html => this.cell(html)));
        reel.viewport.dataset.phase = 'braking';
      }
      let position: number;
      if (reel.stopTime === undefined) {
        reel.progress += delta / 1000 * 18 * Math.min(elapsed / (this.options.fast ? 120 : 230), 1);
        while (reel.progress >= 1) {
          reel.progress--;
          reel.track.prepend(this.filler(col)); reel.track.lastElementChild!.remove();
        }
        position = reel.progress - 1;
        reel.track.style.filter = 'blur(' + (Math.min(elapsed / 230, 1) * .9) + 'px)';
      } else {
        const t = Math.min(1, (elapsed - reel.stopTime) / (this.options.fast ? 260 : 540));
        // Smooth braking, then an eight-percent-cell mechanical settling motion.
        const ease = 1 - (1 - Math.min(t / .9, 1)) ** 2;
        position = t < .9 ? reel.startOffset! + (-reel.startOffset! + .08) * ease : .08 * (1 - (t - .9) / .1);
        reel.track.style.filter = 'blur(' + ((1 - t) * .8) + 'px)';
        if (t === 1) {
          position = 0; reel.stopped = true; reel.viewport.dataset.phase = 'stopped';
          reel.track.style.filter = ''; this.onStop(col);
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
      this.stopAt = Math.max(this.elapsed, this.options.fast ? 170 : 620);
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
  const duration = options.fast ? 160 : 340;
  board.dataset.falling = 'true';
  const render = (elapsed: number) => {
    let active = false;
    for (const item of falling) {
      const t = Math.min(1, Math.max(0, (elapsed - item.delay) / duration));
      active ||= t < 1;
      item.cell.style.transform = 'translate3d(0,' + (item.offset * (1 - t * t)) + 'px,0)';
    }
    return active;
  };
  render(0);
  const clock = motionClock(board, options, render);
  await clock.done;
  for (const item of falling) item.cell.style.removeProperty('transform');
  delete board.dataset.falling;
}

