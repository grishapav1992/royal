import { studioStrip } from '../shared/studioGames';

export const NEON_SYMBOL_NAMES = ['Кристалл', 'Звёздный колокол', 'Орбитальная шестерня', 'WILD', 'Звезда', 'Монета'];

/** Original neon signs. Symbol IDs retain the existing server rules. */
export function neonSymbol(symbol: number): string {
  const paths = [
    '<path d="M22 27 33 13h30l11 14-26 42Z"/><path d="M22 27h52M33 13l15 56 15-56M33 13l-1 14 16 42 16-42-1-14"/>',
    '<path d="M29 57h38l-7-11V32c0-19-24-19-24 0v14Z"/><path d="M24 62h48M41 68c1 9 13 9 14 0M48 12v6"/><path d="m69 18 4-5m-4 16h7M24 18l-4-5m4 16h-7"/>',
    '<path d="m43 11 10 0 3 9 9 4 9-2 5 9-6 7v10l6 7-5 9-9-2-9 4-3 9H43l-3-9-9-4-9 2-5-9 6-7V38l-6-7 5-9 9 2 9-4Z"/><circle cx="48" cy="43" r="14"/><circle cx="48" cy="43" r="5"/>',
    '<path d="m19 30 10 30h38l10-30-18 12-11-23-11 23Z"/><path d="M30 68h36M35 55h26"/><circle cx="19" cy="25" r="3"/><circle cx="48" cy="14" r="3"/><circle cx="77" cy="25" r="3"/>',
    '<path d="m48 12 10 22 24 3-18 17 5 25-21-13-21 13 5-25-18-17 24-3Z"/><path d="m48 29 6 13 14 2-11 10 3 14-12-7-12 7 3-14-11-10 14-2Z"/>',
    '<circle cx="48" cy="44" r="30"/><circle cx="48" cy="44" r="23"/><path d="m36 51 4-20 8 13 8-13 4 20ZM37 58h22"/>',
  ];
  const color = ['#69eeff', '#ffdb75', '#e899ff', '#ffe794', '#ff9ade', '#ffd679'][symbol] ?? '#69eeff';
  return `<svg class="neon-sign neon-sign-${symbol}" viewBox="0 0 96 88" aria-hidden="true" style="--sign-color:${color}"><g class="neon-sign-halo">${paths[symbol] ?? paths[0]}</g><g class="neon-sign-core">${paths[symbol] ?? paths[0]}</g></svg>${symbol === 3 ? '<span class="neon-wild">WILD</span>' : ''}`;
}

type Reel = { root: HTMLElement; track: HTMLElement; cells: HTMLElement[]; offset: number; stop?: { at: number; from: number; target: number }; stopped: boolean };
type Callbacks = { phase: (phase: 'accelerating' | 'spinning' | 'stopping') => void; stop: (index: number) => void };
const ITEMS = 18, ACCELERATE_MS = 400, MIN_SPIN_MS = 900, STOP_MS = 560, STOP_GAP_MS = 240;

/** Cosmetic strips move independently of the server outcome, which is supplied to settle. */
export class NeonReels {
  private reels: Reel[];
  private frame = 0;
  private token = '';
  private began = 0;
  private stopAt = 0;
  private finalGrid?: number[];
  private shown = [0, 1, 2, 1, 2, 0, 2, 0, 1];
  private moving = false;
  private phase = '';
  private resolve?: (completed: boolean) => void;

  constructor(private host: HTMLElement, private callbacks: Callbacks) {
    this.reels = Array.from({ length: 3 }, (_, col) => {
      const root = document.createElement('div'); root.className = 'neon-reel'; root.dataset.neonReel = String(col); root.dataset.state = 'stopped';
      const track = document.createElement('div'); track.className = 'neon-track'; track.dataset.neonTrack = ''; track.setAttribute('aria-hidden', 'true');
      const result = document.createElement('div'); result.className = 'neon-reel-result';
      const cells = Array.from({ length: 3 }, (_, row) => {
        const cell = document.createElement('div'); cell.className = 'neon-cell'; cell.dataset.neonCell = cell.dataset.slotCell = String(row * 3 + col); cell.setAttribute('role', 'img'); result.append(cell); return cell;
      });
      root.append(track, result); host.append(root);
      return { root, track, cells, offset: 0, stopped: true };
    });
    this.show(this.shown);
  }

  show(grid: readonly number[]) {
    this.shown = [...grid];
    for (let col = 0; col < 3; col++) {
      const reel = this.reels[col]; reel.root.dataset.state = 'stopped'; reel.track.style.transform = 'translate3d(0,0,0)';
      reel.cells.forEach((cell, row) => {
        const symbol = grid[row * 3 + col]; cell.dataset.symbol = String(symbol); cell.innerHTML = neonSymbol(symbol);
        cell.setAttribute('aria-label', `Ячейка ${row * 3 + col + 1}: ${NEON_SYMBOL_NAMES[symbol]}`);
      });
    }
  }

  begin(token: string, motion: boolean) {
    this.cancel(); this.token = token; this.began = performance.now(); this.moving = motion; this.finalGrid = undefined; this.stopAt = 0; this.phase = '';
    if (!motion) return;
    this.reels.forEach((reel, col) => {
      const strip = studioStrip('studio-neon-crown', col);
      const symbols = Array.from({ length: ITEMS }, (_, index) => index < 3 ? this.shown[index * 3 + col] : strip[(index - 3) % strip.length]);
      reel.track.innerHTML = symbols.map(symbol => `<div class="neon-track-symbol">${neonSymbol(symbol)}</div>`).join('');
      reel.offset = 0; reel.stop = undefined; reel.stopped = false; reel.root.dataset.state = 'moving'; reel.track.style.transform = 'translate3d(0,0,0)';
    });
    this.setPhase('accelerating'); this.frame = requestAnimationFrame(this.tick);
  }

  settle(token: string, grid: readonly number[]): Promise<boolean> {
    if (token !== this.token) return Promise.resolve(false);
    if (!this.moving) { this.show(grid); return Promise.resolve(true); }
    this.finalGrid = [...grid]; this.stopAt = Math.max(performance.now(), this.began + MIN_SPIN_MS);
    return new Promise(resolve => { this.resolve = resolve; });
  }

  private setPhase(phase: 'accelerating' | 'spinning' | 'stopping') {
    if (phase !== this.phase) { this.phase = phase; this.callbacks.phase(phase); }
  }

  private tick = (now: number) => {
    if (!this.moving) return;
    const elapsed = Math.max(0, now - this.began);
    const distance = elapsed < ACCELERATE_MS ? 14 * elapsed * elapsed / (2 * ACCELERATE_MS * 1000) : 14 * (elapsed - ACCELERATE_MS / 2) / 1000;
    if (this.phase === 'accelerating' && elapsed >= ACCELERATE_MS) this.setPhase('spinning');
    this.reels.forEach((reel, col) => {
      if (reel.stopped) return;
      if (!reel.stop && this.finalGrid && now >= this.stopAt + col * STOP_GAP_MS) {
        const target = Math.ceil(reel.offset + 5);
        reel.stop = { at: now, from: reel.offset, target }; reel.root.dataset.state = 'stopping'; this.setPhase('stopping');
        for (let row = 0; row < 3; row++) (reel.track.children[target + row] as HTMLElement).innerHTML = neonSymbol(this.finalGrid[row * 3 + col]);
      }
      if (reel.stop) {
        const progress = Math.min(1, (now - reel.stop.at) / STOP_MS), ease = Math.sin(progress * Math.PI / 2);
        reel.offset = reel.stop.from + (reel.stop.target - reel.stop.from) * ease;
        if (progress === 1) {
          reel.stopped = true; reel.root.dataset.state = 'stopped';
          reel.cells.forEach((cell, row) => { const symbol = this.finalGrid![row * 3 + col]; cell.dataset.symbol = String(symbol); cell.innerHTML = neonSymbol(symbol); cell.setAttribute('aria-label', `Ячейка ${row * 3 + col + 1}: ${NEON_SYMBOL_NAMES[symbol]}`); });
          this.callbacks.stop(col);
        }
      } else reel.offset = distance < 3 ? distance : 3 + (distance - 3) % 6;
      reel.track.style.transform = `translate3d(0,${-reel.offset / ITEMS * 100}%,0)`;
    });
    if (this.reels.every(reel => reel.stopped) && this.finalGrid) {
      this.moving = false; this.shown = [...this.finalGrid]; this.frame = 0; const resolve = this.resolve; this.resolve = undefined; resolve?.(true);
    } else this.frame = requestAnimationFrame(this.tick);
  };

  cancel() {
    cancelAnimationFrame(this.frame); this.frame = 0; this.moving = false; this.token = ''; this.finalGrid = undefined;
    const resolve = this.resolve; this.resolve = undefined; resolve?.(false); this.show(this.shown);
  }

  destroy() { this.cancel(); }
}
