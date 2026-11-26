/** Pure timelines: the state at any moment depends only on the script and the time. */
export const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
export const smooth=(t:number)=>{t=clamp(t);return t*t*(3-2*t);};
export const EASE={
  io:smooth,
  out:(t:number)=>1-(1-clamp(t))**3,
  in:(t:number)=>clamp(t)**2.2,
  lin:(t:number)=>clamp(t),
  back:(t:number)=>{t=clamp(t);const c=1.6;return 1+(c+1)*(t-1)**3+c*(t-1)**2;},
};
export type Ease=keyof typeof EASE;
export type State={pose:string;face:1|-1;x:number;y:number;z:number;rot:number;pv:number;bend:number;sx:number;sy:number;ghost:boolean;alpha:number;since:number;prev:string;idle:boolean;jit:number;spin:boolean};
type Clip={t:number;d:number;pose:string;prev:string;face:1|-1;x0:number;x1:number;y0:number;y1:number;z0:number;z1:number;r0:number;r1:number;b0:number;b1:number;a0:number;a1:number;arc:number;pv:number;ease:Ease;ghost:boolean;idle:boolean;jit:number;pop:number};
export type To={pose?:string;face?:1|-1;x?:number;y?:number;z?:number;rot?:number;from?:number;arc?:number;pv?:number;bend?:number;ease?:Ease;ghost?:boolean;idle?:boolean;jit?:number;pop?:number;alpha?:number};
export class Track{
  clips:Clip[]=[];
  constructor(public id:string,x:number,face:1|-1,z=0,pose='b0',alpha=1){
    this.clips.push({t:-1e6,d:0,pose,prev:pose,face,x0:x,x1:x,y0:0,y1:0,z0:z,z1:z,r0:0,r1:0,b0:0,b1:0,a0:alpha,a1:alpha,arc:0,pv:0,ease:'io',ghost:false,idle:true,jit:0,pop:0});
  }
  /** A later instruction that begins earlier interrupts the previous plan. */
  to(t:number,d:number,o:To){
    while(this.clips.length>1&&this.clips.at(-1)!.t>=t-1e-6)this.clips.pop();
    const s=this.at(t),last=this.clips.at(-1)!;
    const same=(o.pose??s.pose)===s.pose;
    // A finished tumble is a full turn: normalise so the next clip does not unwind it.
    const turn=Math.PI*2,r=Math.abs(s.rot)>3.2?s.rot-Math.round(s.rot/turn)*turn:s.rot;
    this.clips.push({t,d:Math.max(.001,d),pose:o.pose??s.pose,prev:s.pose,face:o.face??s.face,x0:s.x,x1:o.x??s.x,y0:s.y,y1:o.y??0,z0:s.z,z1:o.z??s.z,r0:o.from??r,r1:o.rot??0,b0:s.bend,b1:o.bend??0,a0:s.alpha,a1:o.alpha??s.alpha,arc:o.arc??0,pv:o.pv??last.pv,ease:o.ease??'io',ghost:!!o.ghost,idle:!!o.idle,jit:o.jit??0,pop:o.pop??(same?0:.045)});
    return this;
  }
  at(t:number):State{
    let i=this.clips.length-1;while(i>0&&this.clips[i].t>t)i--;
    const c=this.clips[i],u=clamp((t-c.t)/c.d||0),e=c.d?EASE[c.ease](u):1,since=t-c.t;
    const spring=c.pop*Math.exp(-13*since)*Math.cos(30*since);
    const live=since<c.d+.02;
    return {pose:c.pose,prev:c.prev,face:c.face,x:lerp(c.x0,c.x1,e)+(c.jit&&live?Math.sin(t*140)*c.jit:0),y:Math.max(0,lerp(c.y0,c.y1,e)+c.arc*4*u*(1-u)),z:lerp(c.z0,c.z1,e),rot:lerp(c.r0,c.r1,e),pv:c.pv,bend:lerp(c.b0,c.b1,e),sx:1+spring*.7,sy:1-spring,ghost:c.ghost&&live,alpha:lerp(c.a0,c.a1,u),since,idle:c.idle,jit:c.jit,spin:Math.abs(c.r1-c.r0)>3};
  }
}
export function rng(seed:string){
  let h=2166136261;for(const c of seed)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
  return ()=>{h=(h+0x6d2b79f5)>>>0;let t=Math.imul(h^h>>>15,1|h);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
