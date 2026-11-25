/** One pirate: the existing eight drawn poses, gently deformed. A pose changes inside a short dip of the body, so two faces are never seen at once. */
import {loadImage,program,texture} from './gl';
export const POSES=['idle','win','blink','focus','surprise','bonus','soft','laugh'] as const;
export type Pose=typeof POSES[number];
export const portrait=(id:string,pose:Pose='idle')=>'assets/'+(id==='isabella'?(pose==='idle'?'captain':'captain-'+pose):'crew/'+id+'-'+pose)+'.webp';
const FRAG=`precision highp float;varying vec2 v;uniform sampler2D a;uniform float t,live,wind,light,flash;uniform vec3 tint;uniform vec4 body;
vec2 warp(vec2 p){
 vec2 c=vec2(.5,0.);float e=abs(p.x-.5);
 // breath lifts the shoulders and chest
 float br=sin(t*1.7)*live;float chest=exp(-pow((p.y-.36)/.17,2.));
 p.y+=br*.0034*smoothstep(.8,.15,p.y);p.x+=(p.x-.5)*-br*.010*chest;
 // weight shifts from foot to foot
 p.x+=sin(t*.62)*.0065*live*(1.-p.y);
 // the head follows half a beat later
 float head=smoothstep(.30,.10,p.y);float ha=(sin(t*.62-.7)*.011+sin(t*.31)*.008)*live*head;
 vec2 h=p-vec2(.52,.27);p=vec2(.52,.27)+vec2(h.x-ha*h.y*1.5,h.y+ha*h.x*.66);
 // hair and scarf: outer part of the upper half
 float hair=smoothstep(.10,.30,e)*smoothstep(.62,.30,p.y)*smoothstep(.0,.08,p.y);
 p.x+=hair*(sin(t*1.5+p.y*13.+sign(p.x-.5)*.8)*.0085+sin(t*2.7+p.y*23.)*.0035)*live*(1.+wind);
 p.y+=hair*sin(t*1.3+p.x*15.)*.0035*live*(1.+wind);
 // coat tails and cuffs: outer part of the lower half
 float coat=smoothstep(.14,.36,e)*smoothstep(.5,.85,p.y);
 p.x+=coat*(sin(t*1.25+p.y*9.+sign(p.x-.5)*1.1)*.011+sin(t*2.3+p.y*17.)*.004)*live*(1.+wind*1.3);
 return p;}
vec4 take(sampler2D s,vec2 p){if(p.x<0.||p.x>1.||p.y<0.||p.y>1.)return vec4(0.);return texture2D(s,p);}
void main(){vec2 p=(v-body.xy)/body.zw;vec2 q=warp(p);
 vec4 c=take(a,q);
 c.rgb*=tint;c.rgb+=c.a*flash*vec3(1.,.72,.38)*.32*smoothstep(1.,.0,p.x);
 // key light from the sun side keeps the figure inside the scene
 c.rgb*=1.+light*(.10-.16*p.x);
 c.rgb=min(c.rgb,vec3(c.a));
 gl_FragColor=c;}`;
export class Pirate{
  private gl?:WebGLRenderingContext;private sh?:ReturnType<typeof program>;private sets=new Map<string,Promise<Map<Pose,WebGLTexture>>>();
  private cur?:Map<Pose,WebGLTexture>;id='';pose:Pose='idle';private seen:Pose='idle';private swap=1;private gust=0;
  time=0;live=1;wind=0;tint:[number,number,number]=[1,1,1];flash=0;
  /** Gesture offsets in figure heights: x, y, rotation, squash. */
  g={x:0,y:0,r:0,s:0};private gest:{t:number;d:number;f:(u:number)=>{x?:number;y?:number;r?:number;s?:number}}|null=null;
  private nextBlink=3;private holdUntil=0;
  constructor(public canvas:HTMLCanvasElement){
    try{this.gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false})!;this.sh=program(this.gl,FRAG);this.sh.unit('a',0);}catch(e){console.warn(e);}
  }
  private load(id:string){
    let p=this.sets.get(id);
    if(!p){p=Promise.all(POSES.map(async n=>{const i=await loadImage(portrait(id,n));await i.decode().catch(()=>{});return [n,texture(this.gl!,i,true)] as const;})).then(x=>new Map(x));p.catch(()=>this.sets.delete(id));this.sets.set(id,p);}
    return p;
  }
  async select(id:string){const set=await this.load(id);this.id=id;this.cur=set;this.pose=this.seen='idle';this.swap=1;this.holdUntil=0;}
  show(pose:Pose,hold=0){if(pose!==this.pose){const lids=pose==='blink'||this.pose==='blink';this.pose=pose;if(lids||!this.live)this.seen=pose;else if(this.swap>=1||this.swap>.4)this.swap=0;}this.holdUntil=hold?this.time+hold:0;}
  gesture(kind:'cannon'|'win'|'big'|'soft'|'nod'|'enter'){
    const pulse=(u:number,a:number,b:number)=>u<a?u/a:u<b?1:(1-u)/(1-b);
    const F:{[k:string]:[number,(u:number)=>{x?:number;y?:number;r?:number;s?:number}]}={
      cannon:[.75,u=>({x:.022*Math.exp(-5*u)*Math.sin(u*9),y:.012*Math.exp(-4*u)*Math.sin(u*12),r:.022*Math.exp(-4*u)*Math.sin(u*10)})],
      win:[1.1,u=>({y:-.018*Math.sin(Math.min(1,u*1.4)*Math.PI),r:.016*Math.sin(u*Math.PI*2),s:-.012*Math.sin(Math.min(1,u*2.2)*Math.PI*2)})],
      big:[1.9,u=>({y:-.03*Math.abs(Math.sin(u*Math.PI*3))*(1-u*.6),r:.022*Math.sin(u*Math.PI*4)*(1-u),s:.018*Math.cos(u*Math.PI*6)*(1-u)})],
      soft:[1.2,u=>({y:.008*pulse(u,.25,.6),r:-.01*pulse(u,.25,.6)})],
      nod:[.5,u=>({y:.004*Math.sin(u*Math.PI),r:.004*Math.sin(u*Math.PI)})],
      enter:[1.1,u=>({y:.10*(1-Math.min(1,u*1.2))**3,s:.05*Math.exp(-5*u)*Math.sin(u*14)})],
    };
    this.gest={t:this.time,d:F[kind][0],f:F[kind][1]};
  }
  step(dt:number){
    this.time+=dt;this.swap=Math.min(1,this.swap+dt/.34);this.gust*=Math.exp(-3*dt);if(this.swap>=.28&&this.seen!==this.pose){this.seen=this.pose;this.gust=this.live?1.4:0;}
    if(this.holdUntil&&this.time>this.holdUntil){this.holdUntil=0;this.show('idle');}
    this.nextBlink-=dt;
    if(this.nextBlink<0&&this.live>0){if(this.pose==='idle'&&!this.holdUntil){this.show('blink',.12);}this.nextBlink=2.8+Math.random()*3.4;}
    this.g={x:0,y:0,r:0,s:0};
    if(this.swap<1){const u=this.swap,dip=u<.28?Math.sin(u/.28*Math.PI/2):Math.exp(-6*(u-.28))*Math.cos((u-.28)*12);this.g.s=-.022*dip*this.live;this.g.y=.004*dip*this.live;}
    if(this.gest){const u=(this.time-this.gest.t)/this.gest.d;if(u>=1)this.gest=null;else if(this.live>0){const e=this.gest.f(Math.max(0,u));this.g.x+=e.x??0;this.g.y+=e.y??0;this.g.r+=e.r??0;this.g.s+=e.s??0;}}
  }
  get state(){return{pose:this.pose,seen:this.seen};}
  resize(w:number,h:number,dpr:number){const a=Math.max(1,Math.round(w*dpr)),b=Math.max(1,Math.round(h*dpr));if(this.canvas.width!==a||this.canvas.height!==b){this.canvas.width=a;this.canvas.height=b;}}
  draw(){
    const gl=this.gl,s=this.sh;if(!gl||!s||!this.cur)return;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.cur.get(this.seen)!);
    s.set('t',this.time);s.set('live',this.live);s.set('wind',this.wind+this.gust);s.set('tint',...this.tint);s.set('flash',this.flash);s.set('light',1);s.set('body',0,0,1,1);
    gl.drawArrays(gl.TRIANGLES,0,3);
    this.canvas.style.transform=`translate(${(this.g.x*100).toFixed(2)}%,${(this.g.y*100).toFixed(2)}%) rotate(${this.g.r.toFixed(4)}rad) scale(${(1-this.g.s*.6).toFixed(4)},${(1+this.g.s).toFixed(4)})`;
  }
}
/** Some drawings end at the edge of their canvas: every side dissolves instead of being cut. */
export function soften(c:HTMLCanvasElement,vertical:string){const m=vertical+',linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent)';c.style.webkitMaskImage=m;c.style.maskImage=m;c.style.webkitMaskComposite='source-in';c.style.maskComposite='intersect';}
