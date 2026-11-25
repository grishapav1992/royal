type Kind = 'grass' | 'dust' | 'spark' | 'paper' | 'smoke';
type P = { kind: Kind; x: number; y: number; vx: number; vy: number; g: number; drag: number; age: number; life: number; size: number; grow: number; color: string; rot: number; vr: number; floor?: number };
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** Short-lived decoration only. Nothing here knows about money or future results. */
export class Effects {
  private list: P[] = [];
  private smokes = new Map<string, HTMLCanvasElement>();
  get count() { return this.list.length; }
  clear() { this.list = []; }
  private add(p: Partial<P> & Pick<P, 'kind' | 'x' | 'y' | 'color'>) {
    if (this.list.length > 420) return;
    this.list.push({ vx: 0, vy: 0, g: 0, drag: 0, age: 0, life: 1, size: 2, grow: 0, rot: rand(0, 6.28), vr: 0, ...p });
  }
  turf(x: number, y: number, h: number, count: number, dir: number, power: number) {
    for (let i = 0; i < count; i++) this.add({ kind: 'grass', x: x + rand(-.01, .01) * h, y, vx: (dir * rand(.1, .55) + rand(-.16, .16)) * h * power, vy: -rand(.15, .75) * h * power, g: h * 1.9, life: rand(.45, .95), size: rand(.003, .0075) * h, vr: rand(-14, 14), color: pick(['#3f7d22', '#5fa32f', '#2f5f1c', '#7cb83c', '#5a4526']), floor: y + rand(.004, .03) * h });
  }
  dust(x: number, y: number, size: number, count: number, color = '#e9edd2') {
    for (let i = 0; i < count; i++) this.add({ kind: 'dust', x: x + rand(-.5, .5) * size, y: y + rand(-.1, .1) * size, vx: rand(-.9, .9) * size, vy: -rand(.05, .5) * size, drag: 2.4, life: rand(.35, .7), size: size * rand(.12, .26), grow: size * .5, color });
  }
  sparks(x: number, y: number, size: number) {
    for (let i = 0; i < 14; i++) { const a = rand(0, 6.28), v = rand(.8, 2.6) * size; this.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 4, life: rand(.18, .36), size: size * .05, color: '#fff' }); }
  }
  confetti(w: number, h: number, colors: readonly string[], count: number) {
    for (let i = 0; i < count; i++) this.add({ kind: 'paper', x: rand(-.05, 1.05) * w, y: rand(-.5, -.02) * h, vx: rand(-.05, .05) * h, vy: rand(.10, .26) * h, g: h * .03, life: rand(3.2, 5.4), size: rand(.006, .012) * h + 2, vr: rand(-7, 7), color: pick(colors) });
  }
  cannon(x: number, y: number, h: number, dir: number, colors: readonly string[], count: number) {
    for (let i = 0; i < count; i++) this.add({ kind: 'paper', x, y, vx: dir * rand(.15, .9) * h, vy: -rand(.7, 1.5) * h, g: h * .95, drag: 1.1, life: rand(2.2, 3.6), size: rand(.006, .012) * h + 2, vr: rand(-11, 11), color: pick(colors) });
  }
  smoke(x: number, y: number, size: number, color: string) {
    this.add({ kind: 'smoke', x, y, vx: rand(-.35, .75) * size, vy: -rand(1.7, 2.6) * size, drag: .35, life: rand(1.1, 1.9), size: size * .22, grow: size * .55, color });
  }
  step(dt: number) {
    for (const p of this.list) {
      p.age += dt; const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy = p.vy * k + p.g * dt;
      if (p.kind === 'paper') { p.vx += Math.sin(p.age * 5 + p.rot) * 40 * dt; p.vy = Math.min(p.vy, 190); }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.size += p.grow * dt;
      if (p.floor !== undefined && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -.18; p.vx *= .4; p.vr *= .3; }
    }
    this.list = this.list.filter(p => p.age < p.life);
  }
  private puff(color: string) {
    let n = this.smokes.get(color); if (n) return n;
    n = document.createElement('canvas'); n.width = n.height = 64; const c = n.getContext('2d')!, g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, color + 'c0'); g.addColorStop(.5, color + '58'); g.addColorStop(1, color + '00'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); this.smokes.set(color, n); return n;
  }
  draw(c: CanvasRenderingContext2D, kinds: readonly Kind[]) {
    c.save();
    for (const p of this.list) {
      if (!kinds.includes(p.kind)) continue;
      const u = p.age / p.life;
      if (p.kind === 'smoke' || p.kind === 'dust') { c.globalAlpha = (p.kind === 'dust' ? .5 : .42) * Math.sin(Math.PI * Math.min(1, u * .85 + .15)); c.drawImage(this.puff(p.color), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2); continue; }
      c.globalAlpha = p.kind === 'paper' ? Math.min(1, (1 - u) * 4) : 1 - u * u; c.fillStyle = p.color;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      if (p.kind === 'paper') c.scale(1, Math.cos(p.age * 8 + p.rot));
      if (p.kind === 'spark') { c.rotate(Math.atan2(p.vy, p.vx) - p.rot); c.fillRect(-p.size * 3, -p.size * .4, p.size * 6, p.size * .8); }
      else c.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
      c.restore();
    }
    c.restore();
  }
}
