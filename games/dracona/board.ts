import { COLS, CREST, PORTAL, SIZE, SYMBOLS, type Cluster, type Grid, type Movement } from '../../src/shared/draconaMath';
import { draconaText as T } from './text';
import type { Geometry } from './layout';

const asset = (symbol: number) => `/assets/dracona/${SYMBOLS[symbol].file}`;
export const symbolImage = (symbol: number) => `<img src="${asset(symbol)}" alt="${T(SYMBOLS[symbol].name)}" draggable="false">`;
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const LANDING = 'cubic-bezier(.3,.05,.4,1)';

/** The 5 × 4 field with its outlines, amounts and the exchanged blocks. */
export class CabinetBoard {
  readonly cells: HTMLElement[];
  private clusters: { cells: number[]; amount: string }[] = [];
  private running = new Set<Animation>();
  private ghosts = new Set<HTMLElement>();
  private document: Document;

  constructor(private board: HTMLElement, private marks: HTMLElement, private contour: SVGSVGElement, private floating: HTMLElement,
    private reserve: HTMLElement, private size: () => Geometry) {
    this.document = board.ownerDocument;
    this.cells = Array.from({ length: SIZE }, (_, index) => {
      const cell = this.document.createElement('div');
      cell.className = 'cell'; cell.setAttribute('role', 'gridcell'); cell.dataset.index = String(index);
      board.append(cell); return cell;
    });
  }

  draw(grid: Grid, runes: readonly number[]) {
    this.cells.forEach((cell, index) => {
      const symbol = grid[index], rune = runes[index];
      cell.className = 'cell' + (symbol === PORTAL ? ' portal-symbol' : symbol === CREST ? ' crest-symbol' : '') + (rune > 1 ? ' runed' : '');
      if (rune > 1) cell.dataset.rune = String(rune); else delete cell.dataset.rune;
      cell.innerHTML = symbolImage(symbol) + (rune > 1 ? `<span class="rune">×${rune}</span>` : '');
      cell.setAttribute('aria-label', `${index + 1}: ${T(SYMBOLS[symbol].name)}${rune > 1 ? `, ${T('руна')} ×${rune}` : ''}`);
    });
    this.clear();
  }

  drawReserve(grid: Grid) { this.reserve.innerHTML = grid.map(symbol => `<div>${symbolImage(symbol)}</div>`).join(''); }

  private animate(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = element.animate(frames, options);
    this.running.add(animation);
    const done = () => { this.running.delete(animation); };
    animation.finished.then(done, done);
    return animation;
  }

  private land(index: number, rows: number, duration: number, delay: number) {
    const image = this.cells[index].querySelector('img');
    if (!image || rows === 0) return;
    const { cell, gap } = this.size();
    this.animate(image, [
      { transform: `translateY(${-rows * (cell + gap)}px)`, offset: 0, easing: LANDING },
      { transform: 'translateY(0)', offset: 0.74 },
      { transform: `translateY(${-cell * 0.04}px)`, offset: 0.86 },
      { transform: 'translateY(0)', offset: 1 },
    ], { duration, delay, fill: 'backwards' });
  }

  /** A new field falls column by column behind the opening doors. Returns its full duration. */
  fall(factor: number) {
    if (reducedMotion()) return 0;
    for (let index = 0; index < SIZE; index++) {
      const row = Math.floor(index / COLS), column = index % COLS;
      this.land(index, row + 1.3, 430 * factor, (column * 70 + (3 - row) * 34) * factor);
    }
    return (430 + 4 * 70 + 3 * 34) * factor;
  }

  drop(movements: readonly Movement[], factor: number) {
    if (reducedMotion()) return 0;
    for (const { from, to } of movements) {
      if (from === to) continue;
      const rows = Math.floor(to / COLS) - Math.floor(from / COLS);
      this.land(to, rows, 400 * factor, (to % COLS) * 26 * factor);
    }
    return 504 * factor;
  }

  highlight(clusters: readonly Cluster[], format: (value: number) => string) {
    this.clusters = clusters.map(cluster => ({ cells: cluster.cells, amount: '+' + format(cluster.payout) }));
    for (const cluster of this.clusters) for (const index of cluster.cells) this.cells[index].classList.add('winning');
    this.board.classList.add('has-win');
    this.refresh();
  }

  /** Redraws the outlines, also after the window has changed its size. */
  refresh() {
    const { cell, gap, pad } = this.size(), width = 5 * cell + 4 * gap, height = 4 * cell + 3 * gap;
    this.contour.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const path = this.contour.querySelector('path')!;
    this.marks.replaceChildren();
    let line = '';
    for (const { cells, amount } of this.clusters) {
      const set = new Set(cells);
      for (const index of cells) {
        const column = index % COLS, row = Math.floor(index / COLS);
        const left = column * (cell + gap) - gap / 2, top = row * (cell + gap) - gap / 2, right = left + cell + gap, bottom = top + cell + gap;
        if (!set.has(index - COLS)) line += `M${left} ${top}H${right}`;
        if (!set.has(index + COLS)) line += `M${left} ${bottom}H${right}`;
        if (column === 0 || !set.has(index - 1)) line += `M${left} ${top}V${bottom}`;
        if (column === COLS - 1 || !set.has(index + 1)) line += `M${right} ${top}V${bottom}`;
      }
      const top = Math.min(...cells.map(index => Math.floor(index / COLS)));
      const column = Math.min(...cells.filter(index => Math.floor(index / COLS) === top).map(index => index % COLS));
      const mark = this.document.createElement('span');
      mark.className = 'win-mark'; mark.textContent = amount;
      mark.dataset.edge = String(top === 0);
      mark.style.left = column * (cell + gap) - 2 + 'px';
      mark.style.top = (top === 0 ? -pad : top * (cell + gap)) + 'px';
      this.marks.append(mark);
    }
    path.setAttribute('d', line);
  }

  /** Returns the boxes of the removed cells for the dust. */
  vanish() {
    const removed = this.clusters.flatMap(cluster => cluster.cells);
    for (const index of removed) this.cells[index].classList.add('vanishing');
    this.clusters = []; this.refresh();
    return removed.map(index => this.cells[index].getBoundingClientRect());
  }

  target(cells: readonly number[]) { for (const index of cells) this.cells[index].classList.add('portal-target'); }
  arrived(cells: readonly number[]) { for (const index of cells) this.cells[index].classList.add('arrived'); }

  /** The block and the reserve cross each other. */
  async swap(cells: readonly number[], incoming: Grid, outgoing: Grid, duration: number) {
    if (reducedMotion()) return;
    const source = this.reserve.getBoundingClientRect(), layer = this.floating.getBoundingClientRect();
    const first = this.cells[cells[0]].getBoundingClientRect(), last = this.cells[cells[3]].getBoundingClientRect();
    const width = last.right - first.left, dx = source.left - first.left, dy = source.top - first.top, scale = source.width / width;
    const lift = Math.min(110, this.size().cell * 0.9);
    const far = `translate(${dx}px,${dy}px) scale(${scale})`;
    const middle = (sign: number) => `translate(${dx / 2}px,${dy / 2 + sign * lift}px) scale(${(1 + scale) / 2 * 0.96})`;
    const ghost = (symbols: Grid, kind: string) => {
      const element = this.document.createElement('div');
      element.className = 'transfer-ghost ' + kind;
      element.innerHTML = symbols.map(symbol => `<div>${symbolImage(symbol)}</div>`).join('');
      Object.assign(element.style, { left: `${first.left - layer.left}px`, top: `${first.top - layer.top}px`, width: `${width}px`, height: `${last.bottom - first.top}px` });
      this.floating.append(element); this.ghosts.add(element); return element;
    };
    for (const index of cells) this.cells[index].classList.add('lifted');
    this.reserve.classList.add('lifted');
    const inside = ghost(incoming, 'incoming'), outside = ghost(outgoing, 'outgoing');
    const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'both' };
    const arriving = this.animate(inside, [{ transform: far, opacity: 0.3 }, { opacity: 1, offset: 0.12 }, { transform: middle(-1), offset: 0.5 }, { transform: 'none' }], options);
    const leaving = this.animate(outside, [{ transform: 'none' }, { transform: middle(1), offset: 0.5 }, { transform: far }], options);
    try { await Promise.all([arriving.finished, leaving.finished]); } catch { /* Cancelled with the scene. */ } finally {
      inside.remove(); outside.remove(); this.ghosts.delete(inside); this.ghosts.delete(outside);
      for (const index of cells) this.cells[index].classList.remove('lifted');
      this.reserve.classList.remove('lifted');
    }
  }

  private clear() { this.clusters = []; this.board.classList.remove('has-win'); this.refresh(); }
  cancel() {
    for (const animation of [...this.running]) animation.cancel();
    for (const ghost of this.ghosts) ghost.remove();
    this.ghosts.clear(); this.clear();
  }
}
