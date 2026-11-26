/** The sketch on a small skeleton for rest and small gestures, drawn poses for actions.
 *  A pose changes within one frame, inside a quick dip of the body, so two faces are never blended. */
import {loadImage,texture} from './gl';
import POSES from './poses.json';
import {clamp,lerp} from './clock';
const VERT=`attribute vec2 a;varying vec2 u;uniform vec2 view;uniform vec3 place;uniform vec2 squash;uniform mediump float part;uniform float crouch,breath,braid,time;
uniform vec4 arm;uniform vec4 pose;uniform float swing;uniform vec4 box;uniform float kick;
vec2 rot(vec2 p,vec2 o,float k){float c=cos(k),s=sin(k);vec2 q=p-o;return o+vec2(c*q.x-s*q.y,s*q.x+c*q.y);}
void main(){vec2 p=a;u=a;float lower=0.;
 if(part>3.5){vec2 k=a/vec2(700.,1050.);u=k;vec2 q=box.xy+k*box.zw;float up=clamp(-q.y/1000.,0.,1.);q.y-=up*breath*3.;q.x+=q.x*breath*.006*up*up+pow(up,1.6)*(kick+sin(time*.8)*3.);vec2 s=place.xy+q*place.z*squash;gl_Position=vec4(s.x/view.x*2.-1.,1.-s.y/view.y*2.,0.,1.);return;}
 if(part<.5){
  float ul=(1.-smoothstep(252.,294.,p.x+(p.y-200.)*-.04))*smoothstep(188.,240.,p.y)*(1.-smoothstep(372.,392.,p.y));
  float ur=smoothstep(442.,474.,p.x)*smoothstep(200.,250.,p.y)*(1.-smoothstep(388.,400.,p.y));
  vec2 b=p;p=mix(p,rot(b,vec2(262.,205.),arm.x),ul);p=mix(p,rot(b,vec2(462.,215.),arm.z),ur*.7);
  float hd=(1.-smoothstep(150.,196.,a.y))*smoothstep(276.,300.,a.x)*(1.-smoothstep(432.,460.,a.x));
  p=mix(p,rot(p,vec2(355.,172.),pose.z)+vec2(pose.w,abs(pose.z)*18.),hd);
  float br=smoothstep(385.,420.,a.x)*smoothstep(120.,200.,a.y)*(1.-smoothstep(325.,345.,a.y));p.x+=br*braid*smoothstep(120.,330.,a.y)*smoothstep(400.,440.,a.x);
  float ch=smoothstep(170.,230.,a.y)*(1.-smoothstep(300.,400.,a.y));p.x+=(a.x-365.)*ch*breath*.012;p.y-=ch*breath*2.4;
  lower=smoothstep(395.,520.,a.y);
 }else{
  if(part>1.5&&part<2.5)p=rot(p,vec2(158.,502.),swing);
  if(part<2.5){p=rot(p,vec2(232.,338.),arm.y);p=rot(p,vec2(262.,205.),arm.x);}
  else{p=rot(p,vec2(474.,362.),arm.w);p=rot(p,vec2(462.,215.),arm.z*.7);}
  p.y-=breath*2.;
 }
 vec2 t=rot(p,vec2(368.,470.),pose.x)+vec2(pose.y,0.);p=mix(t,p,lower);
 float leg=smoothstep(430.,1000.,a.y)*step(part,.5);p.y+=crouch*86.*(1.-leg);
 float kn=smoothstep(440.,700.,a.y)*(1.-smoothstep(720.,1000.,a.y))*step(part,.5);p.x+=sign(a.x-372.)*crouch*30.*kn;
 vec2 s=place.xy+(p-vec2(365.,1030.))*place.z*squash;
 gl_Position=vec4(s.x/view.x*2.-1.,1.-s.y/view.y*2.,0.,1.);}`;
const FRAG=`precision highp float;varying vec2 u;uniform sampler2D tex;uniform mediump float part;uniform float blink,relic,lit;uniform vec3 tint;uniform vec4 box;uniform vec4 eyes;uniform vec2 eyer;
void main(){vec4 c=texture2D(tex,part>3.5?u:u/vec2(700.,1050.));
 if(part>3.5&&blink>.01&&eyer.x>0.){vec2 z=box.xy+u*box.zw;for(int i=0;i<2;i++){vec2 o=i==0?eyes.xy:eyes.zw;vec2 q=(z-o)/eyer;float e=1.-smoothstep(.82,1.05,length(q));float lid=step(q.y,-1.05+2.*blink);vec3 skin=mix(vec3(.62,.36,.25),vec3(.74,.47,.34),smoothstep(-1.,.6,q.y));float lash=smoothstep(.34,.0,abs(q.y-(-1.+2.*blink)));skin=mix(skin,vec3(.16,.07,.05),lash*.85);c.rgb=mix(c.rgb,skin*c.a,e*lid);}}
 if(part<.5&&blink>.01){for(int i=0;i<2;i++){vec2 o=i==0?vec2(333.5,84.5):vec2(373.5,84.);vec2 q=(u-o)/vec2(12.5,6.6);float e=1.-smoothstep(.82,1.05,length(q));float lid=step(q.y,-1.05+2.*blink);vec3 skin=mix(vec3(.62,.36,.25),vec3(.74,.47,.34),smoothstep(-1.,.6,q.y));float lash=smoothstep(.34,.0,abs(q.y-(-1.+2.*blink)));skin=mix(skin,vec3(.16,.07,.05),lash*.85);c.rgb=mix(c.rgb,skin*c.a,e*lid);}}
 if(part>1.5&&part<2.5){float l=max(c.r,max(c.g,c.b));vec3 j=vec3(l*.30,l*1.02,l*.92);float hot=smoothstep(.35,.8,c.r)*smoothstep(560.,585.,u.y)*(1.-smoothstep(648.,664.,u.y));c.rgb=mix(c.rgb,j,relic*hot);c.rgb*=1.+lit*hot*.6;}
 c.rgb*=mix(vec3(1.),tint,.8);gl_FragColor=c;}`;
type Rig={ul:number;el:number;ur:number;er:number;lean:number;shift:number;head:number;look:number;crouch:number};
const zero=():Rig=>({ul:0,el:0,ur:0,er:0,lean:0,shift:0,head:0,look:0,crouch:0});
const pulse=(t:number,a:number,d:number)=>{const p=(t-a)/d;return p<0||p>1?0:Math.sin(p*Math.PI)**2;};
const hold=(t:number,a:number,b:number,c:number,d:number)=>t<a||t>d?0:t<b?sm((t-a)/(b-a)):t<c?1:1-sm((t-c)/(d-c));
const sm=(x:number)=>{x=clamp(x);return x*x*(3-2*x);};
type PoseName=keyof typeof POSES;
type Meta={x:number;y:number;w:number;h:number;hand?:number[];lamp:number[];eyes?:number[]};
/** Which drawing each reaction shows and when, in seconds from its start. */
const SCORE:Partial<Record<Clip,[number,PoseName|null][]>>={lever:[[0,null],[.17,'pull'],[.64,null]],watch:[[0,'watch']],shield:[[0,'shield']],cheer:[[0,'cheer']],throw:[[0,'windup'],[.3,'throw'],[.74,'haul']],triumph:[[0,'triumph']],wring:[[0,'wring']],sit:[[0,'sit']],land:[[0,'land']],jump:[[0,'jump']],relic:[[0,'relic']],map:[[0,'map']]};
export type Clip='jump'|'map'|'wring'|'sit'|'land'|'idle'|'lever'|'watch'|'shield'|'cheer'|'throw'|'relic'|'triumph'|'sigh'|'goggles'|'lantern'|'wave';
/** Every curve belongs to an event that has already been confirmed. */
function target(clip:Clip,t:number,clock:number):Rig{
  const r=zero(),s=clock;r.ul=.02*Math.sin(s*.8);r.el=.04*Math.sin(s*.9+.6);r.ur=.02*Math.sin(s*.7+1);r.er=.05*Math.sin(s*.75+2);r.lean=.012*Math.sin(s*.55);r.shift=3*Math.sin(s*.42);r.head=.018*Math.sin(s*.5+1);r.look=1.6*Math.sin(s*.33);
  if(clip==='lever'){const a=hold(t,0,.2,.42,.85),b=hold(t,.22,.4,.55,.95);r.ur-=.3*a;r.er-=.95*a-.62*b;r.lean+=.05*a-.07*b;r.look+=6*a;r.head+=.05*a;r.crouch=.22*b;}
  else if(clip==='watch'){r.look+=6;r.head+=.04+.03*Math.sin(t*5);r.lean+=.018;r.er-=.12;}
  else if(clip==='shield'){const a=hold(t,0,.14,.4,.8);r.ur-=.22*a;r.er-=2.62*a;r.lean-=.06*a;r.head-=.06*a;r.look-=4*a;r.el+=.12*a;r.crouch=.16*a;}
  else if(clip==='cheer'){const a=hold(t,0,.16,.5,.95);r.er-=2.05*a;r.ur-=.3*a;r.head+=.07*a;r.look+=3*a;r.crouch=.12*pulse(t,0,.3)+.08*pulse(t,.45,.3);r.el+=.18*a;}
  else if(clip==='throw'){const w=hold(t,0,.2,.28,.42),f=hold(t,.28,.42,.72,.95),p=hold(t,.72,.92,1.05,1.4);r.ur-=.34*w+.3*f+.1*p;r.er-=2.35*w+1.05*f+.35*p;r.lean+=-.06*w+.08*f-.08*p;r.look+=6*(w+f)+3*p;r.head+=.05*f;r.crouch=.12*w+.1*f+.2*p;}
  else if(clip==='relic'){const a=sm(t/.45);r.ul+=.28*a;r.el+=1.9*a;r.lean+=.03*a;r.head-=.07*a;r.look-=5*a;r.ur-=.1*a;r.er-=.35*a;}
  else if(clip==='triumph'){const a=sm(t/.25),b=Math.abs(Math.sin(t*5.2))*Math.exp(-t*.35);r.ul+=.3*a;r.el+=1.75*a+.12*Math.sin(t*10);r.ur-=.3*a;r.er-=2.2*a+.14*Math.sin(t*10+1);r.head+=.06*Math.sin(t*5);r.crouch=.2*b;r.lean+=.03*Math.sin(t*5);}
  else if(clip==='sigh'){const a=hold(t,0,.35,1,1.6);r.head+=.07*a;r.look-=3*a;r.lean-=.02*a;r.crouch=.05*a;r.el-=.05*a;r.er+=.07*a;}
  else if(clip==='goggles'){const a=hold(t,0,.4,1.5,2);r.ur-=.22*a;r.er-=(2.72+.05*Math.sin(t*11))*a;r.head+=.035*a;r.lean+=.012*a;}
  else if(clip==='lantern'){const a=hold(t,0,.6,2.2,2.9);r.ul+=.12*a;r.el+=.62*a;r.head-=.07*a;r.look-=7*a;r.lean-=.03*a;}
  else if(clip==='wave'){const a=hold(t,0,.3,1.4,1.8);r.er-=(2.0+.28*Math.sin(t*9))*a;r.ur-=.3*a;r.head+=.05*a;}
  return r;
}
const SPEED:Record<keyof Rig,number>={ul:17,el:15,ur:17,er:17,lean:13,shift:6,head:13,look:13,crouch:20};
export class Hero{
  x=0;y=0;scale=.4;squash=1;relic=0;lit=0;calm=1;tint:[number,number,number]=[1,1,1];
  clip:Clip='idle';private t=0;private clock=0;private v=zero();private d=zero();private swing=0;private swingV=0;private braid=0;private braidV=0;private idleAt=6;private idleN=0;private lastX=0;
  private poses:Partial<Record<PoseName,WebGLTexture>>={};private pop=0;private popV=0;private kick=0;private kickV=0;current:PoseName|null=null;private gl?:WebGLRenderingContext;private loc:Record<string,WebGLUniformLocation|null>={};private tex:WebGLTexture[]=[];private count=0;
  constructor(public canvas:HTMLCanvasElement){}
  async load(){
    const names=Object.keys(POSES) as PoseName[],[imgs,drawn]=await Promise.all([Promise.all(['body','left','lantern','right'].map(n=>loadImage('assets/hero-'+n+'.webp'))),Promise.all(names.map(n=>loadImage('assets/poses/'+n+'.webp')))]);
    const gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true});if(!gl)return;this.gl=gl;
    const mk=(type:number,s:string)=>{const h=gl.createShader(type)!;gl.shaderSource(h,s);gl.compileShader(h);if(!gl.getShaderParameter(h,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(h)||'hero');return h;};
    const p=gl.createProgram()!;gl.attachShader(p,mk(gl.VERTEX_SHADER,VERT));gl.attachShader(p,mk(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'hero link');gl.useProgram(p);
    for(const n of ['view','place','squash','part','crouch','breath','braid','time','arm','pose','swing','blink','relic','lit','tint','box','kick','eyes','eyer'])this.loc[n]=gl.getUniformLocation(p,n);
    const nx=56,ny=84,a:number[]=[];for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const x0=i/nx*700,x1=(i+1)/nx*700,y0=j/ny*1050,y1=(j+1)/ny*1050;a.push(x0,y0,x1,y0,x0,y1,x1,y0,x1,y1,x0,y1);}
    this.count=a.length/2;gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);const at=gl.getAttribLocation(p,'a');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
    this.tex=imgs.map(i=>{const t=texture(gl,i,true);return t;});names.forEach((n,i)=>{this.poses[n]=texture(gl,drawn[i],true);});gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  }
  play(c:Clip){this.clip=c;this.t=0;this.idleAt=7+Math.random()*4;}
  step(dt:number){
    this.clock+=dt*this.calm;this.t+=dt;
    const len:Partial<Record<Clip,number>>={lever:.9,shield:.75,cheer:1.05,throw:1.3,wring:1.9,land:.3,map:3.2,sigh:1.7,goggles:2.1,lantern:3,wave:1.9};
    const l=len[this.clip];if(l&&this.t>l)this.play('idle');
    if(this.clip==='idle'&&this.calm){this.idleAt-=dt;if(this.idleAt<0)this.play((['goggles','map','wave','sit','lantern'] as Clip[])[this.idleN++%5]);}
    if(this.clip==='sit'&&this.t>11)this.play('idle');
    let want:PoseName|null=null;for(const[at,p]of SCORE[this.clip]??[])if(this.t>=at)want=p;
    if(want!==this.current){this.current=want;if(this.calm){this.pop=-.035;this.popV=0;this.kickV=want==='haul'||want==='shield'?260:want==='throw'||want==='pull'?-260:90;}}
    {const n=Math.max(1,Math.ceil(dt/.008));for(let i=0;i<n;i++){const h=dt/n;this.popV+=(-620*this.pop-24*this.popV)*h;this.pop+=this.popV*h;this.kickV+=(-190*this.kick-13*this.kickV)*h;this.kick+=this.kickV*h;}if(!this.calm)this.pop=this.kick=0;}
    const g=target(this.clip,this.t,this.clock);
    for(const k in this.v){const key=k as keyof Rig,w=SPEED[key],n=this.calm?Math.min(8,Math.max(1,Math.ceil(dt/.008))):1;if(!this.calm){this.v[key]=key==='crouch'?0:g[key];this.d[key]=0;continue;}for(let i=0;i<n;i++){const h=dt/n,f=w*w*(g[key]-this.v[key])-2*w*.82*this.d[key];this.d[key]+=f*h;this.v[key]+=this.d[key]*h;}}
    const ang=this.v.ul+this.v.el+this.v.lean,vx=dt?(this.x-this.lastX)/Math.max(dt,.001):0;this.lastX=this.x;
    const f=-70*(this.swing+ang)-5.5*this.swingV-(this.d.el+this.d.ul)*3-vx*.012;this.swingV+=f*dt;this.swing=clamp(this.swing+this.swingV*dt,-2.6,2.6);
    const b=-90*this.braid-7*this.braidV-this.d.lean*260-this.d.head*200-this.d.crouch*40-vx*.35;this.braidV+=b*dt;this.braid=clamp(this.braid+this.braidV*dt,-26,26);
    if(!this.calm){this.swing=-ang;this.braid=0;}
  }
  private point(p:[number,number],part:1|2|3){
    const r=(q:number[],o:number[],k:number)=>{const c=Math.cos(k),s=Math.sin(k),x=q[0]-o[0],y=q[1]-o[1];return[o[0]+c*x-s*y,o[1]+s*x+c*y];};let q:number[]=p;
    if(part===2)q=r(q,[158,502],this.swing);
    if(part<3){q=r(q,[232,338],this.v.el);q=r(q,[262,205],this.v.ul);}else{q=r(q,[474,362],this.v.er);q=r(q,[462,215],this.v.ur*.7);}
    q=r(q,[368,470],this.v.lean);q[0]+=this.v.shift;q[1]+=this.v.crouch*86;
    return{x:this.x+(q[0]-365)*this.scale/Math.sqrt(this.squash),y:this.y+(q[1]-1030)*this.scale*this.squash};
  }
  private drawnPoint(q?:number[]){return q&&{x:this.x+q[0]*this.scale/Math.sqrt(this.squash),y:this.y+q[1]*this.scale*this.squash};}
  private get meta(){return this.current?POSES[this.current] as Meta:undefined;}
  hand(){return this.drawnPoint(this.meta?.hand)??this.point([548,562],3);}
  lamp(){return this.drawnPoint(this.meta?.lamp)??this.point([158,612],2);}
  draw(w:number,h:number,dpr:number){
    const gl=this.gl,L=this.loc;if(!gl)return;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    const v=this.v,c=this.clock%9,blink=Math.max(pulse(c,2.1,.16),pulse(c,5.4,.15),pulse(c,5.75,.15),pulse(c,8,.17))*this.calm;
    gl.uniform2f(L.view,w,h);gl.uniform3f(L.place,this.x,this.y,this.scale);{const q=this.squash*(1+this.pop);gl.uniform2f(L.squash,1/Math.sqrt(q),q);}gl.uniform1f(L.time,this.clock);gl.uniform1f(L.kick,this.kick);gl.uniform1f(L.crouch,v.crouch);gl.uniform1f(L.breath,Math.sin(this.clock*1.7)*this.calm);gl.uniform1f(L.braid,this.braid);
    gl.uniform4f(L.arm,v.ul,v.el,v.ur,v.er);gl.uniform4f(L.pose,v.lean,v.shift,v.head,v.look);gl.uniform1f(L.swing,this.swing);gl.uniform1f(L.blink,blink);gl.uniform1f(L.relic,this.relic);gl.uniform1f(L.lit,this.lit+.12*Math.sin(this.clock*11)*this.calm);gl.uniform3f(L.tint,...this.tint);
    const m=this.meta,tex=this.current?this.poses[this.current]:undefined;if(m&&tex){gl.uniform1f(L.part,4);gl.uniform4f(L.box,m.x,m.y,m.w,m.h);const e=m.eyes;gl.uniform4f(L.eyes,e?.[0]??0,e?.[1]??0,e?.[2]??0,e?.[3]??0);gl.uniform2f(L.eyer,e?.[4]??0,e?.[5]??0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.drawArrays(gl.TRIANGLES,0,this.count);return;}
    for(const i of [0,2,1,3]){gl.uniform1f(L.part,i);gl.bindTexture(gl.TEXTURE_2D,this.tex[i]);gl.drawArrays(gl.TRIANGLES,0,this.count);}
  }
  state(){return{clip:this.clip,pose:this.current,x:this.x,y:this.y};}
}
export {lerp};
