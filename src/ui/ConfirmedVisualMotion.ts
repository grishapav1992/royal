export class ConfirmedVisualMotion {
  private animations: Animation[] = [];
  private finish?: (completed: boolean) => void;
  private timer?: ReturnType<typeof setTimeout>;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private preference = () => this.cancel();
  constructor() { this.reduced.addEventListener('change', this.preference); }
  run(nodes: HTMLElement[], duration: number, valid: () => boolean, kind: 'dice' | 'cell' | 'cashout'): Promise<boolean> {
    this.cancel();
    if (!valid()) return Promise.resolve(false);
    if (this.reduced.matches || document.hidden || !nodes.length) return Promise.resolve(true);
    return new Promise(resolve => {
      const finish = (completed: boolean) => {
        if (this.finish !== finish) return;
        clearTimeout(this.timer); this.timer = undefined; this.finish = undefined;
        this.animations.forEach(animation => animation.cancel()); this.animations = [];
        resolve(completed && valid());
      };
      this.finish = finish;
      try {
        this.animations = nodes.map((node, index) => node.animate(kind === 'dice' ? [
          {transform: 'translateY(0) rotate(0deg)'},
          {transform: `translate(${index ? -12 : 12}px,-18px) rotate(${index ? -210 : 210}deg)`, offset: .35},
          {transform: `translate(${index ? 6 : -6}px,-6px) rotate(${index ? -390 : 390}deg)`, offset: .7},
          {transform: `translateY(0) rotate(${index ? -540 : 540}deg)`},
        ] : kind === 'cell' ? [
          {transform: 'perspective(450px) rotateY(0deg) scale(1)'},
          {transform: 'perspective(450px) rotateY(170deg) scale(1.12)', offset: .55},
          {transform: 'perspective(450px) rotateY(360deg) scale(1)'},
        ] : [{transform: 'scale(1)'}, {transform: 'scale(1.06)', offset: .5}, {transform: 'scale(1)'}],
        {duration, easing: 'cubic-bezier(.2,.65,.2,1)'}));
        Promise.all(this.animations.map(animation => animation.finished)).then(() => finish(true), () => finish(false));
        this.timer = setTimeout(() => finish(false), duration + 350);
      } catch { finish(false); }
    });
  }
  cancel() { this.finish?.(false); }
  destroy() { this.cancel(); this.reduced.removeEventListener('change', this.preference); }
}
