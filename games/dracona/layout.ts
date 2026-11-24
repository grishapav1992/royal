import { gameContentLayout } from '../../src/ui/GameLayoutPolicy';

/** Box of a placed part, in CSS pixels of the game root. */
export interface Box { x: number; y: number; w: number; h: number }
export interface Geometry {
  profile: 'full' | 'landscape' | 'portrait';
  /** Not enough height for the heroine above the cabinet. */
  tight: boolean;
  /** A wide window with little height uses lower panels. */
  short: boolean;
  /** The control bar is too narrow for its regular row. */
  narrow: boolean;
  cell: number; gap: number; pad: number;
  crown: number; foot: number; plaque: number; plaqueGap: number; doorLeft: number; doorRight: number;
  cabinet: Box; niche: Box; controls: Box; tools: Box; hero: Box | undefined;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Proportions of the 512 × 768 heroine artwork. */
const FIGURE_WIDTH = 0.461, HEAD_TOP = 0.157, WAIST = 0.493, FEET_MARGIN = 0.043;

const frameSize = (cell: number, gap: number, pad: number) => ({ w: 5 * cell + 4 * gap + 2 * pad, h: 4 * cell + 3 * gap + 2 * pad });

function full(width: number, height: number): Geometry {
  const short = height < 740, gap = 3, pad = 12;
  const foot = short ? 14 : 18, plaque = short ? 40 : 48, plaqueGap = short ? 4 : 6, bar = short ? 84 : 104;
  const top = short ? 4 : 8, between = short ? 8 : 14, bottom = short ? 6 : 12, doorLeft = short ? 44 : 60;
  const crownFor = (cell: number) => short ? 72 : clamp(Math.round(cell * 0.83), 84, 150);
  const doorFor = (cell: number) => clamp(Math.round(cell * 1.25), 136, 200);
  const sceneMin = clamp(Math.round(width * 0.19), 150, 217);
  const rowHeight = (cell: number) => top + crownFor(cell) + frameSize(cell, gap, pad).h + foot + plaqueGap + plaque + between + bar + bottom;
  let cell = 200;
  while (cell > 40 && (rowHeight(cell) > height || width - 10 - doorLeft - frameSize(cell, gap, pad).w - doorFor(cell) < sceneMin)) cell--;
  const frame = frameSize(cell, gap, pad), crown = crownFor(cell), doorRight = doorFor(cell);
  const offset = Math.max(0, Math.floor((height - rowHeight(cell)) / 2));
  const cabinetHeight = crown + frame.h + foot + plaqueGap + plaque, cabinetWidth = doorLeft + frame.w + doorRight;
  const y = top + offset, feet = y + cabinetHeight + 8;
  const tallest = Math.min(height * 0.85, (crown + frame.h) * 1.13);
  const widest = tallest * FIGURE_WIDTH, overlap = 37;
  let x = width - cabinetWidth - 10, figure = Math.min(widest, x + doorLeft + 5), figureX = 4;
  if (widest + cabinetWidth - overlap + 40 <= width) {
    figure = widest; figureX = Math.round((width - widest - cabinetWidth + overlap) / 2); x = Math.round(figureX + widest - overlap);
  }
  const heroHeight = Math.round(figure / FIGURE_WIDTH), heroWidth = Math.round(heroHeight * 2 / 3);
  const barWidth = Math.min(1200, width - 20), barY = y + cabinetHeight + between, barX = Math.round((width - barWidth) / 2);
  return { profile: 'full', tight: false, short, narrow: barWidth < 960, cell, gap, pad, crown, foot, plaque, plaqueGap, doorLeft, doorRight,
    cabinet: { x, y, w: cabinetWidth, h: cabinetHeight },
    niche: { x: x + doorLeft + frame.w + 4, y: y + crown + 3, w: doorRight - 18, h: frame.h },
    controls: { x: barX, y: barY, w: barWidth, h: bar },
    tools: short ? { x: barX + barWidth - 108, y: barY + (bar - 44) / 2, w: 92, h: 44 } : { x: barX + barWidth - 62, y: barY + (bar - 92) / 2, w: 44, h: 92 },
    hero: { x: Math.round(figureX - heroWidth * 0.139), y: Math.round(feet + heroHeight * FEET_MARGIN - heroHeight), w: heroWidth, h: heroHeight } };
}

function portrait(width: number, height: number): Geometry {
  const gap = 2, pad = 8, byWidth = Math.floor((width - 10 - 2 * pad - 4 * gap) / 5);
  const rest = (tight: boolean) => tight
    ? { crown: 46, plaque: 40, plaqueGap: 2, strip: 54, bar: 116, margin: 4 }
    : { crown: 54, plaque: 46, plaqueGap: 4, strip: 66, bar: 118, margin: 7 };
  const fixed = (tight: boolean) => { const r = rest(tight); return r.crown + 3 * gap + 2 * pad + r.plaqueGap + r.plaque + r.strip + r.bar + 3 * r.margin; };
  const heroMin = Math.min(190, height * 0.2);
  const roomy = Math.min(byWidth, Math.floor((height - fixed(false) - heroMin) / 4));
  const compact = Math.min(byWidth, Math.floor((height - fixed(true)) / 4));
  const tight = roomy < compact * 0.75;
  const cell = Math.max(24, tight ? compact : roomy), r = rest(tight), frame = frameSize(cell, gap, pad);
  const spare = Math.max(0, height - fixed(tight) - 4 * cell);
  const x = Math.floor((width - frame.w) / 2), y = tight ? Math.floor(spare / 2) : spare;
  const cabinetHeight = r.crown + frame.h + r.plaqueGap + r.plaque;
  const stripY = y + cabinetHeight + r.margin, barWidth = Math.min(width - 10, Math.max(frame.w + 14, Math.min(width - 10, 420)));
  const barY = stripY + r.strip + r.margin;
  let hero: Box | undefined;
  if (!tight) {
    const reach = Math.min((spare - 2) / (WAIST - HEAD_TOP), width * 0.95 / FIGURE_WIDTH);
    const h = Math.round(reach), w = Math.round(h * 2 / 3);
    hero = { x: Math.round(width / 2 - w * 0.487), y: Math.round(spare + 24 - h * WAIST), w, h };
  }
  return { profile: 'portrait', tight, short: false, narrow: barWidth < 350, cell, gap, pad, crown: r.crown, foot: 0, plaque: r.plaque, plaqueGap: r.plaqueGap, doorLeft: 0, doorRight: 0,
    cabinet: { x, y, w: frame.w, h: cabinetHeight }, niche: { x, y: stripY, w: frame.w, h: r.strip },
    controls: { x: Math.floor((width - barWidth) / 2), y: barY, w: barWidth, h: r.bar },
    tools: tight ? { x: x + 2, y: y + 1, w: frame.w - 4, h: 44 } : { x: width - 108, y: 10, w: 96, h: 44 }, hero };
}

function landscape(width: number, height: number): Geometry {
  const gap = 2, pad = 8, edge = height < 300 ? 5 : 14, plaque = height < 300 ? 34 : 38, plaqueGap = 4, space = 8;
  const nicheWidth = Math.round(clamp(height * 0.335, 96, 150)), barWidth = Math.round(clamp(width * 0.263, 182, 280));
  const byHeight = Math.floor((height - 2 * edge - plaque - plaqueGap - 3 * gap - 2 * pad) / 4);
  const byWidth = Math.floor((width - nicheWidth - barWidth - 4 * space - 4 * gap - 2 * pad) / 5);
  const cell = Math.max(20, Math.min(byHeight, byWidth)), frame = frameSize(cell, gap, pad);
  const cabinetHeight = frame.h + plaqueGap + plaque, y = Math.max(0, Math.floor((height - cabinetHeight) / 2));
  const scene = width - frame.w - nicheWidth - barWidth - 3 * space - 4;
  const withHero = scene >= 104;
  const group = frame.w + nicheWidth + barWidth + 2 * space;
  const x = withHero ? scene : Math.floor((width - group) / 2);
  const nicheX = x + frame.w + space, barX = nicheX + nicheWidth + space;
  let hero: Box | undefined;
  if (withHero) {
    const h = Math.round(height * 2.06), w = Math.round(h * 2 / 3);
    hero = { x: Math.round(Math.min(scene, 260) * 0.68 - w * 0.479), y: Math.round(24 - h * HEAD_TOP), w, h };
  }
  return { profile: 'landscape', tight: height < 300, short: false, narrow: barWidth < 200, cell, gap, pad, crown: 0, foot: 0, plaque, plaqueGap, doorLeft: 0, doorRight: 0,
    cabinet: { x, y, w: frame.w, h: cabinetHeight }, niche: { x: nicheX, y, w: nicheWidth, h: cabinetHeight },
    controls: { x: barX, y, w: barWidth, h: cabinetHeight },
    tools: { x: barX + 10, y: y + cabinetHeight - 44 - (height < 300 ? 6 : 12), w: barWidth - 20, h: 44 }, hero };
}

/** Places every part of the scene for the area allocated by the host and its chat. */
export function geometry(width: number, height: number): Geometry {
  const profile = gameContentLayout(width, height);
  return profile === 'full' ? full(width, height) : profile === 'landscape' ? landscape(width, height) : portrait(width, height);
}

/** The wand tip of the resting pose, the start of every cast. */
export const wandTip = (hero: DOMRect) => ({ x: hero.left + hero.width * 0.279, y: hero.top + hero.height * 0.219 });

export class SceneLayout {
  private readonly observer: ResizeObserver;
  current: Geometry;
  constructor(private root: HTMLElement, private changed: () => void) {
    this.current = this.apply();
    this.observer = new ResizeObserver(() => { this.current = this.apply(); this.changed(); });
    this.observer.observe(root);
  }
  private apply() {
    const g = geometry(Math.max(1, this.root.clientWidth), Math.max(1, this.root.clientHeight)), style = this.root.style;
    this.root.dataset.frameLayout = g.profile;
    this.root.dataset.tight = String(g.tight);
    this.root.dataset.short = String(g.short);
    this.root.dataset.narrow = String(g.narrow);
    this.root.dataset.hero = String(!!g.hero);
    const set = (name: string, value: number) => style.setProperty('--' + name, value + 'px');
    set('cell', g.cell); set('gap', g.gap); set('pad', g.pad); set('crown', g.crown); set('foot', g.foot);
    set('plaque', g.plaque); set('plaque-gap', g.plaqueGap); set('door-left', g.doorLeft); set('door-right', g.doorRight);
    const boxes: [string, Box][] = [['cabinet', g.cabinet], ['niche', g.niche], ['controls', g.controls], ['tools', g.tools]];
    if (g.hero) boxes.push(['hero', g.hero]);
    for (const [name, box] of boxes) for (const side of ['x', 'y', 'w', 'h'] as const) set(`${name}-${side}`, box[side]);
    return g;
  }
  destroy() { this.observer.disconnect(); }
}
