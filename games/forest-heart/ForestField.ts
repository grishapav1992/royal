import { FOREST_HEART_ROTORS } from '../../src/shared/forestHeartMath';
import { rootArtwork, rootWave, easeRoot } from './RootArtwork';
import type { ForestGeometry } from './ForestLayout';

export type Point = [number, number];
/** Light colours by confirmed energy. `gem` recolours only the crystal, never its wooden nest. */
export const FOREST_ENERGY: Record<number, { color: string; gem: string; halo: number; glow: number }> = {
  1: { color: '#63f5d0', gem: 'none', halo: .8, glow: .4 },
  2: { color: '#6fd8ff', gem: 'hue-rotate(28deg) brightness(1.15)', halo: .95, glow: .55 },
  5: { color: '#b48bff', gem: 'hue-rotate(105deg) brightness(1.1)', halo: 1.1, glow: .7 },
  20: { color: '#ffc94f', gem: 'hue-rotate(-118deg) saturate(1.3) brightness(1.2)', halo: 1.3, glow: .8 },
  100: { color: '#ffe08a', gem: 'hue-rotate(-115deg) saturate(.55) brightness(1.65)', halo: 1.6, glow: .95 },
};
/** Centre lines measured on v4/roots.webp: direction of the port, then points from the edge to the node. */
const lines: Record<number, Point[]>[] = [
  { 3: [[0, .489], [.083, .468], [.167, .439], [.25, .387], [.333, .359], [.417, .368], [.5, .47]], 1: [[1, .481], [.917, .516], [.833, .585], [.75, .627], [.667, .63], [.583, .578], [.5, .47]] },
  { 0: [[.443, 0], [.436, .083], [.441, .167], [.459, .25], [.475, .333], [.53, .43], [.6, .475]], 1: [[1, .492], [.917, .479], [.833, .474], [.75, .497], [.667, .497], [.6, .475]] },
  { 0: [[.534, 0], [.533, .167], [.535, .33], [.53, .42]], 3: [[0, .476], [.083, .48], [.167, .504], [.25, .525], [.333, .501], [.417, .45], [.53, .42]], 1: [[1, .486], [.917, .491], [.833, .509], [.75, .511], [.667, .477], [.53, .42]] },
  { 0: [[.516, 0], [.52, .083], [.523, .167], [.545, .25], [.55, .36], [.54, .47]], 2: [[.517, 1], [.51, .917], [.522, .833], [.535, .75], [.52, .667], [.54, .47]], 3: [[0, .484], [.083, .481], [.167, .471], [.25, .482], [.333, .508], [.417, .527], [.54, .47]], 1: [[1, .469], [.917, .471], [.833, .486], [.75, .476], [.667, .439], [.54, .47]] },
];
/** Shift and scale that make neighbouring painted roots meet. The ports themselves do not change. */
const adjust: [number, number][] = [[0, 1], [.055, 1.02], [-.03, 1.06], [-.012, 1.03]];
const opposite = (direction: number) => (direction + 2) % 4, port = (direction: number) => 1 << direction;
const back = (t: number) => { const c = 1.9, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const forestNeighbour = (cell: number, direction: number) => {
  const row = Math.floor(cell / 5) + [-1, 0, 1, 0][direction], column = cell % 5 + [0, 1, 0, -1][direction];
  return row < 0 || row > 4 || column < 0 || column > 4 ? -1 : row * 5 + column;
};
/** Painted arms of one tile after its artwork rotation. */
export function rootArms(mask: number): Record<number, Point[]> {
  const { column, angle } = rootArtwork(mask), turns = angle / 90, [shift, scale] = adjust[column], arms: Record<number, Point[]> = {};
  for (const key of Object.keys(lines[column])) arms[(Number(key) + turns) % 4] = lines[column][Number(key)].map(([px, py]) => {
    let a = (px - .5) * scale + shift, b = (py - .5) * scale;
    for (let i = 0; i < turns; i++) [a, b] = [-b, a];
    return [a + .5, b + .5];
  });
  return arms;
}
/** When each arm fills. Arrival order is the same breadth-first wave that the tests verify. */
export function forestLightPlan(board: readonly number[], stepMs: number) {
  const wave = rootWave(board), segments: { cell: number; points: Point[]; at: number; length: number; inward: boolean; dead: boolean }[] = [], arrivals = new Map<number, number>();
  let duration = 0;
  for (const [cell, { depth, entry }] of wave) {
    const arms = rootArms(board[cell]);
    for (const key of Object.keys(arms)) {
      const direction = Number(key), inward = direction === entry, next = forestNeighbour(cell, direction), receiver = direction === 1 ? [4, 14, 24].indexOf(cell) : -1;
      const linked = inward || receiver >= 0 || next >= 0 && !!(board[next] & port(opposite(direction)));
      segments.push({ cell, points: inward ? arms[direction] : [...arms[direction]].reverse(), at: depth * stepMs + (inward ? 0 : stepMs / 2), length: stepMs / 2, inward, dead: !linked });
      if (receiver >= 0) arrivals.set(receiver, (depth + 1) * stepMs);
    }
    duration = Math.max(duration, (depth + 1) * stepMs);
  }
  return { wave, segments, arrivals, duration };
}
function along(points: Point[], t: number) {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
  let rest = lengths.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i]) { const k = lengths[i] ? rest / lengths[i] : 0; return { index: i, point: [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k] as Point }; }
    rest -= lengths[i];
  }
  return { index: points.length - 2, point: points[points.length - 1] };
}
interface Light { plan: ReturnType<typeof forestLightPlan>; time: number; fade: number; ended: Set<number> }
interface Cell { angle: number; speed: number; spinning: boolean; from?: number; to?: number; landed: boolean; bump: number; grow: number; hover: number; hot: boolean; dim: number }

/** Paints the five by five field. It only shows masks, light and locks supplied from the confirmed view. */
export class ForestField {
  private cells: Cell[] = Array.from({ length: 25 }, () => ({ angle: 0, speed: 0, spinning: false, landed: true, bump: 0, grow: 1, hover: 0, hot: false, dim: 0 }));
  private board: readonly number[] = [];
  private light?: Light;
  private held = new Set<number>();
  private energy = 1;
  private choice = false;
  private geometry?: ForestGeometry;
  private dpr = 1;
  private litKey = '';
  private lit: HTMLCanvasElement; private mask: HTMLCanvasElement; private glow: HTMLCanvasElement;
  private tints = new Map<number, HTMLCanvasElement>();
  private written = new Map<string, string>();
  dirty = true;
  /** Field coordinates in root pixels, so effects start exactly on the painted light. */
  onHead?: (x: number, y: number) => void; onDead?: (x: number, y: number) => void; onLand?: (cell: number) => void;
  constructor(private x: CanvasRenderingContext2D, private roots: HTMLImageElement, private tile: HTMLImageElement, private buttons: HTMLElement[]) {
    const doc = roots.ownerDocument; this.lit = doc.createElement('canvas'); this.mask = doc.createElement('canvas'); this.glow = doc.createElement('canvas');
    this.glow.width = this.glow.height = 90;
  }
  resize(geometry: ForestGeometry, dpr: number) {
    this.geometry = geometry; this.dpr = dpr; const pixels = Math.max(1, Math.round(geometry.board * dpr));
    for (const canvas of [this.lit, this.mask]) if (canvas.width !== pixels) canvas.width = canvas.height = pixels;
    this.litKey = ''; this.dirty = true;
  }
  centre(cell: number) { const g = this.geometry!; return { x: g.x + (cell % 5 + .5) * g.cell, y: g.y + (Math.floor(cell / 5) + .5) * g.cell }; }
  /** Settles every tile on a confirmed board and drops all motion. */
  show(board: readonly number[]) {
    this.board = board; this.litKey = '';
    this.cells.forEach((cell, index) => Object.assign(cell, { angle: rootArtwork(board[index]).angle, speed: 0, spinning: false, from: undefined, to: undefined, landed: true, bump: 0, dim: 0 }));
    this.dirty = true;
  }
  setEnergy(energy: number) { if (this.energy !== energy) { this.energy = energy; this.litKey = ''; this.dirty = true; } }
  setHeld(cells: readonly number[], fresh: readonly number[] = []) { this.held = new Set(cells); this.cells.forEach((cell, i) => { cell.grow = fresh.includes(i) ? 0 : 1; }); this.dirty = true; }
  grow(cells: readonly number[], progress: number) { for (const i of cells) this.cells[i].grow = easeRoot(progress); this.dirty = true; }
  setChoice(value: boolean) { this.choice = value; if (!value) for (const cell of this.cells) cell.hot = false; this.dirty = true; }
  hover(index: number, value: boolean) { this.cells[index].hot = value && this.choice; this.dirty = true; }
  clearLight() { this.light = undefined; this.dirty = true; }
  startLight(stepMs: number, complete = false) {
    const plan = forestLightPlan(this.board, stepMs); this.light = { plan, time: complete ? Infinity : -1, fade: 1, ended: new Set(complete ? plan.segments.keys() : []) };
    this.litKey = ''; this.dirty = true; return plan;
  }
  setLight(time: number) { if (this.light) this.light.time = time; this.dirty = true; }
  fadeLight(value: number) { if (this.light) this.light.fade = clamp(value); this.dirty = true; }
  /** Neutral motion while the server answers. Held roots and the thirteen joints stay still. */
  spin(carried: ReadonlySet<number>) { for (const index of FOREST_HEART_ROTORS) if (!carried.has(index)) Object.assign(this.cells[index], { spinning: true, landed: false, from: undefined, to: undefined }); for (const cell of this.cells) cell.dim = .16; this.dirty = true; }
  /** The confirmed orientation arrives from left to right. Progress covers the complete wave. */
  land(board: readonly number[], carried: ReadonlySet<number>, progress: number) {
    this.board = board; this.litKey = '';
    for (const index of FOREST_HEART_ROTORS) {
      const cell = this.cells[index], target = rootArtwork(board[index]).angle; if (carried.has(index)) { cell.angle = target; continue; }
      const start = (index % 5) * .11 + Math.abs(Math.floor(index / 5) - 2) * .04, t = clamp((progress - start) / .48);
      if (t <= 0) continue;
      if (cell.from === undefined) { cell.spinning = false; cell.from = cell.angle; cell.to = Math.ceil((cell.angle + 130 - target) / 180) * 180 + target; cell.landed = false; }
      cell.angle = cell.from + (cell.to! - cell.from) * back(t); cell.speed *= 1 - t; cell.bump = t > .7 ? Math.sin((t - .7) / .3 * Math.PI) : 0;
      if (t >= 1 && !cell.landed) { cell.landed = true; cell.angle = target; cell.speed = 0; this.onLand?.(index); } else if (cell.landed) cell.angle = target;
    }
    for (const cell of this.cells) cell.dim = .16 * (1 - progress);
    this.dirty = true;
  }
  turn(index: number, from: number, to: number, progress: number) { const cell = this.cells[index]; cell.angle = from + (to - from) * back(progress); cell.bump = Math.sin(progress * Math.PI) * .6; this.dirty = true; }
  /** Advances decorative motion. Returns whether another frame is needed. */
  step(dt: number) {
    let moving = false;
    for (const cell of this.cells) {
      if (cell.spinning) { cell.speed += (640 - cell.speed) * Math.min(1, dt * 7); cell.angle += cell.speed * dt; moving = true; }
      const target = cell.hot && this.choice ? 1 : 0; if (Math.abs(target - cell.hover) > .01) { cell.hover += (target - cell.hover) * Math.min(1, dt * 10); moving = true; } else cell.hover = target;
    }
    return moving || this.dirty || !!this.light || this.held.size > 0 || this.choice;
  }
  private tint(energy: number) {
    const existing = this.tints.get(energy); if (existing) return existing;
    const canvas = this.roots.ownerDocument.createElement('canvas'); canvas.width = 1536; canvas.height = 384; const x = canvas.getContext('2d', { willReadFrequently: energy !== 1 })!;
    x.drawImage(this.roots, 0, 384, 1536, 384, 0, 0, 1536, 384);
    if (energy !== 1) try {
      const [red, green, blue] = [1, 3, 5].map(i => parseInt(FOREST_ENERGY[energy].color.slice(i, i + 2), 16)), data = x.getImageData(0, 0, 1536, 384), a = data.data;
      for (let i = 0; i < a.length; i += 4) {
        if (!a[i + 3]) continue; const mint = clamp((Math.min(a[i + 1], a[i + 2]) - a[i] + 22) / 62); if (!mint) continue;
        const level = Math.max(a[i + 1], a[i + 2]) / 255, white = clamp((a[i] / 255 - .35) * 1.6);
        [red, green, blue].forEach((channel, k) => { a[i + k] += (Math.min(255, (channel + (255 - channel) * white) * level) - a[i + k]) * mint; });
      }
      x.putImageData(data, 0, 0);
    } catch { /* The mint light stays readable when pixels are unavailable. */ }
    this.tints.set(energy, canvas); return canvas;
  }
  private sprite(x: CanvasRenderingContext2D, column: number, cx: number, cy: number, size: number, angle: number, source: CanvasImageSource = this.roots) {
    const [shift, scale] = adjust[column], side = size * scale + 1;
    x.save(); x.translate(cx, cy); x.rotate(angle * Math.PI / 180); x.drawImage(source, column * 384 + 1, 1, 382, 382, -side / 2 + shift * size, -side / 2, side, side); x.restore();
  }
  draw(now: number) {
    const g = this.geometry; this.dirty = false; if (!g || this.board.length !== 25 || !this.roots.complete || !this.tile.complete) return;
    const x = this.x, { board: b, cell: c } = g, breath = .5 + .5 * Math.sin(now / 520);
    x.save(); x.translate(4, 4); x.clearRect(-4, -4, b + 8, b + 8);
    this.cells.forEach((cell, index) => {
      const left = index % 5 * c, top = Math.floor(index / 5) * c, cx = left + c / 2, cy = top + c / 2, rotor = FOREST_HEART_ROTORS.includes(index), { column, angle } = rootArtwork(this.board[index]);
      const size = c * (1 + cell.bump * .07), shown = rotor ? cell.angle : angle;
      x.save(); x.beginPath(); x.rect(left, top, c + .4, c + .4); x.clip(); x.drawImage(this.tile, left, top, c, c);
      if (rotor && cell.speed > 260) { x.globalAlpha = .42; for (let ghost = 0; ghost < 3; ghost++) this.sprite(x, column, cx, cy, size, shown - ghost * cell.speed * .02); x.globalAlpha = 1; }
      else this.sprite(x, column, cx, cy, size, shown);
      if (cell.hover > .01) { x.globalAlpha = .5 * cell.hover * (.8 + .2 * breath); x.globalCompositeOperation = 'lighter'; this.sprite(x, column, cx, cy, size, shown + 90); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; }
      const dim = this.choice && !rotor ? .3 : cell.dim; if (dim > .01) { x.fillStyle = `rgba(4,10,14,${dim})`; x.fillRect(left, top, c + 1, c + 1); }
      x.restore(); this.write(index, '--turn', Number(((shown % 360) + 360).toFixed(3)) % 360 + 'deg');
    });
    if (this.light) this.drawLight(x, now);
    for (const index of this.held) this.vine(x, index, now);
    if (this.choice) for (const index of FOREST_HEART_ROTORS) this.offer(x, index, now, breath);
    x.restore();
  }
  /** The same numbers stay on the buttons for accessibility tools, diagnostics and browser checks. */
  private write(index: number, name: string, value: string) { const key = index + name; if (this.written.get(key) === value) return; this.written.set(key, value); this.buttons[index].style.setProperty(name, value); }
  private offer(x: CanvasRenderingContext2D, index: number, now: number, breath: number) {
    const c = this.geometry!.cell, left = index % 5 * c, top = Math.floor(index / 5) * c, hover = this.cells[index].hover, inset = c * .06;
    const shine = x.createRadialGradient(left + c / 2, top + c / 2, c * .1, left + c / 2, top + c / 2, c * .62);
    shine.addColorStop(0, `rgba(255,236,170,${.13 + .12 * breath + hover * .22})`); shine.addColorStop(1, 'rgba(255,214,120,0)');
    x.globalCompositeOperation = 'lighter'; x.fillStyle = shine; x.fillRect(left, top, c, c); x.globalCompositeOperation = 'source-over';
    x.strokeStyle = `rgba(255,232,160,${.55 + .3 * breath + hover * .3})`; x.lineWidth = 1.5 + hover * 1.5; x.beginPath(); x.roundRect(left + inset, top + inset, c - inset * 2, c - inset * 2, c * .09); x.stroke();
    const radius = Math.max(5, c * .105), gx = left + c - radius * 1.6, gy = top + c - radius * 1.6, from = hover > .2 ? now / 260 : now / 1600 + index, to = from + 4.6, tip = to + Math.PI / 2;
    x.fillStyle = '#0b2119d0'; x.beginPath(); x.arc(gx, gy, radius * 1.45, 0, 7); x.fill(); x.lineWidth = Math.max(1.6, c * .022); x.strokeStyle = `rgba(255,246,205,${.65 + .3 * breath})`;
    x.beginPath(); x.arc(gx, gy, radius, from, to); x.stroke();
    const px = gx + radius * Math.cos(to), py = gy + radius * Math.sin(to); x.beginPath(); x.moveTo(px + Math.cos(tip - 2.5) * radius * .7, py + Math.sin(tip - 2.5) * radius * .7); x.lineTo(px, py); x.lineTo(px + Math.cos(tip + 2.5) * radius * .7, py + Math.sin(tip + 2.5) * radius * .7); x.stroke();
  }
  private vine(x: CanvasRenderingContext2D, index: number, now: number) {
    const c = this.geometry!.cell, left = index % 5 * c, top = Math.floor(index / 5) * c, arms = Object.values(rootArms(this.board[index])), points = [...arms[0], ...[...arms[1]].reverse().slice(1)], count = 40, grow = this.cells[index].grow, inset = c * .05;
    x.save(); x.lineCap = 'round';
    for (const phase of [0, Math.PI]) for (let i = 0; i < count * grow; i++) {
      const t = i / count; if (Math.cos(t * 20 + phase) <= -.25) continue;
      const a = along(points, t).point, z = along(points, Math.min(1, t + 1 / count)).point, dx = z[0] - a[0], dy = z[1] - a[1], length = Math.hypot(dx, dy) || 1, n0 = Math.sin(t * 20 + phase) * .095, n1 = Math.sin((t + 1 / count) * 20 + phase) * .095;
      x.strokeStyle = i % 2 ? '#ffe39a' : '#d99f32'; x.lineWidth = c * .03; x.shadowColor = '#ffc74a'; x.shadowBlur = c * .07;
      x.beginPath(); x.moveTo(left + (a[0] - dy / length * n0) * c, top + (a[1] + dx / length * n0) * c); x.lineTo(left + (z[0] - dy / length * n1) * c, top + (z[1] + dx / length * n1) * c); x.stroke();
    }
    x.shadowBlur = 0; x.strokeStyle = `rgba(255,214,110,${grow * (.25 + .55 * (.6 + .4 * Math.sin(now / 600 + index)))})`; x.lineWidth = 2; x.beginPath(); x.roundRect(left + inset, top + inset, c - inset * 2, c - inset * 2, c * .08); x.stroke(); x.restore();
  }
  private drawLight(x: CanvasRenderingContext2D, now: number) {
    const light = this.light!, g = this.geometry!, { board: b, cell: c } = g, { segments, wave } = light.plan, key = this.board.join() + ':' + this.energy;
    if (this.litKey !== key) {
      const y = this.lit.getContext('2d')!; y.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); y.clearRect(0, 0, b, b);
      for (const index of wave.keys()) { const { column, angle } = rootArtwork(this.board[index]), left = index % 5 * c, top = Math.floor(index / 5) * c; y.save(); y.beginPath(); y.rect(left, top, c + .4, c + .4); y.clip(); this.sprite(y, column, left + c / 2, top + c / 2, c, angle, this.tint(this.energy)); y.restore(); }
      this.litKey = key;
    }
    const y = this.mask.getContext('2d')!, heads: Point[] = []; y.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); y.globalCompositeOperation = 'source-over'; y.clearRect(0, 0, b, b); y.lineCap = y.lineJoin = 'round'; y.lineWidth = c * .34; y.strokeStyle = '#fff';
    const filled = new Map<number, number>();
    segments.forEach((segment, i) => {
      const t = clamp((light.time - segment.at) / segment.length); filled.set(segment.cell, (filled.get(segment.cell) ?? 0) + t); if (t <= 0) return;
      const left = segment.cell % 5 * c, top = Math.floor(segment.cell / 5) * c, { index, point } = along(segment.points, t);
      y.save(); y.beginPath(); y.rect(left, top, c + .4, c + .4); y.clip(); y.beginPath();
      segment.points.slice(0, index + 1).forEach((p, n) => y[n ? 'lineTo' : 'moveTo'](left + p[0] * c, top + p[1] * c)); y.lineTo(left + point[0] * c, top + point[1] * c); y.stroke(); y.restore();
      if (t < 1) heads.push([left + point[0] * c, top + point[1] * c]);
      else if (!light.ended.has(i)) { light.ended.add(i); if (segment.dead) { const end = segment.points[segment.points.length - 1]; this.onDead?.(g.x + left + end[0] * c, g.y + top + end[1] * c); } }
    });
    for (let index = 0; index < 25; index++) { const count = segments.filter(s => s.cell === index).length, value = count ? (filled.get(index) ?? 0) / count : 0; this.write(index, '--sap', String(Number(value.toFixed(4)))); this.buttons[index].classList.toggle('fh-powered', value >= 1); }
    y.globalCompositeOperation = 'source-in'; y.setTransform(1, 0, 0, 1, 0, 0); y.drawImage(this.lit, 0, 0);
    x.globalAlpha = light.fade; x.drawImage(this.mask, 0, 0, b, b);
    const z = this.glow.getContext('2d')!; z.clearRect(0, 0, 90, 90); z.drawImage(this.mask, 0, 0, 90, 90); x.globalCompositeOperation = 'lighter'; x.globalAlpha = light.fade * (.42 + .1 * Math.sin(now / 420)); x.drawImage(this.glow, -2, -2, b + 4, b + 4);
    x.lineCap = 'round'; x.lineWidth = c * .05; x.strokeStyle = '#ffffffb0'; x.globalAlpha = light.fade * .5; x.setLineDash([c * .13, c * .55]); // living sap keeps running from the source
    for (const segment of segments) {
      if (light.time - segment.at < segment.length) continue; const left = segment.cell % 5 * c, top = Math.floor(segment.cell / 5) * c;
      x.lineDashOffset = -now / 1000 * c * .55 + (segment.inward ? 0 : c * .3); x.beginPath(); segment.points.forEach((p, n) => x[n ? 'lineTo' : 'moveTo'](left + p[0] * c, top + p[1] * c)); x.stroke();
    }
    x.setLineDash([]); x.globalAlpha = 1;
    for (const [hx, hy] of heads) { const radius = c * .3, shine = x.createRadialGradient(hx, hy, 0, hx, hy, radius); shine.addColorStop(0, '#fff'); shine.addColorStop(.25, FOREST_ENERGY[this.energy].color); shine.addColorStop(1, 'transparent'); x.fillStyle = shine; x.beginPath(); x.arc(hx, hy, radius, 0, 7); x.fill(); this.onHead?.(g.x + hx, g.y + hy); }
    x.globalCompositeOperation = 'source-over';
  }
  /** Drops diagnostics of a light that is no longer shown. */
  unlight() { for (let index = 0; index < 25; index++) { this.write(index, '--sap', '0'); this.buttons[index].classList.remove('fh-powered'); } }
  state() { return { spinning: this.cells.filter(cell => cell.spinning).length, held: [...this.held], lit: !!this.light, choice: this.choice }; }
}
