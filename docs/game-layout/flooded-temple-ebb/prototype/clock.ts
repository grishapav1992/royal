export const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
export const ease={lin:(t:number)=>t,out:(t:number)=>1-(1-t)**3,in:(t:number)=>t*t,io:(t:number)=>t*t*(3-2*t),back:(t:number)=>{const c=1.4;return 1+(c+1)*(t-1)**3+c*(t-1)**2;}};
type Tween={t:number;d:number;f:(u:number)=>void;e:(u:number)=>number;done:()=>void};
/** Scene time. `drop` forgets every owned movement, so skipping can never resume an old show. */
export class Clock{
  now=0;rate=1;private list:Tween[]=[];
  tween(d:number,f:(u:number)=>void,e:(u:number)=>number=ease.lin){return new Promise<void>(done=>{f(e(0));this.list.push({t:this.now,d:d/this.rate,f,e,done});});}
  wait(d:number){return this.tween(d,()=>{});}
  after(d:number,f:()=>void){void this.wait(d).then(f);}
  drop(){this.list=[];}
  step(dt:number){this.now+=dt;for(const w of [...this.list]){if(!this.list.includes(w))continue;const u=clamp((this.now-w.t)/Math.max(.0001,w.d));w.f(w.e(u));if(u>=1){const i=this.list.indexOf(w);if(i>=0)this.list.splice(i,1);w.done();}}}
}
