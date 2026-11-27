import {Clock,clamp,ease,lerp} from './clock';
import {Effects,coin,propLight} from './effects';
import {Harbor} from './harbor';
import {Pirate} from './pirate';
import {alive,plain,prepare,rolling,images,type Spawn} from './symbols';
import {loadImage} from './gl';
import {MEDIA} from './media';
import {money} from './text';
import type {CaribbeanCue} from '../CaribbeanAudio';
import {CARIBBEAN_LINES,type CaribbeanBlock,type CaribbeanFrame} from '../../../src/shared/caribbeanTreasuresMath';
export type Rect={x:number;y:number;w:number;h:number};
export type Layout={W:number;H:number;mode:'wide'|'portrait'|'short';board:Rect;b:number;pirate:Rect;muzzle:{x:number;y:number};gun?:{x:number;y:number;s:number}};
type Col={mode:'rest'|'roll'|'land';p:number;v:number;seed:number;land:number};
type Slash={cells:number[];pts:{x:number;y:number}[];u:number;cents:number;end:number;quiet:boolean;thin:boolean};
type Hook={x:number;y:number;fx:number;fy:number;u:number;tight:number};
const G=(v:number)=>Math.round(v);
/** Points of the gun drawing: crop, ground line, muzzle and vent. */
const GUN={x:64,y:30,w:552,h:440,ground:452},MUZZLE=[582,86],VENT=[152,262],GUN_A=.44;
const gunPoint=(n:{x:number;y:number;s:number},p:number[])=>({x:n.x+(p[0]-GUN.x)*n.s/GUN.w,y:n.y-(GUN.ground-p[1])*n.s/GUN.w});
export const gunMuzzle=(n:{x:number;y:number;s:number})=>gunPoint(n,MUZZLE);
export class Stage{
  clock=new Clock();fx=new Effects();L!:Layout;dpr=1;ready=false;
  grid:number[]=Array.from({length:24},(_,i)=>(i+Math.floor(i/6)*2)%6);block:CaribbeanBlock|null=null;
  private cols:Col[]=Array.from({length:6},(_,i)=>({mode:'rest',p:0,v:0,seed:i*7+3,land:0}));
  private rise=1;private water=0;private ropes=0;private grow:{from:CaribbeanBlock;u:number}|null=null;private knock=0;private recoil={x:0,y:0};private quiet=false;private gunImg?:HTMLImageElement;private gunTint=new Map<string,HTMLCanvasElement>();
  private glow=new Map<number,number>();private dim=0;private act=new Map<number,{t:number;last:number;loop:boolean}>();private blockAct:{t:number;last:number}|null=null;
  private slashes:Slash[]=[];tour:{line:number;t:number;count:number}|null=null;private ball:{x:number;y:number;s:number;px:number;py:number}|null=null;
  private gun={kick:0,fuse:0};private chest:{u:number;lid:number;rays:number;x:number;y:number;s:number}|null=null;hooks:Hook[]=[];rock=0;private frameImg?:HTMLImageElement;private frameCache?:HTMLCanvasElement;private wood?:HTMLImageElement;
  /** Plays an owned sound and tells when it becomes audible. `lead` is the time a sound needs to get there. */
  onCue:(cue:CaribbeanCue,variant?:number)=>number=()=>performance.now();
  lead:(cue:CaribbeanCue,variant?:number)=>number=()=>0;
  accents:{cue:string;deviationMs:number}[]=[];
  private sound(cue:CaribbeanCue,variant=0){if(!this.clock.hurry)this.onCue(cue,variant);}
  /** A movement whose end is the audible accent: the sound is started early enough to land with it. */
  private async cued(cue:CaribbeanCue,d:number,f:(u:number)=>void,e:(u:number)=>number=ease.lin,variant=0){
    const lead=this.lead(cue,variant),span=Math.max(d,lead),at=span-lead;let fired=false,expected=0;
    await this.clock.tween(span,u=>{if(!fired&&!this.clock.hurry&&u*span>=at-.008){fired=true;expected=this.onCue(cue,variant);}f(e(u));});
    if(fired&&!this.clock.hurry&&lead>0){this.accents.push({cue,deviationMs:performance.now()-expected});if(this.accents.length>80)this.accents.shift();}
  }
  private g:CanvasRenderingContext2D;private f:CanvasRenderingContext2D;private boltT=6;private boltPath:{x:number;y:number}[]=[];
  private rg:CanvasRenderingContext2D;private wet=false;
  constructor(public board:HTMLCanvasElement,public top:HTMLCanvasElement,public rainLayer:HTMLCanvasElement,public harbor:Harbor,public pirate:Pirate){this.rg=rainLayer.getContext('2d')!;this.g=board.getContext('2d')!;this.f=top.getContext('2d')!;}
  async load(){[this.frameImg,this.wood,this.gunImg]=await Promise.all([loadImage(MEDIA+'frame.webp'),loadImage(MEDIA+'harbor.webp'),loadImage(MEDIA+'gun.webp')]);this.ready=true;if(this.L)this.layout(this.L,this.dpr);}
  layout(L:Layout,dpr:number){
    this.L=L;this.dpr=dpr;this.rainLayer.width=G(L.W);this.rainLayer.height=G(L.H);for(const c of [this.board,this.top]){c.width=G(L.W*dpr);c.height=G(L.H*dpr);}
    prepare(L.board.w/6*.88*dpr);this.frameCache=undefined;
    for(const s of this.slashes)s.pts=this.trace(s.cells);
    for(const h of this.hooks){const t=this.hookTarget(this.hooks.indexOf(h));h.x=t.x;h.y=t.y;h.fx=t.fx;h.fy=t.fy;}
  }
  private get cell(){return this.L.board.w/6;}
  center(i:number){const c=this.cell;return{x:this.L.board.x+(i%6+.5)*c,y:this.L.board.y+(Math.floor(i/6)+.5)*c};}
  private blockRect(b:CaribbeanBlock){const c=this.cell;return{x:this.L.board.x+b.x*c,y:this.L.board.y+b.y*c,w:b.size*c,h:b.size*c};}
  private covered(i:number){const b=this.grow?this.grow.from:this.block;return !!b&&i%6>=b.x&&i%6<b.x+b.size&&Math.floor(i/6)>=b.y&&Math.floor(i/6)<b.y+b.size;}
  resetWins(){this.tour=null;this.glow.clear();this.act.clear();this.blockAct=null;this.slashes=[];this.dim=0;this.chest=null;}

  /* Spin ------------------------------------------------------------------ */
  startRoll(){
    this.resetWins();
    this.cols.forEach((c,i)=>{c.mode='roll';c.p=0;c.v=0;c.seed=(Math.random()*1e6)|0;
      void this.clock.wait(i*.035).then(()=>this.clock.tween(.34,u=>{if(c.mode==='roll')c.v=u<.35?-2.6*Math.sin(u/.35*Math.PI):(u-.35)/.65*22;},ease.lin));});
    this.sound('roll');
  }
  async stop(frame:CaribbeanFrame){
    this.resetWins();this.grid=[...frame.gridBefore];this.block=frame.blockBefore?{...frame.blockBefore}:null;this.rise=this.block?0:1;this.water=this.block?1:0;
    const C=this.L.board;
    await Promise.all(this.cols.map(async(c,i)=>{
      await this.clock.wait(.12+i*.125);
      c.mode='land';c.p=-4;
      await this.cued('stop',.17,u=>{c.p=-4*(1-u);},ease.lin,i);
      if(!this.clock.hurry){this.fx.splinters(C.x+(i+.5)*this.cell,C.y+C.h,this.cell*.8);this.knock=1;}
      c.land=this.clock.now;
      await this.clock.tween(.36,u=>{c.p=.17*Math.exp(-5*u)*Math.sin(u*15);},ease.lin);
      c.p=0;c.mode='rest';
    }));
    for(const c of this.cols){c.mode='rest';c.p=0;}
  }
  /** A failed operation leaves the previous field. */
  async abort(){await Promise.all(this.cols.map(async(c,i)=>{await this.clock.wait(i*.05);c.mode='land';c.seed=i;await this.clock.tween(.3,u=>{c.p=-.9*(1-u)**2;});c.p=0;c.mode='rest';}));for(const c of this.cols){c.mode='rest';c.p=0;}}

  /* Giant from the sea ---------------------------------------------------- */
  async giant(){
    const b=this.block;if(!b)return;const r=this.blockRect(b);
    this.water=1;this.rise=0;
    await this.clock.wait(.05);
    void this.clock.tween(.22,u=>{this.ropes=u;},ease.out);
    let wet=0;
    await this.cued('giant',.5,u=>{this.rise=u;if(u>.22&&wet===0||u>.5&&wet===1||u>.75&&wet===2){wet++;if(!this.clock.hurry)this.fx.splash(r.x+r.w/2,r.y+r.h*.4,r.w*.8,b.size*.42);}},ease.back);
    this.knock=1.2;
    // the water runs off while the round already goes on
    void this.clock.tween(.42,u=>{this.water=1-u;this.ropes=1-u;},ease.io).then(()=>{this.water=0;this.ropes=0;});
    await this.clock.wait(.1);
  }

  /* Broadside -------------------------------------------------------------- */
  async cannon(after:CaribbeanBlock,grid:number[]){
    const from={...this.block!},r=this.blockRect(from),to={x:r.x+r.w/2,y:r.y+r.h/2},m=this.L.muzzle;
    this.pirate.show('surprise',1.1);
    const zoom=this.L.mode==='wide'?1:.8;
    const fire=(px:number,py:number,k:number,dx:number,dy:number)=>{this.fx.add({k:'flash',x:px,y:py,d:.2,s:78*k});this.fx.smoke(px+dx*16,py+dy*16,12,46*k,dx*150,dy*150-14);for(let i=0;i<16;i++){const v=180+Math.random()*320;this.fx.add({k:'spark',x:px,y:py,vx:dx*v+(Math.random()-.5)*130,vy:dy*v+(Math.random()-.5)*130,g:320,d:.3+Math.random()*.3,s:1.7,drag:1});}};
    if(this.L.gun){
      // the deck gun in front of the player: fuse, shot, recoil
      const n=this.L.gun,v=gunPoint(n,VENT);
      await this.cued('cannon',.22,u=>{this.gun.fuse=u;if(!this.clock.hurry)this.fx.add({k:'spark',x:v.x,y:v.y,vx:(Math.random()-.5)*130,vy:-60-Math.random()*120,g:360,d:.25,s:1.4});});
      this.gun.fuse=0;if(!this.clock.hurry){fire(m.x,m.y,n.s/150,Math.cos(GUN_A),-Math.sin(GUN_A));}
      void this.clock.tween(.8,u=>{this.gun.kick=u<.1?u*10:Math.exp(-4*(u-.1))*Math.cos((u-.1)*7);}).then(()=>{this.gun.kick=0;});
    }else for(let i=0;i<3;i++){if(i===0)await this.cued('cannon',.12,()=>{});if(!this.clock.hurry){this.harbor.shot=1;fire(m.x-(2-i)*22*zoom,m.y-(2-i)*3,.62,1,-.1);}await this.clock.wait(i<2?.08:.01);}
    if(this.harbor.shot)void this.clock.tween(.7,u=>{this.harbor.shot=1-u;},ease.out);
    this.pirate.flash=1;void this.clock.tween(.5,u=>{this.pirate.flash=1-u;},ease.out);
    const peak=Math.min(m.y,to.y)-Math.max(46,this.L.H*.13),cx=lerp(m.x,to.x,.45),cy=peak-20;
    await this.cued('blast',.42,u=>{const a=(1-u)**2,b=2*u*(1-u),c=u*u,x=a*m.x+b*cx+c*to.x,y=a*m.y+b*cy+c*to.y,s=lerp(5,15,u)*zoom;
      if(!this.clock.hurry&&u<1&&this.ball)this.fx.add({k:'smoke',x,y,vx:0,vy:-6,d:.5,s:s*.9,a:.5,drag:1});
      this.ball={x,y,s,px:this.ball?.x??x,py:this.ball?.y??y};},u=>u*u*.35+u*.65);
    this.ball=null;
    if(!this.clock.hurry){this.fx.blast(to.x,to.y,r.w*.62);}
    this.pirate.react('cannon');
    void this.clock.tween(.5,u=>{const k=Math.exp(-5*u);this.recoil={x:5*k*Math.sin(u*26),y:3*k*Math.sin(u*31+1)};});
    this.block={...after};this.grow={from,u:0};
    await this.clock.tween(.46,u=>{if(this.grow)this.grow.u=u;},t=>{const k=clamp(t);return 1+2.4*(k-1)**3+1.4*(k-1)**2;});
    this.grow=null;this.grid=[...grid];this.recoil={x:0,y:0};
    if(!this.clock.hurry){const q=this.blockRect(after);for(let i=0;i<10;i++)this.fx.add({k:'ember',x:q.x+Math.random()*q.w,y:q.y+q.h*(.6+.4*Math.random()),vx:(Math.random()-.5)*30,vy:-30-Math.random()*50,d:1+Math.random(),s:1.5});}
    await this.clock.wait(.04);
  }

  /* Wins -------------------------------------------------------------------- */
  /** A profit gets the sabre, a returned part of the stake only a calm thread. Both show the paid lines and their sums. */
  async wins(frame:CaribbeanFrame,amounts:number[],quiet:boolean){
    const order=frame.wins.map((w,i)=>({w,a:amounts[i],i})).sort((p,q)=>q.w.factor-p.w.factor),show=order.slice(0,3),rest=order.slice(3);
    this.quiet=quiet;void this.clock.tween(.2,u=>{this.dim=u;});
    const make=(w:CaribbeanFrame['wins'][number],a:number,thin:boolean):Slash=>({cells:w.positions,pts:this.trace(w.positions),u:0,cents:a,end:w.positions[w.positions.length-1],quiet,thin});
    const run=async(w:CaribbeanFrame['wins'][number],s:Slash,d:number)=>{let hit=-1;this.slashes.push(s);
      await this.clock.tween(d,u=>{s.u=u;const n=Math.floor(u*(s.pts.length-1))-1;while(hit<Math.min(n,w.positions.length-1)){hit++;this.light(w.positions[hit]);}},ease.io);for(const p of w.positions)this.light(p);};
    const all:Promise<void>[]=[];
    for(const {w,a} of show){if(!quiet)this.sound('slash');const r=run(w,make(w,a,quiet),quiet?.26:.3);all.push(r);await this.clock.wait(quiet?.1:.2);}
    for(const {w,a} of rest){all.push(run(w,make(w,a,true),.24));await this.clock.wait(Math.min(.05,.25/rest.length));}
    await Promise.all(all);if(!quiet)this.sound('line');
    await this.clock.wait(.12);
  }
  private trace(cells:number[]){const pts=cells.map(p=>this.center(p)),a=pts[0],z=pts[pts.length-1],d=this.cell*.62;return[{x:a.x-d,y:a.y-d*.25},...pts,{x:z.x+d,y:z.y+d*.1}];}
  private light(p:number){
    if(this.glow.has(p))return;this.glow.set(p,this.clock.now);
    if(this.quiet)return;
    if(this.covered(p)){if(!this.blockAct)this.blockAct={t:this.clock.now,last:0};}else this.act.set(p,{t:this.clock.now,last:0,loop:true});
    if(!this.clock.hurry){const c=this.center(p);for(let i=0;i<3;i++)this.fx.add({k:'spark',x:c.x+(Math.random()-.5)*this.cell*.5,y:c.y+(Math.random()-.5)*this.cell*.5,vx:(Math.random()-.5)*200,vy:-60-Math.random()*140,g:380,d:.4+Math.random()*.3,s:1.6,drag:1});}
  }
  coinsTo(to:{x:number;y:number},n:number){const l=[...this.glow.keys()];if(!l.length||this.clock.hurry)return;for(let i=0;i<n;i++){const c=this.center(l[i%l.length]);this.fx.loot({x:c.x+(Math.random()-.5)*20,y:c.y+(Math.random()-.5)*20},to,6+this.cell*.05,i*.045);}}

  /* Treasure ------------------------------------------------------------------ */
  async treasure(onCount:(u:number)=>void){
    const {board:B}=this.L,s=Math.min(B.w*.3,B.h*.5),x=B.x+B.w/2,y=B.y+B.h-s*.1;
    this.chest={u:0,lid:0,rays:0,x,y,s};const c=this.chest;this.slashes=[];this.sound('chest');
    await this.clock.tween(.38,u=>{c.u=u;},ease.back);
    await this.clock.wait(.04);this.sound('open');
    await this.clock.tween(.32,u=>{c.lid=u;c.rays=u;},ease.back);
    
    let emitted=0;
    await this.clock.tween(2,u=>{onCount(Math.min(1,u*1.12));const want=Math.floor(Math.min(1,u*1.5)*64);
      while(emitted<want&&!this.clock.hurry){emitted++;const a=-Math.PI/2+(Math.random()-.5)*1.25,v=s*(2.6+Math.random()*2.7);this.fx.coin(x+(Math.random()-.5)*s*.5,y-s*.42,Math.cos(a)*v*.8,Math.sin(a)*v,6+s*.045+Math.random()*3,y+s*.02+Math.random()*10);if(emitted%6===0)this.fx.glint(x+(Math.random()-.5)*s*1.2,y-s*(.4+Math.random()*.8),s*.16);}},ease.lin);
    onCount(1);await this.clock.wait(.6);
    await this.clock.tween(.28,u=>{c.u=1-u;c.rays=1-u;},ease.io);this.chest=null;
  }

  /* Boarding hooks ---------------------------------------------------------------- */
  private hookTarget(i:number){const {board:B,b,mode}=this.L;
    if(mode==='portrait'){const x=B.x+B.w*[.2,.5,.8][i];return{x,y:B.y-b*.55,fx:-20+i*30,fy:B.y-this.L.H*.22-i*8};}
    return{x:B.x-b*.5,y:B.y+B.h*[.2,.48,.78][i],fx:-30,fy:B.y+B.h*[.02,.4,.62][i]-30};}
  async boarding(){
    this.hooks=[];
    for(let i=0;i<3;i++){const t=this.hookTarget(i),h={...t,u:0,tight:0};this.hooks.push(h);
      await this.cued('hook',.36,u=>{h.u=u;},ease.out);
      if(!this.clock.hurry)this.fx.splinters(h.x,h.y,26,.7);this.knock=.8;
      void this.clock.tween(.8,u=>{h.tight=1-Math.exp(-5*u)*Math.cos(u*16);},ease.lin);
      await this.clock.wait(.04);}
    await this.clock.wait(.3);
  }
  /** Hooks of a series that is restored after reopening. */
  private moored(){this.hooks=[0,1,2].map(i=>({...this.hookTarget(i),u:1,tight:1}));}
  async release(){if(!this.hooks.length)return;await this.clock.tween(.4,u=>{for(const h of this.hooks)h.u=1-u;},ease.in);this.hooks=[];}

  /* Sea ---------------------------------------------------------------- */
  sea:'day'|'raid'|'storm'='day';
  private grade(u:number){const c=this.sea==='raid'?[1.04,.84,.78]:[.70,.78,.88];this.pirate.tint=[1+(c[0]-1)*u,1+(c[1]-1)*u,1+(c[2]-1)*u];}
  setSea(sea:'day'|'raid'|'storm'){
    this.sea=sea;const raid=sea==='raid',storm=sea==='storm';this.harbor.sunset=raid?1:0;this.harbor.storm=storm?1:0;this.harbor.bolt=this.harbor.lean=0;this.boltPath=[];this.fx.rain=storm?1:0;
    this.pirate.wind=storm?1.6:raid?.5:0;if(sea==='day')this.pirate.tint=[1,1,1];else this.grade(1);if(raid)this.moored();else this.hooks=[];
  }
  async enterSea(sea:'raid'|'storm'){
    this.setSea('day');this.sea=sea;this.resetWins();this.block=null;
    const raid=sea==='raid';
    // the camera leans towards the ships, the field stays still
    void this.clock.tween(2,u=>{this.harbor.lean=.035*Math.sin(u*Math.PI);},ease.lin,true);
    if(!raid)void this.clock.wait(.4).then(()=>{if(this.sea==='storm')this.bolt();});
    await this.clock.tween(1,u=>{if(raid)this.harbor.sunset=u;else{this.harbor.storm=u;this.fx.rain=u;}this.grade(u);this.pirate.wind=(raid?.5:1.6)*u;},ease.io);
    if(raid)await this.boarding();else await this.clock.wait(.3);
  }
  async leaveSea(){
    const raid=this.sea==='raid';if(this.sea==='day')return;await this.release();
    void this.clock.tween(1.6,u=>{if(raid)this.harbor.sunset=1-u;else{this.harbor.storm=1-u;this.fx.rain=1-u;}this.grade(1-u);this.pirate.wind=(raid?.5:1.6)*(1-u);},ease.io,true).then(()=>{if(this.leaving)this.sea='day';this.leaving=false;});this.leaving=true;
  }
  private leaving=false;
  /** The confirmed state without any movement: recovery, reduced motion, a hidden window. */
  show(frame:CaribbeanFrame|undefined,amounts:number[]=[],quiet=true){
    this.clock.cancel();this.fx.clear();this.resetWins();this.leaving=false;this.ball=null;this.grow=null;this.water=this.ropes=0;this.rise=1;this.recoil={x:0,y:0};this.gun={kick:0,fuse:0};this.knock=0;this.harbor.shot=0;this.pirate.flash=0;
    for(const c of this.cols){c.mode='rest';c.p=0;}
    if(!frame)return;
    this.grid=[...frame.grid];this.block=frame.block?{...frame.block}:null;this.quiet=quiet;
    if(!frame.wins.length)return;
    this.dim=1;frame.wins.forEach((w,i)=>{for(const p of w.positions){this.glow.set(p,this.clock.now);if(!quiet&&!this.covered(p))this.act.set(p,{t:this.clock.now,last:0,loop:true});}this.slashes.push({cells:w.positions,pts:this.trace(w.positions),u:1,cents:amounts[i]??0,end:w.positions[w.positions.length-1],quiet,thin:true});});
  }
  get state(){return{sea:this.sea,hooks:this.hooks.length,tweens:this.clock.busy,particles:this.fx.list.length,block:this.block?{...this.block}:null,lit:this.glow.size,tour:this.tour?.line??null};}
  destroy(){this.clock.cancel();this.fx.clear();}

  /* Frame ----------------------------------------------------------------------------- */
  step(dt:number){
    this.clock.step(dt);this.fx.step(dt);this.knock=Math.max(0,this.knock-dt*7);
    for(const cue of this.pirate.takeProps())if(this.L&&this.L.pirate.h>60&&!this.clock.hurry)propLight(this.fx,cue,this.L.pirate);
    if(this.tour){this.tour.t+=dt;if(this.tour.t>1.15){this.tour.t=0;this.tour.line=(this.tour.line+1)%this.tour.count;}}
    for(const c of this.cols)if(c.mode==='roll')c.p+=c.v*dt;else if(c.mode==='land'&&c.p<0)c.p=c.p;
    if(this.harbor.storm>.5&&!this.clock.reduced){this.boltT-=dt;if(this.boltT<0){this.boltT=4+Math.random()*5;this.bolt();}}
  }
  bolt(){let x=this.L.W*(.45+Math.random()*.4),y=0;this.boltPath=[{x,y}];for(let i=0;i<9;i++){x+=(Math.random()-.5)*this.L.W*.05;y+=this.L.H*.035;this.boltPath.push({x,y});}
    this.sound('thunder');void this.clock.tween(1.1,u=>{this.harbor.bolt=Math.exp(-3.2*u)*(u<.1?u*10:1);},ease.lin,true).then(()=>{this.harbor.bolt=0;this.boltPath=[];});}
  private spawn:Spawn=(k,x,y,s,dir=0)=>{if(this.clock.hurry)return;
    if(k==='flash')this.fx.add({k:'flash',x,y,d:.14,s});
    else if(k==='puff')this.fx.smoke(x,y,3,s,Math.cos(dir)*60,Math.sin(dir)*60);
    else if(k==='glint')this.fx.glint(x,y,s);
    else if(k==='feather'){const c=['#e23b2a','#2477c9','#2fae6a','#f1b13a'][Math.floor(Math.random()*4)];this.fx.add({k:'feather',x,y,vx:(Math.random()-.5)*60,vy:-30-Math.random()*40,g:60,d:1.5,s:s*.5,vr:2,c,drag:.8});}};
  private frame9(){
    const {board:B,b}=this.L,out=b,w=B.w+out*2,h=B.h+out*2;
    if(!this.frameCache&&this.frameImg){const m=14,c=document.createElement('canvas');c.width=G((w+m*2)*this.dpr);c.height=G((h+m*2)*this.dpr);const g=c.getContext('2d')!;g.scale(this.dpr,this.dpr);g.imageSmoothingQuality='high';g.shadowColor='rgba(0,12,22,.6)';g.shadowBlur=14;g.shadowOffsetY=7;
      const one=document.createElement('canvas');one.width=c.width;one.height=c.height;const o=one.getContext('2d')!;o.scale(this.dpr,this.dpr);o.translate(m,m);o.imageSmoothingQuality='high';
      // corner pieces keep their proportions, the planks stretch between them
      const S=[345,240],ox=44,oy=30,iw=1536-ox*2,ih=1024-30-58,k=b/118,cw=S[0]*k,ch=S[1]*k,i=this.frameImg,sx=[ox,ox+S[0],1536-ox-S[0]],sw=[S[0],iw-S[0]*2,S[0]],sy=[oy,oy+S[1],1024-58-S[1]],sh=[S[1],ih-S[1]*2,S[1]],dx=[0,cw,w-cw],dw=[cw,w-cw*2,cw],dy=[0,ch,h-ch],dh=[ch,h-ch*2,ch];
      for(let r=0;r<3;r++)for(let q=0;q<3;q++)if(r!==1||q!==1)o.drawImage(i,sx[q],sy[r],sw[q],sh[r],dx[q]-.3,dy[r]-.3,dw[q]+.6,dh[r]+.6);
      g.drawImage(one,0,0,w+m*2,h+m*2);this.frameCache=c;(c as any).m=m;}
    return this.frameCache;
  }
  draw(){
    if(!this.ready||!this.L)return;const {W,H,board:B,b}=this.L,g=this.g,now=this.clock.now,c=this.cell;
    g.setTransform(this.dpr,0,0,this.dpr,0,0);g.clearRect(0,0,W,H);g.save();
    const mx=B.x+B.w/2,my=B.y+B.h/2;g.translate(mx+this.recoil.x,my+this.recoil.y);g.rotate(this.rock);g.translate(-mx,-my);
    const ky=Math.sin(now*60)*this.knock*1.2;g.translate(0,ky);
    // field
    g.save();g.beginPath();g.rect(B.x-3,B.y-3,B.w+6,B.h+6);g.clip();
    const bg=g.createRadialGradient(mx,B.y+B.h*.08,B.h*.05,mx,my,B.w*.62);const st=this.harbor.storm,su=this.harbor.sunset;
    bg.addColorStop(0,st>.5?'#1d4a63':su>.5?'#4a2c4c':'#15506f');bg.addColorStop(1,st>.5?'#04141f':su>.5?'#170d22':'#062136');g.fillStyle=bg;g.fillRect(B.x-4,B.y-4,B.w+8,B.h+8);
    g.strokeStyle='rgba(206,170,102,.22)';g.lineWidth=1;g.beginPath();for(let i=1;i<6;i++){g.moveTo(B.x+i*c,B.y);g.lineTo(B.x+i*c,B.y+B.h);}for(let i=1;i<4;i++){g.moveTo(B.x,B.y+i*c);g.lineTo(B.x+B.w,B.y+i*c);}g.stroke();
    const size=c*.88;
    for(let q=0;q<6;q++){const col=this.cols[q],cx=B.x+(q+.5)*c;
      if(col.mode==='roll'){
        const seed=(n:number)=>Math.abs(Math.imul(n*31+col.seed,2654435761)>>>3)%6,base=Math.floor(col.p);
        for(let r=-2;r<6;r++){const y=B.y+(r+.5+(col.p-base))*c;if(y>B.y-c&&y<B.y+B.h+c)rolling(g,seed(r-base),cx,y,size,Math.abs(col.v));}
        const sh=g.createLinearGradient(B.x+q*c,0,B.x+(q+1)*c,0);sh.addColorStop(0,'rgba(2,16,26,.34)');sh.addColorStop(.5,'rgba(120,200,220,.05)');sh.addColorStop(1,'rgba(2,16,26,.34)');g.fillStyle=sh;g.fillRect(B.x+q*c,B.y,c,B.h);
        continue;
      }
      for(let r=0;r<4;r++){const i=r*6+q;if(this.covered(i)&&col.mode==='rest')continue;
        const y=B.y+(r+.5+col.p)*c;if(this.covered(i))continue;
        const a=this.act.get(i),lit=this.glow.has(i);
        g.globalAlpha=this.dim&&!lit?1-this.dim*.52:1;
        if(a&&!this.clock.reduced){let u=(now-a.t)/1.5;if(u>1){if(a.loop&&u>2.1){a.t=now;a.last=0;u=0;}else u=Math.min(u,1);}alive(g,this.grid[i],cx,y,size,Math.min(1,u),a.last,this.spawn);a.last=Math.min(1,u);}
        else{const since=now-col.land,sq=col.mode==='land'&&col.p>-.5?Math.exp(-9*since)*Math.sin(since*26)*.16:0;
          if(sq){g.save();g.translate(cx,y);g.scale(1+sq*.5,1-sq);plain(g,this.grid[i],0,0,size);g.restore();}else plain(g,this.grid[i],cx,y,size);}
        g.globalAlpha=1;
      }
      if(col.mode==='land'&&col.p<-.05){const seed=(n:number)=>Math.abs(Math.imul(n*31+col.seed,2654435761)>>>3)%6;for(let r=0;r<4;r++)rolling(g,seed(r-Math.floor(col.p)),cx,B.y+(r+.5+4+col.p)*c,size,22);}
    }
    if(this.block)this.drawBlock(g);
    // winning cells
    for(const [p,t] of this.glow){if(this.covered(p))continue;const u=clamp((now-t)/.25),k=this.center(p),pulse=.75+.25*Math.sin(now*4.5);
      g.strokeStyle=this.quiet?`rgba(176,214,222,${u*.85})`:`rgba(255,220,140,${u*pulse})`;g.lineWidth=this.quiet?1.6:2.2;g.shadowColor='#ffb648';g.shadowBlur=this.quiet?0:9;round(g,k.x-c/2+3,k.y-c/2+3,c-6,c-6,6);g.stroke();g.shadowBlur=0;}
    const sh=g.createLinearGradient(0,B.y,0,B.y+B.h);sh.addColorStop(0,'rgba(0,8,16,.5)');sh.addColorStop(.08,'rgba(0,8,16,0)');sh.addColorStop(.94,'rgba(0,8,16,0)');sh.addColorStop(1,'rgba(0,8,16,.42)');g.fillStyle=sh;g.fillRect(B.x-4,B.y-4,B.w+8,B.h+8);
    g.restore();
    const fr=this.frame9();if(fr){const m=(fr as any).m;g.drawImage(fr,B.x-b-m,B.y-b-m,fr.width/this.dpr,fr.height/this.dpr);}
    for(const s of this.slashes)this.drawSlash(g,s);
    this.drawTags(g);if(this.tour)this.drawTour(g);
    this.drawHooks(g);
    if(this.chest)this.drawChest(g);
    g.restore();
    // top layer
    const f=this.f;f.setTransform(this.dpr,0,0,this.dpr,0,0);f.clearRect(0,0,W,H);
    if(this.boltPath.length&&this.harbor.bolt>.05){f.save();f.globalCompositeOperation='lighter';f.strokeStyle=`rgba(205,225,255,${this.harbor.bolt*.8})`;f.shadowColor='#a9ccff';f.shadowBlur=12;f.lineWidth=1.7;f.beginPath();this.boltPath.forEach((p,i)=>i?f.lineTo(p.x,p.y):f.moveTo(p.x,p.y));f.stroke();f.restore();}
    if(this.L.gun)this.drawGun(f);
    if(this.ball){const p=this.ball;f.fillStyle='#14161a';f.beginPath();f.arc(p.x,p.y,p.s,0,7);f.fill();const gr=f.createRadialGradient(p.x-p.s*.35,p.y-p.s*.4,0,p.x,p.y,p.s);gr.addColorStop(0,'rgba(190,200,215,.85)');gr.addColorStop(.5,'rgba(70,78,90,.5)');gr.addColorStop(1,'rgba(0,0,0,0)');f.fillStyle=gr;f.beginPath();f.arc(p.x,p.y,p.s,0,7);f.fill();}
    this.fx.draw(f,W,H,now);
    // rain falls behind every plate and thins out over the field
    const r=this.rainLayer,rg=this.rg;if(this.fx.rain>0||this.wet){rg.setTransform(1,0,0,1,0,0);rg.clearRect(0,0,r.width,r.height);this.wet=this.fx.rain>0;if(this.wet){this.fx.drawRain(rg,W,H,now);rg.globalCompositeOperation='destination-out';rg.fillStyle='rgba(0,0,0,.62)';rg.fillRect(B.x,B.y,B.w,B.h);rg.globalCompositeOperation='source-over';}}
  }
  /** The deck gun is one drawing, lit by the same sky as the rest of the scene. */
  private gunIn(k:'sunset'|'storm'){let c=this.gunTint.get(k);const i=this.gunImg!;if(!c){c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d')!;g.drawImage(i,0,0);g.globalCompositeOperation='multiply';g.fillStyle=k==='storm'?'#5d7488':'#c98a78';g.fillRect(0,0,c.width,c.height);g.globalCompositeOperation='destination-in';g.drawImage(i,0,0);this.gunTint.set(k,c);}return c;}
  private drawGun(g:CanvasRenderingContext2D){
    const n=this.L.gun!,i=this.gunImg;if(!i)return;const k=n.s/GUN.w,kick=this.gun.kick,h=this.harbor;
    g.save();g.translate(n.x-kick*n.s*.10,n.y);
    const sh=g.createRadialGradient(n.s*.36,0,0,n.s*.36,0,n.s*.5);sh.addColorStop(0,'rgba(0,6,10,.6)');sh.addColorStop(1,'rgba(0,6,10,0)');g.save();g.scale(1,.16);g.fillStyle=sh;g.fillRect(-n.s*.2,-n.s*.6,n.s*1.2,n.s*1.2);g.restore();
    g.translate(n.s*.14,0);g.rotate(-Math.max(0,kick)*.05);g.translate(-n.s*.14,0);
    const put=(im:CanvasImageSource)=>g.drawImage(im,GUN.x,GUN.y,GUN.w,GUN.h,0,-(GUN.ground-GUN.y)*k,n.s,GUN.h*k);put(i);
    for(const q of ['sunset','storm'] as const)if(h[q]>.01){g.globalAlpha=h[q];put(this.gunIn(q));g.globalAlpha=1;}
    g.restore();
  }
  private drawBlock(g:CanvasRenderingContext2D){
    const bl=this.block!,r0=this.blockRect(bl),now=this.clock.now;let r=r0;
    if(this.grow){const f=this.blockRect(this.grow.from),u=this.grow.u;r={x:lerp(f.x,r0.x,u),y:lerp(f.y,r0.y,u),w:lerp(f.w,r0.w,u),h:lerp(f.h,r0.h,u)};}
    if(this.cols.some((c,q)=>c.mode==='roll'&&q>=bl.x&&q<bl.x+bl.size))return;
    const settled=this.cols.every((c,q)=>c.mode!=='land'||c.p>-.4||q<bl.x||q>=bl.x+bl.size);if(!settled)return;
    g.save();g.beginPath();g.rect(r.x+1,r.y+1,r.w-2,r.h-2);g.clip();
    const bg=g.createRadialGradient(r.x+r.w/2,r.y+r.h*.35,r.w*.05,r.x+r.w/2,r.y+r.h/2,r.w*.75);bg.addColorStop(0,this.harbor.sunset>.5?'#6a3d5e':'#1b5a7c');bg.addColorStop(1,this.harbor.sunset>.5?'#22122c':'#07283d');g.fillStyle=bg;g.fillRect(r.x,r.y,r.w,r.h);
    const lit=this.blockAct,size=r.w*.92,cx=r.x+r.w/2,cy=r.y+r.h/2+(1-this.rise)*r.h*1.02;
    if(this.ropes>.01){g.restore();g.save();const top=this.L.board.y-2,ty=Math.min(cy,r.y+r.h*.9);for(const k of [-.13,.13])rope(g,cx+k*r.w*1.8,top,cx+k*r.w,Math.max(top+6,ty),(1-this.ropes)*r.w*.25*Math.sign(k)+Math.sin(now*40)*1.1*this.ropes,3.4,this.ropes);g.beginPath();g.rect(r.x+1,r.y+1,r.w-2,r.h-2);g.clip();}
    const litBlock=lit||this.quiet&&[...this.glow.keys()].some(p=>this.covered(p));g.globalAlpha=this.dim&&!litBlock?1-this.dim*.4:1;
    if(lit&&!this.clock.reduced){let u=(now-lit.t)/1.7;if(u>2){lit.t=now;lit.last=0;u=0;}u=Math.min(1,u);alive(g,bl.symbol,cx,cy,size,u,lit.last,this.spawn);lit.last=u;}
    else{g.save();const k=this.grow?Math.sin(this.grow.u*Math.PI)*.04:0;g.translate(cx,cy);g.scale(1+k,1+k);plain(g,bl.symbol,0,0,size);g.restore();}
    g.globalAlpha=1;
    if(this.water>0){const top=r.y+r.h*(1-.62*this.water-.1*Math.sin(now*3)*this.water*.3),wv=(x:number,k:number)=>Math.sin(x*.045+now*5+k)*r.h*.018+Math.sin(x*.09-now*6.5+k)*r.h*.01;
      for(let l=0;l<2;l++){const y=top+l*r.h*.06;g.beginPath();g.moveTo(r.x,r.y+r.h);for(let x=0;x<=r.w;x+=6)g.lineTo(r.x+x,y+wv(x,l*2));g.lineTo(r.x+r.w,r.y+r.h);g.closePath();const gr=g.createLinearGradient(0,y,0,r.y+r.h);gr.addColorStop(0,l?'rgba(38,170,178,.62)':'rgba(120,226,222,.5)');gr.addColorStop(1,'rgba(4,58,86,.92)');g.fillStyle=gr;g.fill();if(!l){g.strokeStyle='rgba(225,252,250,.75)';g.lineWidth=2;g.stroke();}}}
    g.restore();
    const glow=lit?.75+.25*Math.sin(now*4.5):0;
    if(this.quiet&&[...this.glow.keys()].some(p=>this.covered(p))){g.strokeStyle='rgba(176,214,222,.85)';g.lineWidth=2;}else{g.strokeStyle=lit?`rgba(255,224,150,${.55+.45*glow})`:'rgba(220,178,98,.6)';g.lineWidth=lit?3:1.5;}if(lit){g.shadowColor='#ffb648';g.shadowBlur=14;}g.strokeRect(r.x+1.5,r.y+1.5,r.w-3,r.h-3);g.shadowBlur=0;
  }
  private drawSlash(g:CanvasRenderingContext2D,s:Slash){
    const n=s.pts.length-1,at=(u:number)=>{const k=clamp(u)*n,i=Math.min(n-1,Math.floor(k)),f=k-i,a=s.pts[i],b=s.pts[i+1];return{x:lerp(a.x,b.x,f),y:lerp(a.y,b.y,f)};};
    const done=s.u>=1,fade=done?.22+.05*Math.sin(this.clock.now*4):1,B=this.L.board;
    g.save();g.beginPath();g.rect(B.x,B.y,B.w,B.h);g.clip();g.lineCap='round';g.lineJoin='round';
    const coat=s.quiet?[[this.cell*.03,`rgba(190,226,232,${.7*(done?.6:1)})`]] as const:[[this.cell*(s.thin?.045:.075),`rgba(255,170,60,${.35*fade})`],[this.cell*(s.thin?.02:.032),`rgba(255,240,196,${.9*fade})`]] as const;
    for(const [w,col] of coat){g.strokeStyle=col;g.lineWidth=w;g.globalCompositeOperation=s.quiet?'source-over':'lighter';g.beginPath();const steps=30;for(let i=0;i<=steps;i++){const p=at(s.u*i/steps);i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y);}g.stroke();}
    g.globalCompositeOperation='source-over';
    if(!s.thin&&!s.quiet&&!done&&s.u>.03){const p=at(s.u),q=at(s.u-.04),a=Math.atan2(p.y-q.y,p.x-q.x),sz=this.cell*1.15;g.translate(p.x,p.y);g.rotate(a+.62);g.drawImage(images[3],-sz*.86,-sz*.12,sz,sz*.667);}
    g.restore();
  }
  /** The sum of the paid lines stands on their last symbol. */
  private drawTags(g:CanvasRenderingContext2D){
    const f=Math.max(12,Math.min(18,this.cell*.17));g.font=`700 ${f}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';
    const ends=new Map<number,{cents:number;a:number;quiet:boolean}>();
    for(const s of this.slashes){if(s.u<.85)continue;const e=ends.get(s.end)??{cents:0,a:0,quiet:s.quiet};e.cents+=s.cents;e.a=Math.max(e.a,clamp((s.u-.85)/.15));ends.set(s.end,e);}
    for(const [end,e] of ends){const label=money(e.cents),w=g.measureText(label).width+f*.9,h=f*1.5,B=this.L.board,c=this.center(end),x=clamp(c.x,B.x+w/2+2,B.x+B.w-w/2-2),y=clamp(c.y+this.cell*.36,B.y+h/2+2,B.y+B.h-h/2-2);
      g.globalAlpha=e.a;round(g,x-w/2,y-h/2,w,h,h*.3);g.fillStyle=e.quiet?'rgba(14,40,52,.92)':'rgba(46,22,8,.94)';g.fill();g.lineWidth=1.3;g.strokeStyle=e.quiet?'#8fb6bf':'#f0c469';g.stroke();g.fillStyle=e.quiet?'#dcecef':'#ffe9ab';g.fillText(label,x,y+f*.04);g.globalAlpha=1;}
    g.textAlign='left';g.textBaseline='alphabetic';
  }
  /** Active lines one after another, on the player's request. */
  private drawTour(g:CanvasRenderingContext2D){
    const t=this.tour!,row=CARIBBEAN_LINES[t.line],c=this.cell,B=this.L.board,pts=row.map((r,q)=>({x:B.x+(q+.5)*c,y:B.y+(r+.5)*c})),u=this.clock.reduced?1:ease.out(clamp(t.t/.45));
    g.save();g.beginPath();g.rect(B.x,B.y,B.w,B.h);g.clip();g.fillStyle='rgba(3,16,26,.42)';g.fillRect(B.x,B.y,B.w,B.h);g.restore();
    g.save();g.beginPath();g.rect(B.x-4,B.y,(B.w+8)*u,B.h);g.clip();g.lineCap=g.lineJoin='round';
    for(const [w,col] of [[c*.085,'rgba(40,18,4,.85)'],[c*.052,'#d7a153'],[c*.02,'#fff0c0']] as const){g.strokeStyle=col;g.lineWidth=w;g.beginPath();g.moveTo(B.x-4,pts[0].y);pts.forEach(p=>g.lineTo(p.x,p.y));g.lineTo(B.x+B.w+4,pts[5].y);g.stroke();}
    for(const p of pts){g.fillStyle='#fff0c0';g.strokeStyle='#4a2409';g.lineWidth=2;g.beginPath();g.arc(p.x,p.y,c*.07,0,7);g.fill();g.stroke();}g.restore();
    const f=Math.max(13,c*.2),x=B.x+f*.95,y=pts[0].y;g.fillStyle='#4a2409';g.strokeStyle='#f0c469';g.lineWidth=2;g.beginPath();g.arc(x,y,f*.92,0,7);g.fill();g.stroke();g.fillStyle='#ffe9ab';g.font=`700 ${f}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(String(t.line+1),x,y+1);g.textAlign='left';g.textBaseline='alphabetic';
  }
  private drawHooks(g:CanvasRenderingContext2D){
    const now=this.clock.now;
    for(const h of this.hooks){const u=h.u,x=lerp(h.fx,h.x,u),y=lerp(h.fy,h.y,u)-Math.sin(u*Math.PI)*60*(u<1?1:0),sag=26*(1-Math.min(1,h.tight*.8))+Math.sin(now*1.7+h.y)*3;
      rope(g,h.fx,h.fy,x-4,y,sag,3.6,1,true);
      g.save();g.translate(x,y);g.rotate(u<1?(1-u)*9:Math.sin(now*1.7+h.y)*.05);g.scale(this.L.b/26,this.L.b/26);g.lineCap='round';
      for(const [w,col] of [[6,'#16181b'],[3.6,'#757d86'],[1.2,'#c9d0d6']] as const){g.strokeStyle=col;g.lineWidth=w;g.beginPath();g.moveTo(-14,0);g.lineTo(6,0);for(const k of [-1,0,1]){g.moveTo(6,0);g.quadraticCurveTo(17,k*3,14,k*13);if(k)g.lineTo(9,k*9);else g.lineTo(18,0);}g.stroke();}
      g.beginPath();g.arc(-16,0,4,0,7);g.strokeStyle='#5c646c';g.lineWidth=2.4;g.stroke();g.restore();}
  }
  drawChest(g:CanvasRenderingContext2D){const c=this.chest!,B=this.L.board;
    g.save();g.beginPath();g.rect(B.x-this.L.b,B.y-this.L.b,B.w+this.L.b*2,B.h+this.L.b*2);
    g.fillStyle=`rgba(4,12,22,${.8*c.rays})`;g.fillRect(B.x,B.y,B.w,B.h);
    g.beginPath();g.rect(B.x,B.y,B.w,B.h);g.clip();rays(g,c.x,c.y-c.s*.45,B.w*.75,c.rays,this.clock.now);g.restore();
    chest(g,this.wood!,c.x,c.y+(1-c.u)*c.s*.4,c.s,c.lid,c.u);
  }
}
export function rays(g:CanvasRenderingContext2D,x:number,y:number,r:number,a:number,now:number){
  g.save();g.globalCompositeOperation='lighter';g.translate(x,y);g.rotate(now*.12);
  for(let i=0;i<14;i++){const w=i%2?.10:.17;g.rotate(Math.PI/7);const gr=g.createRadialGradient(0,0,0,0,0,r);gr.addColorStop(0,`rgba(255,214,120,${.24*a})`);gr.addColorStop(1,'rgba(255,190,80,0)');g.fillStyle=gr;g.beginPath();g.moveTo(0,0);g.arc(0,0,r,-w,w);g.fill();}
  const gl=g.createRadialGradient(0,0,0,0,0,r*.5);gl.addColorStop(0,`rgba(255,236,170,${.6*a})`);gl.addColorStop(1,'rgba(255,190,80,0)');g.fillStyle=gl;g.fillRect(-r,-r,r*2,r*2);g.restore();
}
function round(g:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
export function rope(g:CanvasRenderingContext2D,x0:number,y0:number,x1:number,y1:number,sag:number,w:number,a=1,down=false){
  g.save();g.globalAlpha=a;g.lineCap='round';const mx=(x0+x1)/2+(down?0:sag),my=(y0+y1)/2+(down?sag:0);
  const path=()=>{g.beginPath();g.moveTo(x0,y0);g.quadraticCurveTo(mx,my,x1,y1);};
  g.strokeStyle='#3b2614';g.lineWidth=w+2;path();g.stroke();g.strokeStyle='#b98a52';g.lineWidth=w;path();g.stroke();g.setLineDash([w*.9,w*1.1]);g.strokeStyle='#e7c48c';g.lineWidth=w*.5;path();g.stroke();g.restore();
}
/** A chest built from planks and brass that already exist in the scene. */
export function chest(g:CanvasRenderingContext2D,wood:HTMLImageElement,x:number,y:number,s:number,lid:number,a=1){
  const w=s,h=s*.46,lh=s*.34;g.save();g.globalAlpha=Math.min(1,a*1.4);g.translate(x,y);
  const plank=(px:number,py:number,pw:number,ph:number,shade:number)=>{g.save();g.beginPath();g.rect(px,py,pw,ph);g.clip();const n=3;for(let i=0;i<n;i++){g.drawImage(wood,700+i*20,782,330,34,px,py+ph*i/n,pw,ph/n+1);g.fillStyle='rgba(30,14,5,.5)';g.fillRect(px,py+ph*(i+1)/n-1.5,pw,2);}g.globalCompositeOperation='multiply';g.fillStyle='#b0703c';g.fillRect(px,py,pw,ph);g.globalCompositeOperation='source-over';g.fillStyle=`rgba(40,18,6,${shade})`;g.fillRect(px,py,pw,ph);const gr=g.createLinearGradient(0,py,0,py+ph);gr.addColorStop(0,'rgba(255,220,150,.16)');gr.addColorStop(1,'rgba(10,4,2,.5)');g.fillStyle=gr;g.fillRect(px,py,pw,ph);g.restore();};
  const brass=(px:number,py:number,pw:number,ph:number)=>{const gr=g.createLinearGradient(px,py,px+Math.max(pw,3),py+ph);gr.addColorStop(0,'#fff0b8');gr.addColorStop(.35,'#e0a53f');gr.addColorStop(1,'#80490f');g.fillStyle=gr;g.fillRect(px,py,pw,ph);g.strokeStyle='rgba(60,30,6,.7)';g.lineWidth=1;g.strokeRect(px,py,pw,ph);};
  const rivet=(px:number,py:number,r:number)=>{const gr=g.createRadialGradient(px-r*.3,py-r*.3,0,px,py,r);gr.addColorStop(0,'#fff6cf');gr.addColorStop(1,'#93570f');g.fillStyle=gr;g.beginPath();g.arc(px,py,r,0,7);g.fill();};
  g.fillStyle='rgba(0,8,14,.45)';g.beginPath();g.ellipse(0,0,w*.6,s*.07,0,0,7);g.fill();
  const open=lid;
  // inside and the raised lid behind the treasure
  g.save();g.translate(0,-h);
  const up=lerp(1,-.82,open);g.save();g.scale(1,Math.max(.06,Math.abs(up)));
  if(up<0){g.fillStyle='#2b1408';roundTop(g,-w*.5,-lh*1.1,w,lh*1.1,lh*.5);g.fill();const gr=g.createLinearGradient(0,-lh,0,0);gr.addColorStop(0,'rgba(0,0,0,.2)');gr.addColorStop(1,'rgba(255,200,90,.35)');g.fillStyle=gr;roundTop(g,-w*.46,-lh*1.02,w*.92,lh*1.0,lh*.45);g.fill();g.lineWidth=s*.035;g.strokeStyle='#d69b3a';roundTop(g,-w*.5,-lh*1.1,w,lh*1.1,lh*.5);g.stroke();}
  g.restore();g.restore();
  if(open>.15){const gr=g.createRadialGradient(0,-h,0,0,-h,w*.62);gr.addColorStop(0,`rgba(255,240,180,${.9*open})`);gr.addColorStop(1,'rgba(255,190,70,0)');g.globalCompositeOperation='lighter';g.fillStyle=gr;g.fillRect(-w,-h-w*.6,w*2,w*.8);g.globalCompositeOperation='source-over';
    for(let i=0;i<15;i++){const t=i/14;coin(g,(t-.5)*w*.84,-h-Math.sin(t*Math.PI)*s*.10-(i%3)*s*.018,s*.052,i*1.7);}
    g.fillStyle='#d21f43';for(const [px,py] of [[-.18,-.07],[.2,-.06]]){g.beginPath();g.moveTo(px*w,-h+py*s-s*.05);g.lineTo(px*w+s*.04,-h+py*s);g.lineTo(px*w,-h+py*s+s*.04);g.lineTo(px*w-s*.04,-h+py*s);g.fill();}}
  plank(-w*.5,-h,w,h,.22);
  for(const k of [-.5,-.28,.22,.44])brass(k*w,-h,w*.06,h);
  brass(-w*.5,-h,w,s*.045);brass(-w*.5,-s*.05,w,s*.05);
  for(const k of [-.47,-.25,.25,.47])for(const v of [-h+s*.022,-s*.025])rivet(k*w,v,s*.016);
  if(up>0){g.save();g.translate(0,-h);g.scale(1,up);roundTop(g,-w*.5,-lh,w,lh,lh*.55);g.save();g.clip();g.restore();g.save();roundTop(g,-w*.5,-lh,w,lh,lh*.55);g.clip();plank(-w*.5,-lh,w,lh,.12);for(const k of [-.5,-.28,.22,.44])brass(k*w,-lh,w*.06,lh);brass(-w*.5,-s*.045,w,s*.045);g.restore();g.lineWidth=s*.028;g.strokeStyle='#c98f35';roundTop(g,-w*.5,-lh,w,lh,lh*.55);g.stroke();g.restore();}
  brass(-s*.075,-h-s*.03,s*.15,s*.18);g.fillStyle='#2a1206';g.beginPath();g.arc(0,-h+s*.045,s*.024,0,7);g.fill();g.fillRect(-s*.01,-h+s*.05,s*.02,s*.05);
  g.restore();
}
function roundTop(g:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){g.beginPath();g.moveTo(x,y+h);g.lineTo(x,y+r);g.quadraticCurveTo(x,y,x+r,y);g.lineTo(x+w-r,y);g.quadraticCurveTo(x+w,y,x+w,y+r);g.lineTo(x+w,y+h);g.closePath();}
export {CARIBBEAN_LINES};
