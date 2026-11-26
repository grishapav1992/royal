/** Draws a compiled fight with the existing artwork. */
import {Fight,RATE,type Actor,type Prop,type Status,type Options} from './fight';
import {drawFx,LIFE,type View} from './effects';
import {heroSheet,foeSheet,propSheet,picture,FOES,type Costume,type FoeId,type Frame,type Location,type Sheet} from './art';
import {lerp,smooth,clamp,type State} from './track';
type Setup={costume:Costume;location:Location;lineup:FoeId[];seed:string;fightIndex:number;status:Status;only?:string};
/** Lantern and sun positions inside the 16:9 paintings, for soft moving light. */
const LIGHTS:Record<Location,{x:number;y:number;r:number;c:string}[]>={
  restaurant:[{x:.047,y:.05,r:.1,c:'#ff7a30'},{x:.285,y:.045,r:.1,c:'#ff7a30'},{x:.38,y:.115,r:.07,c:'#ff8a3a'},{x:.733,y:.105,r:.07,c:'#ff8a3a'},{x:.806,y:.03,r:.1,c:'#ff7a30'}],
  harbor:[{x:.375,y:.31,r:.22,c:'#ffd070'}],
  market:[{x:.07,y:.3,r:.11,c:'#ff9a48'},{x:.234,y:.05,r:.08,c:'#ff8a3a'},{x:.348,y:.35,r:.07,c:'#ff9a48'},{x:.86,y:.29,r:.08,c:'#ff9a48'},{x:.925,y:.32,r:.09,c:'#ff9a48'},{x:.39,y:.16,r:.06,c:'#ff8a3a'}],
};
export class Scene{
  fight?:Fight;setup?:Setup;ready=false;reduced=false;
  private hero?:Sheet;private foes:Record<string,Sheet>={};private props!:Sheet;private bg!:HTMLImageElement;
  private started=-Infinity;private held=Infinity;speed=1;private offset=0;idle=true;
  private request=0;private worldKey='';private heroH=200;
  constructor(public canvas:HTMLCanvasElement){}
  async load(s:Setup){
    const id=++this.request;this.ready=false;
    const [h,p,b,...f]=await Promise.all([heroSheet(s.costume),propSheet(),picture(s.location),...s.lineup.map(foeSheet)]);
    if(id!==this.request)return false;
    this.hero=h;this.props=p;this.bg=b;s.lineup.forEach((n,i)=>this.foes[n]=f[i]);this.setup=s;this.worldKey='';this.build();this.ready=true;return true;
  }
  private metrics(){
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight;
    const heroH=Math.min(h*.6,w*.46);
    return {w,h,heroH,W:Math.round(w/heroH/2*20)/20};
  }
  private build(){
    if(!this.hero||!this.setup)return;const m=this.metrics();if(!m.w||!m.h)return;
    const key=[m.W,JSON.stringify(this.setup)].join();if(key===this.worldKey)return;this.worldKey=key;this.heroH=m.heroH;
    this.fight=new Fight({...this.setup,hero:this.hero,foes:this.foes,W:m.W});
  }
  async play(s:Setup){if(!await this.load(s))return;this.idle=false;this.offset=0;this.started=performance.now();this.held=Infinity;}
  async show(s:Setup){if(!await this.load(s))return;this.idle=true;}
  setSpeed(n:number){const e=this.elapsed();this.speed=n;this.offset=e;this.started=performance.now();}
  seek(t:number){this.held=t;this.idle=false;}
  elapsed(now=performance.now()){return this.held<Infinity?this.held:this.idle?-1:this.offset+(now-this.started)/1000*this.speed*RATE;}
  settle(){if(this.fight){this.held=Infinity;this.offset=this.fight.end+5;this.started=performance.now();}}
  get busy(){return !!this.fight&&!this.idle&&this.elapsed()<this.fight.end;}
  get revealed(){return this.idle||!this.fight||this.elapsed()>=this.fight.reveal;}
  private camera(t:number){
    const f=this.fight!;let x=0,zoom=1;
    for(const k of f.cams){if(k.t>t)break;const e=smooth((t-k.t)/k.d);x=lerp(x,k.x,e);zoom=lerp(zoom,k.zoom,e);}
    if(this.reduced)return{x:0,zoom:1};
    // A centred moving average follows the bodies without a jerk and without stored state.
    let hx=0,fx=0;const N=14;
    for(let i=0;i<N;i++){const q=t-.62+.7*i/(N-1);hx+=f.hero.x(q)/N;let sum=0,n=0;for(const a of f.foes){const s=a.at(q),w=s.pose==='b6'?.3:1;sum+=s.x*w;n+=w;}fx+=(n?sum/n:0)/N;}
    const W=this.metrics().W;zoom=Math.max(.86,Math.min(zoom,W/(Math.abs(hx-fx)/2+.5)));
    const half=W/zoom,keep=Math.max(.05,half-.46);
    x=clamp(hx*.52+fx*.48,hx-keep,hx+keep);
    return {x,zoom};
  }
  paint(now=performance.now()){
    if(!this.ready)return;this.build();const f=this.fight;if(!f)return;
    const c=this.canvas.getContext('2d')!,{w,h,heroH,W}=this.metrics(),dpr=Math.min(2,devicePixelRatio||1);if(!w||!h)return;
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.imageSmoothingQuality='medium';
    let t=this.elapsed(now);if(this.reduced&&!this.idle)t=f.end+5;
    const cam=this.camera(t),H=heroH*cam.zoom,ground=h*.925;
    const room=Math.max(0,f.L+.32-W/cam.zoom),cx=clamp(cam.x,-room,room);
    // A short, fading tremor belongs to the decisive contact only.
    let shake=0;for(const e of f.fx)if(e.kind==='lines'&&t>=e.t&&t<e.t+.3)shake=Math.sin((t-e.t)*70)*(1-(t-e.t)/.3)*heroH*.008;
    const v:View={w,h,H,ground,X:(x,z=0)=>w/2+(x-cx)*H*(1-.07*z)+shake,Y:(y,z=0)=>ground-z*h*.085-y*H*(1-.07*z)+shake*.5};
    this.backdrop(c,v,cx,cam.zoom,t,now);
    const ms=now/1000;
    const list:Array<{z:number;draw:()=>void}>=[];
    for(const p of f.props){const s=p.track.at(t);if(s.alpha>0)list.push({z:s.z,draw:()=>this.sprite(c,v,this.props[s.pose],s,t,p,undefined)});}
    const actor=(a:Actor)=>{const s=a.at(t);list.push({z:s.z-(a.hero?.005:0),draw:()=>this.actor(c,v,a,s,t,ms)});};
    f.foes.forEach(actor);actor(f.hero);
    list.sort((a,b)=>b.z-a.z);
    for(const e of f.fx)if(e.kind==='arc'){e.x2??=e.x+e.dir*this.reach(e);}
    for(const e of f.fx)if(t>=e.t&&t<=e.t+LIFE[e.kind])drawFx(c,e,t,v,'back');
    list.forEach(x=>x.draw());
    if(!this.reduced)for(const e of f.fx)if(t>=e.t&&t<=e.t+LIFE[e.kind])drawFx(c,e,t,v,'front');
    if(this.setup!.status==='complete'&&t>f.reveal)this.confetti(c,v,t-f.reveal,f.end-f.reveal);
    this.foreground(c,v,ms);
  }
  private reach(e:{t:number;x:number}){
    // The trail ends at the drawn fist or foot of whoever strikes at this moment.
    let best=.5,d=9;for(const a of [this.fight!.hero,...this.fight!.foes]){const s=a.at(e.t+.069),q=Math.abs(s.x-e.x);if(q<d){d=q;best=a.sheet[s.pose].tip.dx;}}return best;
  }
  private backdrop(c:CanvasRenderingContext2D,v:View,cx:number,zoom:number,t:number,now:number){
    const b=this.bg,{w,h}=v,extra=1.12*Math.max(1,1+(zoom-1)*.55),s=Math.max(w/b.naturalWidth,h/b.naturalHeight)*extra,bw=b.naturalWidth*s,bh=b.naturalHeight*s;
    const x=clamp((w-bw)/2-cx*v.H*.3,w-bw,0),y=clamp(h*.43-bh*.5,h-bh,0);
    c.drawImage(b,x,y,bw,bh);
    c.save();c.globalCompositeOperation='lighter';
    LIGHTS[this.setup!.location].forEach((l,i)=>{const f=this.reduced?.5:.5+.28*Math.sin(now/700+i*1.9)+.14*Math.sin(now/230+i*4),r=l.r*bh,px=x+l.x*bw,py=y+l.y*bh,g=c.createRadialGradient(px,py,0,px,py,r);g.addColorStop(0,l.c+'66');g.addColorStop(1,l.c+'00');c.globalAlpha=.35+.4*f;c.fillStyle=g;c.fillRect(px-r,py-r,r*2,r*2);});
    c.restore();
    // Motes in the light keep the set alive between takes.
    if(!this.reduced){c.save();const market=this.setup!.location==='market',harbor=this.setup!.location==='harbor';c.fillStyle=market?'#ffbf70':harbor?'#ffe6ad':'#ffe2a6';
      for(let i=0;i<26;i++){const p=(i*.618)%1,q=(i*.381)%1,k=(now/1000*(.012+.01*q)+q)%1,px=((p+Math.sin(now/3000+i)*.03+1)%1)*w,py=h*(market?1-k:.12+.7*((q+k)%1)),r=.8+1.5*((i*.27)%1);c.globalAlpha=.1+.28*Math.abs(Math.sin(now/1600+i*2.1));c.beginPath();c.arc(px,py,r,0,7);c.fill();}c.restore();}
    const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#18100a66');shade.addColorStop(.3,'#18100a00');shade.addColorStop(.75,'#140e0800');shade.addColorStop(1,'#140e0866');c.fillStyle=shade;c.fillRect(0,0,w,h);
    const heat=Math.min(4,this.setup!.fightIndex)*.045;if(heat){const g=c.createRadialGradient(w/2,h*.75,0,w/2,h*.75,w*.6);g.addColorStop(0,`rgba(255,150,60,${heat})`);g.addColorStop(1,'rgba(255,150,60,0)');c.save();c.globalCompositeOperation='lighter';c.fillStyle=g;c.fillRect(0,0,w,h);c.restore();}
  }
  private foreground(c:CanvasRenderingContext2D,v:View,_:number){
    const {w,h}=v,g=c.createRadialGradient(w/2,h*.55,Math.min(w,h)*.45,w/2,h*.55,Math.hypot(w,h)*.6);g.addColorStop(0,'#0e090500');g.addColorStop(1,'#0e09058c');c.fillStyle=g;c.fillRect(0,0,w,h);
  }
  private confetti(c:CanvasRenderingContext2D,v:View,t:number,d:number){
    if(this.reduced)return;const fade=clamp(Math.min(t/.3,(d-t)/.5));if(fade<=0)return;c.save();c.globalAlpha=fade*.9;
    for(let i=0;i<34;i++){const x=v.w*(((i*.173)%1)+Math.sin(t*1.6+i)*.02),y=v.h*(((i*.137)%1+t*.2)%1);c.save();c.translate(x,y);c.rotate(t*2+i);c.scale(1,Math.cos(t*5+i));c.fillStyle=i%3?'#e8bb6b':'#aa3e2e';c.fillRect(-2.5,-4,5,8);c.restore();}c.restore();
  }
  private actor(c:CanvasRenderingContext2D,v:View,a:Actor,s:State,t:number,ms:number){
    const bob=s.idle&&!this.reduced?Math.sin(ms*3.1+a.track.id.charCodeAt(3)*2)*.008:0;
    // Shadow stays on the floor and shrinks as the body rises.
    const lift=1/(1+s.y*1.6);c.save();c.fillStyle='#1c110b';c.globalAlpha=.36*lift*s.alpha;c.beginPath();c.ellipse(v.X(s.x,s.z),v.Y(0,s.z),v.H*.24*(.6+.4*lift),v.H*.036*lift,0,0,7);c.fill();c.restore();
    if(s.ghost&&!this.reduced)for(const [dt,al] of [[.075,.1],[.05,.16],[.025,.24]] as const){const g=a.track.at(t-dt);if(Math.hypot(g.x-s.x,g.y-s.y)<.02&&!s.spin)continue;this.body(c,v,a.sheet[g.pose],g,al*s.alpha,0);}
    // The previous drawing fades under the new one, so poses do not snap.
    if(s.prev!==s.pose&&s.since<.045&&t<this.fight!.reveal-.2&&a.sheet[s.prev])this.body(c,v,a.sheet[s.prev],{...s,pose:s.prev},.28*(1-s.since/.045)*s.alpha,0);
    this.body(c,v,a.sheet[s.pose],s,s.alpha,bob);
  }
  private sprite(c:CanvasRenderingContext2D,v:View,fr:Frame,s:State,t:number,p:Prop,_:unknown){
    if(s.y<.02&&s.pose!=='p3'){c.save();c.fillStyle='#1c110b';c.globalAlpha=.3;c.beginPath();c.ellipse(v.X(s.x,s.z),v.Y(0,s.z),fr.w*fr.k*v.H*.46,v.H*.026,0,0,7);c.fill();c.restore();}
    if(s.ghost)for(const [dt,al] of [[.06,.14],[.03,.24]] as const)this.body(c,v,this.props[p.track.at(t-dt).pose],p.track.at(t-dt),al,0);
    this.body(c,v,fr,s,s.alpha,0);
  }
  private body(c:CanvasRenderingContext2D,v:View,fr:Frame,s:State,alpha:number,bob:number){
    const k=fr.k*v.H*(1-.07*s.z),flip=s.face===fr.native?1:-1;
    c.save();c.globalAlpha*=alpha;c.translate(v.X(s.x,s.z),v.Y(s.y,s.z));
    if(s.rot){const pv=s.pv*v.H;c.translate(0,-pv);c.rotate(s.rot*s.face);c.translate(0,pv);}
    c.scale(flip*s.sx,s.sy*(1+bob));
    const x=-fr.ax*k,w=fr.w*k,h=fr.h*k,bend=s.bend*fr.native*h;
    if(Math.abs(bend)<.6)c.drawImage(fr.img,x,-h,w,h);
    else{const n=Math.max(10,Math.min(26,Math.round(h/9))),sh=fr.h/n;for(let i=0;i<n;i++){const u=1-(i+.5)/n;c.drawImage(fr.img,0,i*sh,fr.w,Math.min(sh+.8,fr.h-i*sh),x+bend*u*u,-h+i*h/n,w,h/n+.8);}}
    c.restore();
  }
}
export {FOES};
