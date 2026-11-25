export const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
export const ease={
  lin:(t:number)=>t,out:(t:number)=>1-(1-t)**3,in:(t:number)=>t*t*t,io:(t:number)=>t*t*(3-2*t),
  back:(t:number)=>{const c=1.5;return 1+(c+1)*(t-1)**3+c*(t-1)**2;},
};
type Tween={t:number;d:number;f:(u:number)=>void;e:(u:number)=>number;done:()=>void;loose:boolean};
/** Scene time. `hurry` finishes every owned movement at once and keeps the confirmed end state. */
export class Clock{
  now=0;private list:Tween[]=[];hurry=false;reduced=false;
  tween(d:number,f:(u:number)=>void,e:(u:number)=>number=ease.lin,loose=false){
    return new Promise<void>(done=>{f(e(0));this.list.push({t:this.now,d,f,e,done,loose});});
  }
  wait(d:number){return this.tween(d,()=>{});}
  step(dt:number){
    this.now+=dt;
    for(const w of [...this.list]){
      const u=this.hurry&&!w.loose||this.reduced&&!w.loose&&w.d<30?1:clamp((this.now-w.t)/Math.max(.0001,w.d));w.f(w.e(u));
      if(u>=1){this.list.splice(this.list.indexOf(w),1);w.done();}
    }
  }
}
