interface Point { x: number; y: number }
export class MagicEffects {
  private context: CanvasRenderingContext2D;
  private frame = 0;
  enabled = false;

  constructor(private canvas: HTMLCanvasElement, private playSound: (kind: 'cast' | 'win' | 'portal' | 'bonus') => void) {
    this.context = canvas.getContext('2d')!;
  }

  cue(kind: 'cast' | 'win' | 'portal' | 'bonus') {
    if (!this.enabled) return;
    this.playSound(kind);
  }

  cast(hero: DOMRect, target: DOMRect) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(this.frame);
    const bounds = this.canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(bounds.width * ratio);
    this.canvas.height = Math.round(bounds.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const from: Point = { x: hero.left + hero.width * 0.23 - bounds.left, y: hero.top + hero.height * 0.2 - bounds.top };
    const to: Point = { x: target.left + target.width * 0.5 - bounds.left, y: target.top + target.height * 0.45 - bounds.top };
    const started = performance.now();
    const render = (time: number) => {
      const t = Math.min(1, (time - started) / 1100), c = this.context;
      c.clearRect(0, 0, bounds.width, bounds.height);
      const opacity = Math.sin(Math.PI * t);
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 38; i++) {
        const p = Math.max(0, Math.min(1, t * 1.5 - i * 0.012));
        const x = from.x + (to.x - from.x) * p;
        const y = from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * 95;
        c.beginPath(); c.fillStyle = `rgba(139,255,209,${opacity * (1 - i / 42)})`;
        c.shadowColor = '#65ffbb'; c.shadowBlur = 18;
        c.arc(x + Math.sin(i * 2.4 + t * 15) * 6, y + Math.cos(i * 2.4 + t * 12) * 9, i % 7 === 0 ? 3 : 1.5, 0, Math.PI * 2); c.fill();
      }
      c.shadowBlur = 0;
      if (t < 1) this.frame = requestAnimationFrame(render);
      else c.clearRect(0, 0, bounds.width, bounds.height);
    };
    this.frame = requestAnimationFrame(render);
  }

  destroy() { cancelAnimationFrame(this.frame); }
}
