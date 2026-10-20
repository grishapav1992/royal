import './studio-motion.css';
import {slotLocalRect} from './slotKit/SlotGeometry';

/** Bounded presentation motion. The owner supplies confirmed facts and cancellation. */
export class StudioMotion {
  private pending = new Set<() => void>();
  constructor(private current: () => boolean) {}

  cancel() { for (const cancel of [...this.pending]) cancel(); }

  wait(ms: number): Promise<boolean> {
    return new Promise(resolve => {
      let finished = false;
      const finish = (ok: boolean) => { if (finished) return; finished = true; clearTimeout(timer); this.pending.delete(cancel); resolve(ok); };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(this.current()), ms);
      this.pending.add(cancel);
      if (!this.current()) cancel();
    });
  }

  tween(ms: number, draw: (progress: number) => void): Promise<boolean> {
    return new Promise(resolve => {
      let frame = 0, finished = false;
      const started = performance.now();
      const finish = (ok: boolean) => {
        if (finished) return;
        finished = true; cancelAnimationFrame(frame); clearTimeout(timer); this.pending.delete(cancel);
        if (ok && this.current()) draw(1);
        resolve(ok && this.current());
      };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(this.current()), ms + 250);
      const tick = (now: number) => {
        if (!this.current()) { finish(false); return; }
        const progress = Math.max(0, Math.min(1, (now - started) / ms));
        draw(1 - (1 - progress) ** 3);
        if (progress === 1) finish(true); else frame = requestAnimationFrame(tick);
      };
      this.pending.add(cancel);
      if (!this.current()) cancel(); else { draw(0); frame = requestAnimationFrame(tick); }
    });
  }

  element(node: Element, frames: Keyframe[], ms: number): Promise<boolean> {
    if (!this.current() || !node.isConnected) return Promise.resolve(false);
    return new Promise(resolve => {
      let finished = false;
      const animation = node.animate(frames, {duration: ms, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'both'});
      const finish = (ok: boolean) => {
        if (finished) return;
        finished = true; clearTimeout(timer); this.pending.delete(cancel); animation.cancel();
        resolve(ok && this.current() && node.isConnected);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(this.current()), ms + 250);
      this.pending.add(cancel);
      animation.finished.then(() => finish(true), () => finish(false));
    });
  }

  async carry(root:HTMLElement, sources:readonly Element[], target:Element, label:string, markup?:string) {
    if (!this.current() || !sources.length || !target.isConnected) return this.current();
    root.classList.add('studio-motion-root');
    const layer=document.createElement('div'); layer.className='studio-motion-layer'; layer.setAttribute('aria-hidden','true'); root.append(layer);
    const destination=slotLocalRect(target,layer);
    const tokens=sources.map(source=>{
      const rect=slotLocalRect(source,layer),token=document.createElement('div');token.className='studio-motion-carry';token.dataset.studioMotion=label;token.innerHTML=markup??source.innerHTML;layer.append(token);
      return {token,x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    });
    try { return await this.tween(600,progress=>tokens.forEach(({token,x,y})=>{token.style.left=`${x+(destination.left+destination.width/2-x)*progress}px`;token.style.top=`${y+(destination.top+destination.height/2-y)*progress}px`;token.style.transform=`translate(-50%,-50%) scale(${1-progress*.55})`;token.style.opacity=String(1-progress*.5);})); }
    finally { layer.remove(); }
  }

  async factor(panel:HTMLElement, factor:number) {
    const badge=document.createElement('span');badge.className='studio-motion-factor';badge.dataset.studioMotion='factor';badge.textContent=`×${factor}`;badge.setAttribute('aria-hidden','true');panel.append(badge);
    try { return await this.element(badge,[{transform:'translateY(14px) scale(.4)',opacity:0},{transform:'translateY(-2px) scale(1.15)',opacity:1,offset:.7},{transform:'translateY(0) scale(1)',opacity:1}],420); }
    finally { badge.remove(); }
  }
}
