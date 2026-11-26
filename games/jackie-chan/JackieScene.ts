import { JACKIE_COSTUMES, JACKIE_LOCATIONS, JACKIE_RISKS, type JackieCostume, type JackieLocation, type JackieView } from '../../src/shared/jackieChan';
import type { PenaltyRisk } from '../../src/shared/crLeo';
import { language } from '../../src/i18n/index';
import { JackieAudio } from './JackieAudio';
import { Fight, RATE, type Actor, type Prop, type Status } from './JackieFight';
import { drawFx, LIFE, type View } from './JackieEffects';
import { artUrl, foeSheet, heroSheet, prepareHero, propSheet, type Frame, type Sheet } from './JackieArt';
import { clamp, lerp, smooth, type State } from './JackieTrack';
import { OPPONENTS, opponentLineup } from './JackieOpponents';
import { JackiePlayback, type FightSpeed } from './JackiePlayback';

export const JACKIE_SCENE_ASSETS = [...JACKIE_COSTUMES.flatMap(c => [artUrl(c.id), artUrl(c.id+'-furniture'), artUrl(c.id+'-combat')]), ...Object.values(OPPONENTS).map(foe=>foe.asset), artUrl('props'), ...JACKIE_LOCATIONS.map(c => artUrl(c.id))];
const cache = new Map<string, Promise<HTMLImageElement>>();
function load(url:string) {
  let request=cache.get(url);
  if(!request){request=new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{cache.delete(url);reject(Error('Artwork unavailable'));};image.src=url;});cache.set(url,request);}
  return request;
}
/** Lantern and sun positions inside the 16:9 paintings, for soft moving light. */
const LIGHTS:Record<JackieLocation,readonly {x:number;y:number;r:number;c:string}[]>={
  restaurant:[{x:.047,y:.05,r:.1,c:'#ff7a30'},{x:.285,y:.045,r:.1,c:'#ff7a30'},{x:.38,y:.115,r:.07,c:'#ff8a3a'},{x:.733,y:.105,r:.07,c:'#ff8a3a'},{x:.806,y:.03,r:.1,c:'#ff7a30'}],
  harbor:[{x:.375,y:.31,r:.22,c:'#ffd070'}],
  market:[{x:.07,y:.3,r:.11,c:'#ff9a48'},{x:.234,y:.05,r:.08,c:'#ff8a3a'},{x:.348,y:.35,r:.07,c:'#ff9a48'},{x:.86,y:.29,r:.08,c:'#ff9a48'},{x:.925,y:.32,r:.09,c:'#ff9a48'},{x:.39,y:.16,r:.06,c:'#ff8a3a'}],
};
const CASHOUT_SECONDS=1.1,LEAVE=.55;
type Box={left:number;right:number;top:number;bottom:number};
type Leaving={sheet:Sheet;state:State};
export class JackieScene {
  readonly images=new Map<string,HTMLImageElement>();
  loading={ready:false,failed:false,loaded:0,total:JACKIE_SCENE_ASSETS.length};
  costume:JackieCostume='master';location:JackieLocation='restaurant';risk:PenaltyRisk='safe';
  /** Space the result card needs above the hero, in CSS pixels. */
  headroom=0;
  private view?:JackieView;
  private seriesId='preview';
  private only?:string;
  private fight?:Fight;
  /** The costume on screen. A newly chosen one replaces it when its drawings are ready. */
  private worn:JackieCostume='master';
  private worldKey='';
  private playback=new JackiePlayback();
  private heroX?:number;
  private enter=false;
  private leaving:Leaving[]=[];
  private lastCamera={x:0,zoom:1};
  private fromCamera?:{x:number;zoom:number};
  private cashout=false;
  private dead=false;
  private key='';
  private painted=-Infinity;
  private resize:ResizeObserver;
  private unsubscribeAudio:()=>void;
  private motion=matchMedia('(prefers-reduced-motion: reduce)');
  private onMotion=()=>{if(this.motion.matches)this.settle();this.key='';};
  constructor(private canvas:HTMLCanvasElement,private audio:JackieAudio){this.unsubscribeAudio=audio.onResume(()=>this.resumeAudio());this.resize=new ResizeObserver(()=>this.key='');this.resize.observe(canvas);this.motion.addEventListener('change',this.onMotion);void this.retry();}
  async retry(){
    if(this.dead)return;this.loading.failed=false;
    await Promise.all(JACKIE_SCENE_ASSETS.map(async url=>{
      if(this.images.has(url))return;
      try{const image=await load(url);if(this.dead)return;this.images.set(url,image);this.loading.loaded=this.images.size;}
      catch{if(!this.dead)this.loading.failed=true;}
    }));
    if(this.dead||this.images.size!==JACKIE_SCENE_ASSETS.length)return;
    // Cutting the drawings apart is spread over frames before the first display.
    for(const id of Object.keys(OPPONENTS) as (keyof typeof OPPONENTS)[]){foeSheet(this.images,id);await new Promise(requestAnimationFrame);if(this.dead)return;}
    propSheet(this.images);this.worn=this.costume;heroSheet(this.images,this.worn);
    this.loading.ready=true;this.key='';
  }
  select(costume:JackieCostume,location:JackieLocation,risk:PenaltyRisk){
    this.costume=costume;this.location=location;this.risk=risk;this.view=undefined;this.seriesId='preview';this.only=undefined;
    this.playback.settle();this.heroX=undefined;this.enter=false;this.leaving=[];this.fromCamera=undefined;this.cashout=false;this.refresh();
    void this.wear(costume);
  }
  private async wear(costume:JackieCostume){
    if(!this.loading.ready){this.worn=costume;return;}
    await prepareHero(this.images,costume,()=>new Promise(requestAnimationFrame)).catch(()=>{});
    if(!this.dead&&this.costume===costume&&this.worn!==costume){this.worn=costume;this.refresh();}
  }
  private refresh(){this.worldKey='';this.fight=undefined;this.key='';}
  show(view:JackieView,animate:boolean,cashout=false,seriesId='preview',only?:string){
    const moving=animate&&!this.motion.matches;
    if(cashout&&this.fight&&this.view&&this.seriesId===seriesId){this.view=view;this.cashout=true;this.key='';}
    else{
      // People of the previous take leave the frame while the next group runs in.
      const previous=moving&&this.fight&&this.view?this.fight:undefined;
      this.leaving=previous?previous.foes.map(a=>({sheet:a.sheet,state:a.at(this.script())})):[];
      this.heroX=previous?previous.hero.x(this.script()):undefined;
      this.fromCamera=previous?{...this.lastCamera}:undefined;this.enter=!!previous;
      this.view=view;this.cashout=cashout;this.seriesId=seriesId;this.only=only;
    }
    this.costume=this.worn=view.costume;this.location=view.location;this.risk=view.combat.risk;
    if(!cashout||!this.fight)this.refresh();
    this.build();
    const won=view.combat.shots.at(-1)!.goal,complete=view.combat.status==='complete';
    if(moving&&(this.fight||cashout)){this.playback.start(cashout?performance.now():this.audio.begin(this.fight!,won,complete,this.playback.speed));if(cashout)this.audio.cashout();}
    else{this.playback.settle();this.audio.cancel();if(animate)this.audio.result(won,cashout||complete);}
    this.key='';
  }
  setSpeed(speed:FightSpeed){
    this.playback.setSpeed(speed,performance.now());this.audio.cancel();this.resumeAudio();this.key='';
  }
  private resumeAudio(){
    const state=this.state();
    if(!this.dead&&this.view&&this.fight&&state.busy&&!this.cashout&&!this.motion.matches&&!document.hidden){
      const anchor=this.audio.begin(this.fight,this.view.combat.shots.at(-1)!.goal,this.view.combat.status==='complete',this.playback.speed,state.elapsed);
      this.playback.start(anchor,state.elapsed);
    }
    this.key='';
  }
  settle(){this.playback.settle();this.audio.cancel();this.leaving=[];this.fromCamera=undefined;this.key='';}
  /** Script time of the displayed frame. Settled scenes show the end of their fight. */
  private script(now=performance.now()){
    const fight=this.fight;if(!fight||!this.view)return -1;
    const elapsed=this.playback.elapsed(now);
    return this.cashout||!Number.isFinite(elapsed)?fight.end+5:elapsed*RATE;
  }
  state(now=performance.now()){
    if(this.motion.matches&&Number.isFinite(this.playback.elapsed(now)))this.settle();
    this.build();
    const elapsed=this.playback.elapsed(now),fight=this.fight,status=this.view?.combat.status??'idle',t=elapsed*RATE;
    const base={elapsed,speed:this.playback.speed,reduced:this.motion.matches,sequence:fight?.sequence??'',reveal:true,busy:false,celebrating:false,phase:'ready'};
    if(status==='idle'||!fight)return base;
    if(this.cashout)return {...base,phase:'paid',busy:elapsed<CASHOUT_SECONDS};
    if(!Number.isFinite(elapsed))return {...base,phase:status==='complete'?'victory-hold':status==='banked'?'paid':status==='lost'?'lost':'group-won'};
    if(t<fight.reveal){let label='guard';for(const beat of fight.beats)if(beat.t<=t)label=beat.label;return {...base,reveal:false,busy:true,phase:label};}
    const busy=t<fight.end,since=t-fight.reveal;
    if(status==='complete')return {...base,busy,celebrating:busy,phase:since<.32?'victory-step':since<1.2?'victory-fist':since<2.05?'victory-bow':'victory-hold'};
    return {...base,busy,phase:status==='lost'?'lost':'group-won'};
  }
  private metrics(){
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight,ground=h*.925;
    const heroH=Math.max(40,Math.min(h*.6,w*.46,this.headroom?ground-this.headroom-8:Infinity));
    return {w,h,ground,heroH,W:Math.round(w/heroH/2*20)/20};
  }
  private build(){
    if(!this.loading.ready)return;const m=this.metrics();if(!m.w||!m.h)return;
    const combat=this.view?.combat,fightIndex=Math.max(0,(combat?.shots.length??1)-1);
    const status:Status=combat?.status==='lost'?'lost':combat?.status==='complete'?'complete':'playing';
    const key=[m.W,this.worn,this.location,this.risk,this.seriesId,fightIndex,status,this.heroX,this.enter,this.only].join(':');
    if(key===this.worldKey&&this.fight)return;
    const lineup=opponentLineup(this.location,fightIndex,JACKIE_RISKS[this.risk].opponents).map(foe=>foe.id);
    this.fight=new Fight({seed:this.seriesId,location:this.location,lineup,fightIndex,status,hero:heroSheet(this.images,this.worn),foes:Object.fromEntries(lineup.map(id=>[id,foeSheet(this.images,id)])),W:m.W,heroX:this.heroX,enter:this.enter,only:this.only});
    this.worldKey=key;this.key='';
  }
  private camera(t:number){
    const f=this.fight!;if(this.motion.matches)return {x:0,zoom:1};
    let x=0,zoom=1;for(const k of f.cams){if(k.t>t)break;const e=smooth((t-k.t)/k.d);x=lerp(x,k.x,e);zoom=lerp(zoom,k.zoom,e);}
    // A trailing average follows the bodies without a jerk, stored state or a look at the outcome.
    let hx=0,fx=0;const samples=14;
    for(let i=0;i<samples;i++){const q=t-.62+.62*i/(samples-1);hx+=f.hero.x(q)/samples;let sum=0,weight=0;for(const a of f.foes){const s=a.at(q),w=Math.abs(s.x)>f.L+.3?.02:s.pose==='b6'?.3:1;sum+=s.x*w;weight+=w;}fx+=(weight?sum/weight:0)/samples;}
    const W=this.metrics().W;zoom=Math.max(.86,Math.min(zoom,W/(Math.abs(hx-fx)/2+.5)));
    const keep=Math.max(.05,W/zoom-.46);x=clamp(hx*.52+fx*.48,hx-keep,hx+keep);
    // While the player decides, the frame holds the whole group.
    if(t>f.reveal){const e=smooth((t-f.reveal)/.9),xs=[f.hero,...f.foes].map(a=>a.x(t));x=lerp(x,(Math.min(...xs)+Math.max(...xs))/2,e);zoom=lerp(zoom,Math.min(1,zoom),e);}
    if(this.fromCamera&&t<.5){const e=smooth(t/.5);x=lerp(this.fromCamera.x,x,e);zoom=lerp(this.fromCamera.zoom,zoom,e);}
    return {x,zoom};
  }
  paint(now:number){
    if(!this.loading.ready||this.dead)return;
    const state=this.state(now);if(!this.fight)return;const f=this.fight;
    const {w,h,ground,heroH,W}=this.metrics(),dpr=Math.min(2,devicePixelRatio||1);
    const still=[w,h,dpr,this.headroom,this.worldKey,this.view?.combat.revision,this.cashout,state.phase].join(':');
    // A resting set breathes at a lower rate; reduced motion repaints only after a change.
    if(!state.busy){if(this.motion.matches?this.key===still:this.key===still&&now-this.painted<33)return;}
    this.key=still;this.painted=now;
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    const c=this.canvas.getContext('2d')!;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.imageSmoothingQuality='medium';
    const t=this.script(now),cam=this.camera(t);this.lastCamera=cam;
    const H=heroH*cam.zoom,room=Math.max(0,f.L+.32-W/cam.zoom),cx=clamp(cam.x,-room,room);
    // A short, fading tremor belongs to the decisive contact only.
    let shake=0;if(!this.motion.matches)for(const e of f.fx)if(e.kind==='lines'&&t>=e.t&&t<e.t+.3)shake=Math.sin((t-e.t)*70)*(1-(t-e.t)/.3)*heroH*.008;
    const v:View={w,h,H,ground,X:(x,z=0)=>w/2+(x-cx)*H*(1-.07*z)+shake,Y:(y,z=0)=>ground-z*h*.085-y*H*(1-.07*z)+shake*.5};
    this.backdrop(c,v,cx,cam.zoom,now);
    const list:{z:number;draw:()=>void}[]=[];let heroFrame:Box|undefined;const foeFrames:(Box&{id:string;pose:string})[]=[];
    const props=propSheet(this.images);
    for(const p of f.props){const s=p.track.at(t);if(s.alpha>0)list.push({z:s.z,draw:()=>this.prop(c,v,props,s,t,p)});}
    for(const a of f.foes){const s=a.at(t);list.push({z:s.z,draw:()=>{foeFrames.push({id:a.kind,pose:s.pose,...this.actor(c,v,a,s,t,now/1000)});}});}
    const hero=f.hero.at(t),shown:State=this.cashout||this.view?.combat.status==='banked'?{...hero,pose:'f7',prev:'f7',ghost:false,bend:state.busy?.035*Math.sin(Math.min(1,state.elapsed/CASHOUT_SECONDS)*Math.PI):0}:hero;
    list.push({z:shown.z-.005,draw:()=>{heroFrame=this.actor(c,v,f.hero,shown,t,now/1000);}});
    if(t>=0&&t<LEAVE)for(const {sheet,state:s} of this.leaving){const side=s.x>=0?1:-1,u=smooth((t-.06)/(LEAVE-.06)),x=lerp(s.x,side*(f.L+1.3),u);list.push({z:s.z+.01,draw:()=>this.body(c,v,sheet[t<.06?s.pose:'b4'],{...s,x,pose:t<.06?s.pose:'b4',face:side,y:Math.abs(Math.sin(u*9))*.03,rot:0,bend:t<.06?0:.08,ghost:false},1,0)});}
    list.sort((a,b)=>b.z-a.z);
    for(const e of f.fx)if(e.kind==='arc')e.x2??=e.x+e.dir*this.reach(e);
    const effects=!this.motion.matches&&t>=0;
    if(effects)for(const e of f.fx)if(t>=e.t&&t<=e.t+LIFE[e.kind])drawFx(c,e,t,v,'back');
    list.forEach(item=>item.draw());
    if(effects)for(const e of f.fx)if(t>=e.t&&t<=e.t+LIFE[e.kind])drawFx(c,e,t,v,'front');
    if(state.celebrating)this.confetti(c,v,t-f.reveal,f.end-f.reveal);
    const vignette=c.createRadialGradient(w/2,h*.55,Math.min(w,h)*.45,w/2,h*.55,Math.hypot(w,h)*.6);vignette.addColorStop(0,'#0e090500');vignette.addColorStop(1,'#0e09058c');c.fillStyle=vignette;c.fillRect(0,0,w,h);
    const names=f.o.lineup.map(id=>language==='en'?OPPONENTS[id].en:OPPONENTS[id].ru);
    Object.assign(this.canvas.dataset,{opponents:String(f.foes.length),foes:f.o.lineup.join(','),foeFrames:JSON.stringify(foeFrames),heroFrame:JSON.stringify(heroFrame),heroPose:shown.pose,playbackSpeed:String(state.speed),sequence:state.sequence,phase:state.phase,reveal:String(state.reveal),celebrating:String(state.celebrating),props:f.props.map(p=>p.kind+(p.track.at(t).pose==='p3'?'-broken':'')).join(','),sceneCostume:this.worn,sceneLocation:this.location});
    this.canvas.setAttribute('aria-label',(language==='en'?'Illustrated kung fu fight scene. Opponents: ':'Рисованная сцена кунг-фу. Противники: ')+names.join(', '));
  }
  private reach(e:{t:number;x:number}){
    // The trail ends at the drawn fist or foot of whoever strikes at this moment.
    let best=.5,nearest=9;for(const a of [this.fight!.hero,...this.fight!.foes]){const s=a.at(e.t+.069),distance=Math.abs(s.x-e.x);if(distance<nearest){nearest=distance;best=a.sheet[s.pose].tip.dx;}}return best;
  }
  private backdrop(c:CanvasRenderingContext2D,v:View,cx:number,zoom:number,now:number){
    const image=this.images.get(artUrl(this.location))!,{w,h}=v,still=this.motion.matches,time=still?0:now;
    const scale=Math.max(w/image.naturalWidth,h/image.naturalHeight)*1.12*Math.max(1,1+(zoom-1)*.55),bw=image.naturalWidth*scale,bh=image.naturalHeight*scale;
    const x=clamp((w-bw)/2-cx*v.H*.3,w-bw,0),y=clamp(h*.43-bh*.5,h-bh,0);
    c.drawImage(image,x,y,bw,bh);
    c.save();c.globalCompositeOperation='lighter';
    LIGHTS[this.location].forEach((l,i)=>{const pulse=still?.5:.5+.28*Math.sin(time/700+i*1.9)+.14*Math.sin(time/230+i*4),r=l.r*bh,px=x+l.x*bw,py=y+l.y*bh,g=c.createRadialGradient(px,py,0,px,py,r);g.addColorStop(0,l.c+'66');g.addColorStop(1,l.c+'00');c.globalAlpha=.35+.4*pulse;c.fillStyle=g;c.fillRect(px-r,py-r,r*2,r*2);});
    c.restore();
    if(!still){
      c.save();const market=this.location==='market';c.fillStyle=market?'#ffbf70':this.location==='harbor'?'#ffe6ad':'#ffe2a6';
      for(let i=0;i<26;i++){const p=(i*.618)%1,q=(i*.381)%1,k=(time/1000*(.012+.01*q)+q)%1,px=((p+Math.sin(time/3000+i)*.03+1)%1)*w,py=h*(market?1-k:.12+.7*((q+k)%1));c.globalAlpha=.1+.28*Math.abs(Math.sin(time/1600+i*2.1));c.beginPath();c.arc(px,py,.8+1.5*((i*.27)%1),0,7);c.fill();}
      c.restore();
    }
    const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#18100a66');shade.addColorStop(.3,'#18100a00');shade.addColorStop(.75,'#140e0800');shade.addColorStop(1,'#140e0866');c.fillStyle=shade;c.fillRect(0,0,w,h);
    const heat=Math.min(4,this.fight!.o.fightIndex)*.045;
    if(heat){const g=c.createRadialGradient(w/2,h*.75,0,w/2,h*.75,w*.6);g.addColorStop(0,`rgba(255,150,60,${heat})`);g.addColorStop(1,'rgba(255,150,60,0)');c.save();c.globalCompositeOperation='lighter';c.fillStyle=g;c.fillRect(0,0,w,h);c.restore();}
  }
  private confetti(c:CanvasRenderingContext2D,v:View,t:number,duration:number){
    if(this.motion.matches)return;const fade=clamp(Math.min(t/.3,(duration-t)/.5));if(fade<=0)return;
    c.save();c.globalAlpha=fade*.9;
    for(let i=0;i<34;i++){const x=v.w*(((i*.173)%1)+Math.sin(t*1.6+i)*.02),y=v.h*(((i*.137)%1+t*.2)%1);c.save();c.translate(x,y);c.rotate(t*2+i);c.scale(1,Math.cos(t*5+i));c.fillStyle=i%3?'#e8bb6b':'#aa3e2e';c.fillRect(-2.5,-4,5,8);c.restore();}
    c.restore();
  }
  private actor(c:CanvasRenderingContext2D,v:View,a:Actor,s:State,t:number,seconds:number):Box{
    const bob=s.idle&&!this.motion.matches?Math.sin(seconds*3.1+a.track.id.charCodeAt(3)*2)*.008:0;
    // The shadow stays on the floor and shrinks as the body rises.
    const lift=1/(1+s.y*1.6);c.save();c.fillStyle='#1c110b';c.globalAlpha=.36*lift*s.alpha;c.beginPath();c.ellipse(v.X(s.x,s.z),v.Y(0,s.z),v.H*.24*(.6+.4*lift),v.H*.036*lift,0,0,7);c.fill();c.restore();
    if(s.ghost&&!this.motion.matches)for(const [back,alpha] of [[.075,.1],[.05,.16],[.025,.24]] as const){const g=a.track.at(t-back);if(Math.hypot(g.x-s.x,g.y-s.y)<.02&&!s.spin)continue;this.body(c,v,a.sheet[g.pose],g,alpha*s.alpha,0);}
    // In a fight the previous drawing fades for a moment, so poses do not snap.
    if(s.prev!==s.pose&&s.since<.045&&t<this.fight!.reveal-.2&&a.sheet[s.prev])this.body(c,v,a.sheet[s.prev],{...s,pose:s.prev},.28*(1-s.since/.045)*s.alpha,0);
    return this.body(c,v,a.sheet[s.pose],s,s.alpha,bob);
  }
  private prop(c:CanvasRenderingContext2D,v:View,sheet:Sheet,s:State,t:number,p:Prop){
    const frame=sheet[s.pose];
    if(s.y<.02&&s.pose!=='p3'){c.save();c.fillStyle='#1c110b';c.globalAlpha=.3;c.beginPath();c.ellipse(v.X(s.x,s.z),v.Y(0,s.z),frame.w*frame.k*v.H*.46,v.H*.026,0,0,7);c.fill();c.restore();}
    if(s.ghost&&!this.motion.matches)for(const [back,alpha] of [[.06,.14],[.03,.24]] as const){const g=p.track.at(t-back);this.body(c,v,sheet[g.pose],g,alpha,0);}
    this.body(c,v,frame,s,s.alpha,0);
  }
  private body(c:CanvasRenderingContext2D,v:View,frame:Frame,s:State,alpha:number,bob:number):Box{
    const k=frame.k*v.H*(1-.07*s.z),flip=s.face===frame.native?1:-1,px=v.X(s.x,s.z),py=v.Y(s.y,s.z),pivot=s.rot?s.pv*v.H:0,angle=s.rot*s.face;
    const w=frame.w*k,h=frame.h*k,left=-frame.ax*k,bend=s.bend*frame.native*h;
    c.save();c.globalAlpha*=alpha;c.translate(px,py-pivot);if(angle)c.rotate(angle);c.translate(0,pivot);c.scale(flip*s.sx,s.sy*(1+bob));
    if(Math.abs(bend)<.6)c.drawImage(frame.img,left,-h,w,h);
    else{const n=Math.max(10,Math.min(26,Math.round(h/9))),slice=frame.h/n;for(let i=0;i<n;i++){const u=1-(i+.5)/n;c.drawImage(frame.img,0,i*slice,frame.w,Math.min(slice+.8,frame.h-i*slice),left+bend*u*u,-h+i*h/n,w,h/n+.8);}}
    c.restore();
    const cos=Math.cos(angle),sin=Math.sin(angle),xs:number[]=[],ys:number[]=[];
    for(const x of [left*flip,(left+w)*flip])for(const y of [-h,0]){const dy=y+pivot;xs.push(px+x*cos-dy*sin);ys.push(py-pivot+x*sin+dy*cos);}
    return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
  }
  destroy(){this.dead=true;this.unsubscribeAudio();this.resize.disconnect();this.motion.removeEventListener('change',this.onMotion);this.images.clear();this.audio.cancel();}
}
