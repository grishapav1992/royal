const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export type Shot = { zoom: number; x: number; y: number; rate: number };

/** A television camera: smooth follow plus a short decaying knock. Coordinates are scene pixels. */
export class Camera {
  zoom = 1.015; x = 0; y = 0;
  private knockSize = 0; private knockAge = 9; private placed = '';
  snap(w: number, h: number) { const key = w + ':' + h; if (this.placed !== key) { this.placed = key; this.x = w / 2; this.y = h / 2; this.zoom = 1.015; } }
  reset(w: number, h: number) { this.x = w / 2; this.y = h / 2; this.zoom = 1.015; this.knockAge = 9; }
  knock(size: number) { this.knockSize = size; this.knockAge = 0; }
  follow(target: Shot, dt: number) {
    const k = 1 - Math.exp(-target.rate * dt);
    this.zoom += (target.zoom - this.zoom) * k; this.x += (target.x - this.x) * k; this.y += (target.y - this.y) * k;
    this.knockAge += dt;
  }
  apply(c: CanvasRenderingContext2D, w: number, h: number) {
    const a = this.knockSize * Math.exp(-this.knockAge * 11), z = this.zoom + (a > .05 ? a / h * 2.4 : 0);
    // Never expose the outside of the plate.
    const x = clamp(this.x + Math.sin(this.knockAge * 61) * a, w / 2 / z, w - w / 2 / z), y = clamp(this.y + Math.cos(this.knockAge * 53) * a, h / 2 / z, h - h / 2 / z);
    c.translate(w / 2, h / 2); c.scale(z, z); c.translate(-x, -y);
  }
}
