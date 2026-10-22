import type { Hero } from '../../src/shared/neopolisMath';

type Point = { x: number; y: number };
type Effect = Hero | 'win' | 'finisher' | 'boss-hit' | 'boss-defeated' | 'boss-arrival' | 'shield-break' | 'scatter' | 'emblem';
type Burst = { kind: Effect; from: Point; to: Point; points: Point[]; age: number; color: string; seed: number };
type Particle = Point & { vx: number; vy: number; life: number; age: number; size: number; color: string };

/** Presentation only. Events are emitted by confirmed replay frames and landed
 * symbols, never by a random suggestion of a bonus or an unconfirmed outcome. */
export class NeopolisEffects {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private observer: ResizeObserver;
  private bursts: Burst[] = [];
  private particles: Particle[] = [];
  private request = 0;
  private last = 0;
  private alive = true;
  private width = 1;
  private height = 1;

  constructor(private stage: HTMLElement, private paused: () => boolean, private reduced: () => boolean) {
    this.canvas = stage.ownerDocument.createElement('canvas');
    this.canvas.className = 'np-effects'; this.canvas.setAttribute('aria-hidden','true');
    stage.append(this.canvas); this.ctx = this.canvas.getContext('2d');
    const resize = () => {
      this.width = stage.clientWidth; this.height = stage.clientHeight;
      const scale = Math.min(2, stage.ownerDocument.defaultView!.devicePixelRatio || 1);
      this.canvas.width = Math.max(1, Math.round(this.width * scale));
      this.canvas.height = Math.max(1, Math.round(this.height * scale));
      this.ctx?.setTransform(scale,0,0,scale,0,0);
    };
    this.observer = new ResizeObserver(resize); this.observer.observe(stage); resize();
  }
  private point(element: Element | null, y = .5): Point {
    if (!element) return {x:this.width * .5,y:this.height * .5};
    const parent = this.stage.getBoundingClientRect(), box = element.getBoundingClientRect();
    const scale = parent.width / this.width || 1;
    return {x:(box.left - parent.left + box.width / 2) / scale,y:(box.top - parent.top + box.height * y) / scale};
  }
  play(kind: Effect, cells: number[] = [], hero?: Hero) {
    if (!this.alive || this.reduced() || !this.ctx) return;
    const grid = Array.from(this.stage.querySelectorAll('[role=gridcell]'));
    const points = cells.map(cell => this.point(grid[cell]));
    const field = this.point(this.stage.querySelector('.np-board'));
    const target = this.point(this.stage.querySelector('.np-villain'),.42);
    const actor = this.point(hero ? this.stage.querySelector('[data-hero="' + hero + '"] .np-portrait') : null);
    const color = kind === 'granite' ? '#ffb957' : kind === 'impulse' ? '#73ecff' : kind === 'prism' ? '#d0a2ff'
      : kind === 'win' ? '#ffe39c' : kind === 'emblem' ? ({granite:'#ffb957',impulse:'#73ecff',prism:'#d0a2ff'}[hero!])
      : kind === 'finisher' ? '#fff1c0' : '#d7a1ff';
    const boss = ['boss-hit','boss-defeated','shield-break'].includes(kind);
    const to = boss || kind === 'finisher' ? target : kind === 'emblem' ? actor : points[0] ?? field;
    const from = kind === 'emblem' ? points[0] ?? field : hero ? actor : field;
    this.bursts.push({kind,from,to,points,age:0,color,seed:Math.random() * 20});
    if (this.bursts.length > 14) this.bursts.shift();
    const count = kind === 'boss-defeated' || kind === 'finisher' ? 60 : kind === 'emblem' ? 10 : kind === 'win' ? 18 : 32;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 25 + Math.random() * (kind === 'boss-defeated' ? 230 : 125);
      const origin = points.length && !boss && kind !== 'finisher' ? points[i % points.length] : to;
      this.particles.push({...origin,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,age:0,life:550+Math.random()*650,size:1+Math.random()*2.8,color});
    }
    if (this.particles.length > 240) this.particles.splice(0,this.particles.length - 240);
    if (!this.request) { this.last = performance.now(); this.request = requestAnimationFrame(this.tick); }
  }
  private bolt(from: Point, to: Point, color: string, age: number, seed: number, alpha: number, width = 2) {
    const ctx = this.ctx!; ctx.beginPath(); ctx.moveTo(from.x,from.y);
    for (let i = 1; i <= 18; i++) {
      const t = i / 18, jitter = Math.sin(i * 7 + seed + Math.floor(age / 45)) * 13 * Math.sin(t * Math.PI);
      ctx.lineTo(from.x + (to.x-from.x)*t + jitter,from.y + (to.y-from.y)*t - jitter*.55);
    }
    ctx.strokeStyle=color; ctx.globalAlpha=alpha; ctx.lineWidth=width; ctx.shadowColor=color; ctx.shadowBlur=16; ctx.stroke();
  }
  private tick = (now: number) => {
    this.request = 0;
    if (!this.alive) return;
    const delta = Math.min(50,now-this.last); this.last=now;
    if (!this.paused()) {
      const ctx=this.ctx!; ctx.clearRect(0,0,this.width,this.height); ctx.globalCompositeOperation='lighter';
      for (const burst of this.bursts) {
        burst.age += delta;
        const t=Math.min(1,burst.age/1000), alpha=(1-t)**1.6, {to,from,color}=burst;
        ctx.save(); ctx.globalAlpha=alpha; ctx.strokeStyle=color; ctx.shadowColor=color; ctx.shadowBlur=18;
        if (burst.kind === 'impulse' || burst.kind === 'emblem') {
          const dest=burst.kind==='emblem'?{x:from.x+(to.x-from.x)*Math.min(1,t*2),y:from.y+(to.y-from.y)*Math.min(1,t*2)}:to;
          this.bolt(from,dest,color,burst.age,burst.seed,alpha,3);
          if (burst.kind==='impulse') for (const point of burst.points) this.bolt(to,point,'#e6ffff',burst.age,burst.seed+3,alpha,1.5);
        } else if (burst.kind === 'finisher') {
          for (const [index,hero] of (['granite','impulse','prism'] as const).entries()) {
            const actor=this.point(this.stage.querySelector('[data-hero="'+hero+'"]'));
            this.bolt(actor,to,['#ffbc65','#72eaff','#cfa3ff'][index],burst.age,burst.seed+index,alpha,4);
          }
        } else if (burst.kind === 'prism' || burst.kind === 'boss-arrival') {
          ctx.translate(to.x,to.y); ctx.rotate(t*2);
          for(let ring=0;ring<3;ring++){ctx.beginPath();ctx.ellipse(0,0,20+t*(100+ring*28),12+t*(55+ring*12),ring*Math.PI/3,0,Math.PI*2);ctx.lineWidth=2;ctx.stroke();}
        } else {
          const radius=12+t*(burst.kind==='boss-defeated'?170:100);
          ctx.beginPath();ctx.arc(to.x,to.y,radius,0,Math.PI*2);ctx.lineWidth=(1-t)*5;ctx.stroke();
          if(burst.kind==='shield-break'||burst.kind==='boss-defeated'){
            for(let i=0;i<14;i++){const a=i*Math.PI/7+t;ctx.beginPath();ctx.moveTo(to.x+Math.cos(a)*radius,to.y+Math.sin(a)*radius);ctx.lineTo(to.x+Math.cos(a)*(radius+22),to.y+Math.sin(a)*(radius+22));ctx.stroke();}
          }
        }
        ctx.restore();
      }
      for (const particle of this.particles) {
        particle.age+=delta;particle.x+=particle.vx*delta/1000;particle.y+=particle.vy*delta/1000;particle.vy+=45*delta/1000;
        ctx.globalAlpha=Math.max(0,1-particle.age/particle.life);ctx.fillStyle=particle.color;ctx.shadowColor=particle.color;ctx.shadowBlur=8;
        ctx.fillRect(particle.x,particle.y,particle.size,particle.size);
      }
      this.bursts=this.bursts.filter(burst=>burst.age<1000);this.particles=this.particles.filter(particle=>particle.age<particle.life);
      ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.globalCompositeOperation='source-over';
    }
    if(this.bursts.length||this.particles.length)this.request=requestAnimationFrame(this.tick);
    else this.ctx?.clearRect(0,0,this.width,this.height);
  };
  clear() {
    cancelAnimationFrame(this.request);this.request=0;this.bursts=[];this.particles=[];
    this.ctx?.clearRect(0,0,this.width,this.height);
  }
  destroy() {this.alive=false;this.clear();this.observer.disconnect();this.canvas.remove();}
}

