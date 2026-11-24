import { gameContentLayout } from '../../src/ui/GameLayoutPolicy';

export interface ForestBox { x: number; y: number; w: number; h: number }
export interface ForestGeometry {
  width: number; height: number; kind: 'full' | 'portrait' | 'landscape'; short: boolean;
  board: number; frame: number; x: number; y: number; cell: number; pad: number; flower: number;
  gem: { x: number; y: number }; flowers: { x: number; y: number }[];
  plate: ForestBox; controls: ForestBox; tools: { x: number; y: number }; elf: ForestBox & { cut: number; visible: boolean };
  crystal: ForestBox; energy: { x: number; y: number }; flowersBox: ForestBox; title?: ForestBox;
  seeds: { x: number; y: number }[]; seed: number; aura: ForestBox; sum: { x: number; y: number };
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** One scene for every host size. The field depends on the window alone, never on texts or results. */
export function forestGeometry(width: number, height: number): ForestGeometry {
  // A tall monitor gives the field more room in the portrait composition.
  const profile = gameContentLayout(width, height), kind = profile === 'full' && height > width ? 'portrait' as const : profile;
  const short = kind === 'portrait' ? height < 640 : kind === 'landscape' && height < 300;
  let board = 180, frame = 10, x = 0, y = 0, crystal = 80, flower = 30, titleWidth = 0;
  let plate: ForestBox, controls: ForestBox, tools: { x: number; y: number }, elf: ForestBox & { cut: number; visible: boolean };
  if (kind === 'full') {
    const controlsHeight = 92, plateHeight = 62, over = clamp(height * .075, 46, 84);
    for (let size = 1040; size > 180; size--) {
      frame = size * .078; crystal = size * .42; flower = size * .2;
      if (size + frame * 2 + over + plateHeight * .55 + controlsHeight + 32 <= height && size + frame * 2 + crystal * .52 + flower * .86 + width * .235 + 8 <= width) { board = size; break; }
    }
    frame = board * .078; crystal = board * .42; flower = board * .2; titleWidth = board * .74;
    const network = crystal * .46 + frame * 2 + board + flower * .86;
    x = 8 + crystal * .46 + frame;
    // A small field moves away from the edge, so the symmetric controls below keep a usable width.
    const shift = clamp(376 - (x + board / 2), 0, Math.max(0, width * .765 - network - 8)), elfSpace = width - network - 8 - shift; x += shift;
    y = 8 + over + frame;
    y += Math.max(0, height - (y + board + frame * .42 + plateHeight + controlsHeight + 30)) * .4;
    const centre = x + board / 2, plateWidth = Math.min(clamp(board * 1.02, 540, 760), centre * 2 - 16), half = Math.min(centre - 12, 520), top = y + board + frame * .42;
    plate = { x: centre - plateWidth / 2, y: top, w: plateWidth, h: plateHeight };
    controls = { x: centre - half, y: top + plateHeight + 30, w: half * 2, h: 72 };
    tools = { x: width - 160, y: 10 };
    const elfHeight = Math.min(height * .93, elfSpace * 3.1), elfWidth = elfHeight * 640 / 768, axis = width - clamp(elfHeight * .222, 120, elfSpace * .72 + 12);
    elf = { x: axis - elfWidth / 2, y: height - elfHeight, w: elfWidth, h: elfHeight, cut: 100, visible: true };
  } else if (kind === 'portrait') {
    const controlsHeight = short ? 126 : 158, plateHeight = short ? 60 : 72, headMin = short ? 56 : 84;
    frame = short ? 8 : clamp(width * .033, 13, 30);
    const left = width * .115, right = width * .122;
    board = Math.max(180, Math.floor(Math.min(width - left - right - frame * 2 + 8, height - controlsHeight - plateHeight - headMin - frame * 2 - 26)));
    crystal = board * .36; flower = right * 1.06; titleWidth = short ? 0 : Math.min(board * .72, 300);
    const head = clamp((height - (board + frame * 2 + controlsHeight + plateHeight + 16)) * .9, headMin - 2, 260);
    x = left + frame - 4 + Math.max(0, (width - left - right - frame * 2 - board + 8) / 2); y = head + frame + 4;
    const plateWidth = Math.min(width - 16, 560);
    plate = { x: (width - plateWidth) / 2, y: y + board + frame + 8, w: plateWidth, h: plateHeight };
    controls = { x: (width - plateWidth) / 2 + 4, y: height - controlsHeight + 2, w: plateWidth - 8, h: controlsHeight - 8 };
    tools = { x: 8, y: 6 };
    const elfHeight = Math.min(head * 2.15, width * 1.28), elfWidth = elfHeight * 640 / 768;
    elf = { x: width - elfWidth * .74, y: 2, w: elfWidth, h: elfHeight, cut: clamp((y - frame * .5 - 2) / elfHeight * 100, 20, 100), visible: true };
  } else {
    const column = clamp(width * .235, 176, 230), controlsHeight = short ? 146 : 162; frame = short ? 7 : 9;
    board = Math.floor(Math.min(height - frame * 2 - 12, (width - column - 16 - frame * 2) / 1.36)); crystal = board * .4; flower = board * .2;
    x = crystal * .36 + frame + 4; y = (height - board) / 2;
    const left = width - column - 6; tools = { x: left + (column - 148) / 2, y: 4 };
    controls = { x: left, y: height - controlsHeight - 5, w: column, h: controlsHeight };
    plate = { x: left, y: 51, w: column, h: clamp(controls.y - 51 - 13, 44, 108) };
    const from = x + board + frame + flower * .9, space = left - from, elfHeight = height * .99, elfWidth = elfHeight * 640 / 768;
    elf = { x: from + space / 2 - elfWidth / 2 + 4, y: height - elfHeight, w: elfWidth, h: elfHeight, cut: 100, visible: space >= 90 };
  }
  const full = kind === 'full', cell = board / 5, crystalWidth = crystal * 384 / 576;
  const gem = { x: Math.max(crystalWidth * .52, x - frame - crystal * (full ? .2 : .13)), y: y + board / 2 };
  const flowers = [0, 1, 2].map(i => ({ x: Math.min(x + board + frame + flower * (full ? .4 : .36), width - flower * .57), y: y + cell * (i * 2 + .48) }));
  const seed = full ? board * .044 : short ? 12 : 15, marks = full ? [.02, .085, .915, .98] : kind === 'portrait' ? [.76, .84, .92, 1] : [.38, .46, .54, .62];
  const titleHeight = titleWidth * 467 / 1400, axis = { x: elf.x + elf.w * .5, y: elf.y + elf.h * .32 }, radius = elf.h * .4;
  const flowerTop = Math.max(0, flowers[0].y - flower * .72);
  return {
    width, height, kind, short, board, frame, x, y, cell, pad: frame * 1.9, flower, gem, flowers, plate, controls, tools, elf, seed,
    crystal: { x: gem.x - crystalWidth * .51, y: gem.y - crystal * .43, w: crystalWidth, h: crystal },
    energy: { x: full ? gem.x : Math.max(26, gem.x), y: gem.y + crystal * .5 + 2 },
    flowersBox: { x: flowers[0].x - flower * .57, y: flowerTop, w: flower * 1.14, h: Math.min(height, flowers[2].y + flower * .55 + (full ? 40 : 24)) - flowerTop },
    title: titleWidth ? { x: kind === 'portrait' ? Math.max(4, x - frame) : x + board / 2 - titleWidth / 2, y: Math.max(1, y - frame * .55 - titleHeight * (kind === 'portrait' ? .78 : .74)), w: titleWidth, h: titleHeight } : undefined,
    seeds: marks.map(mark => ({ x: x + board * mark, y: y - frame * (full ? .62 : .5) })),
    aura: { x: axis.x - radius, y: axis.y - radius, w: radius * 2, h: radius * 2 },
    sum: full ? { x: plate.x + plate.w * .53, y: plate.y + plate.h * .6 } : kind === 'portrait' ? { x: plate.x + plate.w - 48, y: plate.y + plate.h * .5 } : { x: plate.x + plate.w * .3, y: plate.y + plate.h * .7 },
  };
}

/** Places the scene in the space supplied by the host, then reports the geometry to the painters. */
export class ForestLayout {
  private observer: ResizeObserver;
  private raf = 0;
  current: ForestGeometry;
  constructor(private root: HTMLElement, private changed: (geometry: ForestGeometry) => void) {
    this.observer = new ResizeObserver(() => this.schedule()); this.observer.observe(root);
    root.addEventListener('scroll', this.unscroll);
    this.current = this.fit();
  }
  /** A browser may scroll a focused control into view while the window rotates. The scene itself never scrolls. */
  private unscroll = () => { if (this.root.scrollLeft || this.root.scrollTop) { this.root.scrollLeft = 0; this.root.scrollTop = 0; } };
  private schedule() {
    const win = this.root.ownerDocument.defaultView!;
    if (!this.raf) this.raf = win.requestAnimationFrame(() => { this.raf = 0; this.fit(); });
  }
  private fit() {
    const g = forestGeometry(Math.max(260, this.root.clientWidth), Math.max(220, this.root.clientHeight)), find = (selector: string) => this.root.querySelector<HTMLElement>(selector)!;
    const place = (selector: string, box: { x: number; y: number; w?: number; h?: number }) => {
      const style = find(selector).style; style.left = box.x + 'px'; style.top = box.y + 'px';
      if (box.w !== undefined) style.width = box.w + 'px'; if (box.h !== undefined) style.height = box.h + 'px';
    };
    this.root.dataset.frameLayout = g.kind; this.root.dataset.layout = g.kind === 'full' ? 'wide' : g.kind === 'portrait' ? 'mobile' : 'landscape';
    this.root.dataset.short = String(g.short); this.root.dataset.narrow = String(g.width < 350);
    place('.fh-board', { x: g.x, y: g.y, w: g.board, h: g.board }); place('.fh-plate', g.plate); place('.fh-controls', g.controls); place('.fh-tools', g.tools);
    place('.fh-character', g.elf); const elf = find('.fh-character').style; elf.visibility = g.elf.visible ? '' : 'hidden';
    elf.setProperty('--fh-fade-from', (g.elf.cut < 100 ? g.elf.cut - 7 : 80) + '%'); elf.setProperty('--fh-fade-to', (g.elf.cut < 100 ? g.elf.cut : 99) + '%');
    place('.fh-glow', g.aura); place('.fh-source', g.crystal); place('.fh-energy', g.energy); place('.fh-flowers', g.flowersBox); place('.fh-banner', { x: g.x + g.board / 2, y: g.y + g.board * .5 });
    this.root.querySelectorAll<HTMLElement>('.fh-flower').forEach((flower, i) => {
      flower.style.setProperty('--s', g.flower + 'px');
      flower.style.left = g.flowers[i].x - g.flower / 2 - g.flowersBox.x + 'px'; flower.style.top = g.flowers[i].y - g.flower * .5 - g.flowersBox.y + 'px';
    });
    this.root.querySelectorAll<HTMLElement>('[data-bud]').forEach((seed, i) => { seed.style.left = g.seeds[i].x - g.seeds[0].x + 'px'; seed.style.top = '0'; seed.style.width = seed.style.height = g.seed + 'px'; });
    place('.fh-bonus', { x: g.seeds[0].x, y: g.seeds[0].y, w: g.seeds[3].x - g.seeds[0].x, h: 1 });
    const title = find('.fh-title'); title.classList.toggle('fh-sr', !g.title); if (g.title) { place('.fh-title', g.title); title.style.setProperty('--title', g.title.w + 'px'); }
    this.current = g; this.changed(g); this.unscroll(); return g;
  }
  destroy() { this.observer.disconnect(); this.root.removeEventListener('scroll', this.unscroll); if (this.raf) this.root.ownerDocument.defaultView!.cancelAnimationFrame(this.raf); }
}
