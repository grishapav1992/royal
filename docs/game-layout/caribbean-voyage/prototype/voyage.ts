import {CREW,RATES,unlockedCount} from './crew';
import {Clock,clamp,ease,lerp} from './clock';
import {Effects} from './effects';
import {Pirate,portrait,soften} from './pirate';
import {chest,rays} from './stage';
import {loadImage} from './gl';
import {dialogClose,dialogOpen,lang,points,t} from './text';
export type CrewState={points:number;met:Set<string>;selected:string};
const WIDE=[[10,80],[22,56],[10,28],[31,18],[43,44],[38,79],[58,80],[64,50],[60,17],[82,24],[86,66]],TALL=[[15,90],[50,87],[84,90],[84,62],[50,66],[16,61],[16,35],[50,39],[84,34],[70,10],[29,11]];
const thumb=(id:string)=>'assets/crew/'+id+'-thumb.webp';
export const nameOf=(m:{ru:string;en:string})=>t(m.ru,m.en);
const titleOf=(m:{titleRu:string;titleEn:string})=>t(m.titleRu,m.titleEn);
export class Voyage{
  private pick='';private ship=0;private clock=new Clock();private fx=new Effects();private pirate?:Pirate;private rv?:{g:CanvasRenderingContext2D;c:HTMLCanvasElement;s:{lid:number;up:number;ray:number;show:number;boat:number};id:string;W:number;H:number;dpr:number};private wood?:HTMLImageElement;open=false;
  constructor(private box:HTMLElement,private state:CrewState,private hooks:{select:(id:string)=>void;changed:()=>void;cue:(c:string)=>void;reduced:()=>boolean;blocked:()=>boolean;mode:()=>string}){void loadImage('assets/harbor.webp').then(i=>{this.wood=i;});}
  fresh(){return CREW.find(m=>this.state.points>=m.points&&!this.state.met.has(m.id));}
  /** Position along the route: whole numbers are islands. */
  private along(){const n=unlockedCount(this.state.points)-1;if(n>=CREW.length-1)return CREW.length-1;const a=CREW[n].points,b=CREW[n+1].points;return n+(this.state.points-a)/(b-a)*(this.hooks.mode()==='wide'?.48:.36)+(n||this.state.points?.08:0);}
  async show(){
    this.open=true;this.pick=this.state.selected;const f=this.fresh();this.box.hidden=false;
    const target=f?CREW.indexOf(f):this.along();this.ship=f?Math.max(0,target-.75):target;
    this.render();const ch=this.box.querySelector<HTMLElement>('.chart')!;ch.scrollTop=this.at(this.ship).y/100*(this.box.querySelector<HTMLElement>('.route')!.offsetHeight)-60;dialogOpen(this.box,t('Карта плавания','Voyage map'),this.box.querySelector<HTMLElement>('[data-close]'));
    if(f){this.pick=f.id;await this.clock.tween(this.hooks.reduced()?.01:.9,u=>{this.ship=lerp(target-.75,target-.12,u);this.placeShip();},ease.io,true);if(this.open)void this.reveal(f.id);}
  }
  close(){this.open=false;this.box.hidden=true;this.box.replaceChildren();this.rv=undefined;this.pirate=undefined;this.fx.clear();dialogClose(this.box);}
  private pos(){return this.hooks.mode()==='portrait'?TALL:WIDE;}
  private at(u:number){const p=this.pos(),i=Math.min(p.length-2,Math.floor(u)),f=clamp(u-i),a=p[i],b=p[i+1],m=this.mid(i);const k=1-f;return{x:k*k*a[0]+2*k*f*m[0]+f*f*b[0],y:k*k*a[1]+2*k*f*m[1]+f*f*b[1]};}
  private mid(i:number){const p=this.pos(),a=p[i],b=p[i+1],s=i%2?1:-1;return[(a[0]+b[0])/2+(b[1]-a[1])*.18*s,(a[1]+b[1])/2-(b[0]-a[0])*.18*s];}
  render(){
    const S=this.state,n=unlockedCount(S.points),next=CREW[n],m=CREW.find(x=>x.id===this.pick)!,own=S.met.has(m.id),can=S.points>=m.points,sel=S.selected===m.id,mode=this.hooks.mode();
    const is=mode==='portrait'?'clamp(44px,14cqw,62px)':mode==='short'?'clamp(38px,9.5cqw,46px)':'clamp(54px,9.2cqw,78px)';
    const focus=(document.activeElement as HTMLElement|null)?.dataset?.id??((document.activeElement as HTMLElement|null)?.hasAttribute('data-pick')?'pick':'');
    const num=(v:number)=>(v/100).toLocaleString(lang.en?'en-US':'ru-RU',{minimumFractionDigits:v<100||v%100?2:0});
    const top=this.box.querySelector('.chart')?.scrollTop??0;
    this.box.innerHTML=`<div class="chart"><header><h3>${t('Карта плавания','Voyage map')}</h3><span>${t(`Открыто ${S.met.size} из ${CREW.length}`,`${S.met.size} of ${CREW.length} found`)}</span><b>${S.points} ${points(S.points)}</b><button data-close aria-label="${t('Закрыть','Close')}">×</button></header>
    <div class="who"><div class="pic ${own?'':'lock'}" style="background-image:url(${portrait(m.id)})"></div><div class="nm"><b>${own?nameOf(m):t('Неизвестная','Unknown')}</b><small>${own?titleOf(m):can?t('Ждёт на берегу','Waiting ashore'):t('Ещё','Needs')+` ${m.points-S.points} ${points(m.points-S.points)}`}</small><button data-pick ${sel||!can||own&&this.hooks.blocked()?'disabled':''}>${sel?t('На палубе','On deck'):own?this.hooks.blocked()?t('После раунда','After the round'):t('Сделать героиней','Bring on deck'):can?t('Встретить','Meet her'):t('Закрыта','Locked')}</button></div></div>
    <div class="route" style="--is:${is};container-type:inline-size"><div class="engrave" style="left:24%;top:24%;width:30%;height:46%;background-size:700%;background-position:26.5% 43%"></div><div class="engrave" style="right:2%;bottom:0;width:34%;height:44%;background-size:420%;background-position:80% 33%"></div><canvas></canvas>
    ${CREW.map((c,i)=>{const [x,y]=this.pos()[i],o=S.met.has(c.id),ready=S.points>=c.points,tag=o?nameOf(c):ready?t('Новая','New'):c===next?t('ещё ','+')+(c.points-S.points):String(c.points);return `<button class="isle ${o?'':'lock'} ${c.id===this.pick?'sel':''} ${ready&&!o?'fresh':''}" style="left:${x}%;top:${y}%" data-id="${c.id}" aria-label="${o?nameOf(c)+(S.selected===c.id?', '+t('на палубе','on deck'):''):t('Закрытая пиратка','Locked pirate')+', '+c.points+' '+points(c.points)}"><span class="m"><img src="${thumb(c.id)}" alt=""></span><span class="tag"><b>${tag}</b>${mode==='wide'&&S.selected===c.id?`<small>${t('на палубе','on deck')}</small>`:''}</span></button>`;}).join('')}
    <svg class="vship" viewBox="0 0 60 60" aria-hidden="true"><path d="M8 40h44l-6 11H15z" fill="#5a3319" stroke="#2f1809" stroke-width="2"/><path d="M8 40h44l-1.5 3H9.5z" fill="#c8923f"/><path d="M22 40V10M38 40V14" stroke="#3a1f0d" stroke-width="2.6"/><path d="M23 13c9 2 10 9 9 15-4 1-7 1-9 0zM39 17c7 2 8 8 7 13-3 1-5 1-7 0z" fill="#f6ead0" stroke="#8a683b"/><path d="M21 15c-7 3-9 8-8 13 3 1 5 1 8 0z" fill="#efdfbd" stroke="#8a683b"/><path d="M22 10V4l9 3z" fill="#20140e"/><path d="M4 53c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0" fill="none" stroke="#2a7a90" stroke-width="2.6"/></svg></div>
    <div class="rates"><span>${t('Очки за завершённый раунд, по списанной сумме USDT','Points for a finished round, by the USDT charged')}</span>${RATES.map((r,i)=>`<div>${i===RATES.length-1?t('от 50','50 and up'):[r.from,RATES[i+1].from-1].map(num).join('–')}<b>+${r.points}</b></div>`).join('')}</div></div>`;
    this.box.querySelector('[data-close]')!.addEventListener('click',()=>this.close());
    this.box.querySelectorAll<HTMLElement>('.isle').forEach(b=>b.addEventListener('click',()=>{b.focus();this.pick=b.dataset.id!;this.hooks.cue('click');this.render();}));
    this.box.querySelector('[data-pick]')!.addEventListener('click',()=>{if(!S.met.has(this.pick)){void this.reveal(this.pick);return;}this.hooks.select(this.pick);this.render();});
    this.box.querySelector('.chart')!.scrollTop=top;this.paint();this.placeShip();
    if(focus)(focus==='pick'?this.box.querySelector<HTMLElement>('[data-pick]:not(:disabled)')??this.box.querySelector<HTMLElement>('[data-close]'):this.box.querySelector<HTMLElement>(`[data-id=${focus}]`))?.focus({preventScroll:true});
  }
  private placeShip(){const s=this.box.querySelector<HTMLElement>('.vship');if(!s)return;const p=this.at(this.ship),q=this.at(Math.min(CREW.length-1,this.ship+.05));s.style.left=p.x+'%';s.style.top=p.y+'%';s.style.transform=`translate(-50%,-78%) scaleX(${q.x<p.x-.01?-1:1}) rotate(${(Math.sin(this.ship*18)*5).toFixed(1)}deg)`;}
  /** Parchment, islands and the route. Hand-drawn in code. */
  private paint(){
    const c=this.box.querySelector<HTMLCanvasElement>('.route canvas')!,w=c.offsetWidth,h=c.offsetHeight,d=2;if(!w||!h)return;c.width=w*d;c.height=h*d;const g=c.getContext('2d')!;g.scale(d,d);
    let seed=7;const R=()=>{seed=Math.imul(seed^seed>>>15,2246822519)^Math.imul(seed^seed>>>13,3266489917);return((seed>>>0)%10000)/10000;};
    const tight=this.hooks.mode()!=='wide',P=this.pos().map(([x,y])=>({x:x*w/100,y:y*h/100})),r=(this.box.querySelector('.isle .m') as HTMLElement).offsetWidth*.5;
    g.strokeStyle='rgba(92,56,22,.17)';g.lineWidth=1;for(let i=0;i<46;i++){const x=R()*w,y=R()*h;g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+5,y-5,x+10,y);g.quadraticCurveTo(x+15,y-5,x+20,y);g.stroke();}
    // the route lies under the islands, so it never breaks off between them
    const along=this.along();
    for(let i=0;i<P.length-1;i++){const steps=30;for(let k=0;k<steps;k++){const u=i+k/steps,a=this.at(u);g.fillStyle=u<=along?'#a3231a':'rgba(98,58,24,.55)';g.beginPath();g.arc(a.x*w/100,a.y*h/100,u<=along?3:2.1,0,7);g.fill();}}
    P.forEach((p,i)=>{const kx=[1.5,1.34,1.6,1.4,1.3,1.62,1.45,1.35,1.55,1.4,1.6][i]*(tight?.88:1),ky=[1.1,1.3,1.08,1.22,1.34,1.05,1.2,1.3,1.1,1.28,1.16][i]*(tight?.9:1),rx=r*kx,ry=r*ky,n=9+i%4*2,pts=Array.from({length:n},(_,k)=>{const a=k/n*Math.PI*2+i,q=.84+R()*.3;return{x:p.x+Math.cos(a)*rx*q,y:p.y+r*.10+Math.sin(a)*ry*q};});
      const blob=(k:number)=>{g.beginPath();pts.forEach((q,j)=>{const z=pts[(j+1)%n],mx=p.x+((q.x+z.x)/2-p.x)*k,my=p.y+((q.y+z.y)/2-p.y)*k,cx=p.x+(q.x-p.x)*k,cy=p.y+(q.y-p.y)*k;j?g.quadraticCurveTo(cx,cy,mx,my):g.moveTo(mx,my);});g.closePath();};
      for(const k of tight?[1.2]:[1.34,1.2]){blob(k);g.strokeStyle='rgba(60,96,104,.28)';g.lineWidth=1;g.stroke();}
      blob(1.08);g.fillStyle=['#ecd3a0','#e6cfa6','#e9d7b0'][i%3];g.fill();g.strokeStyle='#7a4f22';g.lineWidth=1.6;g.stroke();blob(.88);g.fillStyle=['rgba(110,132,66,.6)','rgba(134,122,96,.5)','rgba(126,140,74,.55)','rgba(170,132,74,.45)'][i%4];g.fill();
      const side=p.x>w*.82?-1:1;landmark(g,i,p.x+side*rx*.86,p.y-ry*.52,r*(tight?.62:.7));});
  }
  /* Meeting a new pirate ---------------------------------------------------------- */
  async reveal(id:string){
    const m=CREW.find(x=>x.id===id)!,now=CREW.find(x=>x.id===this.state.selected)!,el=document.createElement('div');el.className='reveal';
    el.innerHTML=`<canvas class="r1"></canvas><canvas class="r2"></canvas><button class="rvskip">${t('Пропустить','Skip')}</button><div class="rv off"><small>${t('Новая пиратка в команде','New pirate in the crew')}</small><b>${nameOf(m)}</b><small>${titleOf(m)}</small><div><button data-a="pick" ${this.hooks.blocked()?'disabled':''}>${t('Сделать героиней','Bring on deck')}</button><button data-a="keep">${t('Оставить','Keep')} ${lang.en?now.en:now.ru.replace(/а$/,'у').replace(/я$/,'ю')}</button></div><small class="note">${t('Выбрать её можно и позже, на карте','You can choose her later on the map')}</small></div>`;
    this.box.append(el);const W=el.offsetWidth,H=el.offsetHeight,dpr=Math.min(2,devicePixelRatio||1),c=el.querySelector<HTMLCanvasElement>('.r1')!,pc=el.querySelector<HTMLCanvasElement>('.r2')!,short=this.hooks.mode()==='short';
    c.width=W*dpr;c.height=H*dpr;c.style.width=W+'px';c.style.height=H+'px';
    const skip=el.querySelector<HTMLButtonElement>('.rvskip')!,clock=this.clock;clock.hurry=false;skip.onclick=()=>{clock.hurry=true;};skip.focus({preventScroll:true});
    this.pirate=new Pirate(pc);const ph=Math.min(H*(short?.92:.66),W*1.28),pw=ph*2/3,px=short?W*.3-pw/2:(W-pw)/2;Object.assign(pc.style,{width:pw+'px',height:ph+'px',left:px+'px',top:(short?H-ph:H*.70-ph)+'px',transformOrigin:'50% 100%',filter:'none',zIndex:'3'});this.pirate.resize(pw,ph,dpr);pc.style.opacity='0';soften(pc,'linear-gradient(transparent,#000 4%,#000 80%,transparent)');
    this.rv={g:c.getContext('2d')!,c,s:{lid:0,up:0,ray:0,show:0,boat:0},id,W,H,dpr};const s=this.rv.s;
    await this.pirate.select(id);if(!this.open||!el.isConnected)return;
    this.hooks.cue('chest');const fast=this.hooks.reduced(),T=(t:number)=>fast?.01:t;
    await clock.tween(T(.6),u=>{s.boat=u;},ease.out);
    this.hooks.cue('open');
    await clock.tween(T(.36),u=>{s.lid=u;s.ray=u;},ease.back);
    if(!el.isConnected||!this.pirate)return;this.hooks.cue('reveal');
    if(!fast&&!clock.hurry)for(let i=0;i<46;i++){const a=-Math.PI/2+(Math.random()-.5)*1.5,v=H*(.6+Math.random()*.8);this.fx.coin(this.cx(),H*.78-30,Math.cos(a)*v*.6,Math.sin(a)*v,8+Math.random()*7,H*.8+Math.random()*30);}
    const her=this.pirate;her.tint=[.04,.03,.05];
    void clock.tween(T(.3),u=>{pc.style.opacity=String(u);},ease.lin);
    await clock.tween(T(.7),u=>{s.up=u;},ease.out);
    if(!el.isConnected)return;her.show('win',2.2);her.gesture('win');
    await clock.tween(T(.5),u=>{her.tint=[lerp(.04,1,u),lerp(.03,1,u),lerp(.05,1,u)];s.show=u;},ease.io);
    if(!el.isConnected)return;clock.hurry=false;pc.style.opacity='1';skip.remove();
    const rv=el.querySelector('.rv')!;rv.classList.remove('off');
    const done=(pick:boolean)=>{this.state.met.add(id);if(pick)this.hooks.select(id);this.hooks.changed();this.rv=undefined;this.pirate=undefined;this.fx.clear();this.pick=id;this.ship=this.along();el.remove();this.render();this.box.querySelector<HTMLElement>('[data-close]')!.focus({preventScroll:true});};
    const a=el.querySelector<HTMLButtonElement>('[data-a=pick]')!,k=el.querySelector<HTMLButtonElement>('[data-a=keep]')!;a.onclick=()=>done(true);k.onclick=()=>done(false);(a.disabled?k:a).focus({preventScroll:true});
  }
  private cx(){return this.hooks.mode()==='short'?this.rv!.W*.3:this.rv!.W/2;}
  step(dt:number){
    if(!this.open)return;this.clock.step(dt);const v=this.rv;if(!v||!this.wood)return;this.fx.step(dt);this.pirate?.step(dt);
    const {g,W,H,s}=v,x=this.cx(),y=H*.84,now=this.clock.now,size=Math.min(W*.5,H*.34);g.setTransform(v.dpr,0,0,v.dpr,0,0);g.clearRect(0,0,W,H);
    // the beach at dusk
    const k=Math.max(W/1600,H/900)*1.06,ox=(W-1600*k)/2,oy=H-900*k;g.globalAlpha=1;g.drawImage(this.wood,ox,oy,1600*k,900*k);g.fillStyle='rgba(58,20,40,.62)';g.globalCompositeOperation='multiply';g.fillRect(0,0,W,H);g.globalCompositeOperation='source-over';
    const vg=g.createRadialGradient(x,H*.6,H*.15,x,H*.6,Math.max(W,H)*.75);vg.addColorStop(0,'rgba(20,6,24,.05)');vg.addColorStop(1,'rgba(6,4,16,.86)');g.fillStyle=vg;g.fillRect(0,0,W,H);
    rays(g,x,y-size*.4,Math.max(W,H)*.62,s.ray*.9,now);
    chest(g,this.wood,x,y+(1-s.boat)*H*.3,size,s.lid,1);
    this.fx.draw(g,W,H,now);
    if(this.pirate){this.pirate.draw();this.pirate.canvas.style.translate=`0 ${((1-s.up)*38).toFixed(1)}%`;}
  }
}
/** Every island has its own ink landmark: harbour flag, palms, volcano, lighthouse, falls, arch, skull rock, pyramid, fort, wreck, treasure. */
function landmark(g:CanvasRenderingContext2D,i:number,x:number,y:number,s:number){
  g.save();g.translate(x,y);g.scale(s/20,s/20);g.lineWidth=1.7;g.lineCap=g.lineJoin='round';g.strokeStyle='#4f3013';
  const P=(d:string,f?:string)=>{const p=new Path2D(d);if(f){g.fillStyle=f;g.fill(p);}g.stroke(p);};
  const palm=(px:number,py:number,k=1)=>{P(`M${px} ${py}q2 -6 1 -${12*k}`);g.strokeStyle='#45652a';for(const [a,b] of [[-9,1],[-7,-5],[0,-8],[7,-5],[9,1]])P(`M${px+1} ${py-12*k}q${a*.6} ${b-4} ${a} ${b+2}`);g.strokeStyle='#4f3013';};
  switch(i){
    case 0:P('M-12 10h22M-8 10V-2M4 10V-2','');P('M-12 -2h22','');P('M0 -2V-22');P('M0 -22l14 5l-14 5z','#b8291a');break;
    case 1:palm(-8,10,1.1);palm(2,12,1.4);palm(10,10,.9);break;
    case 2:P('M-18 12L-5 -12L-1 -9L4 -12L18 12z','#9a6f46');P('M-4 -10q3 6 -2 12M2 -9q0 8 5 12','');g.strokeStyle='#b8291a';P('M-1 -14q-4 -6 1 -10q4 -4 0 -9');break;
    case 3:P('M-6 12L-3 -14H5L8 12z','#f3e4c4');P('M-5 2h12M-4 -6h10','');P('M-5 -14h12l-2 -7h-8z','#c8923f');P('M-3 -21l4 -5l4 5z','#b8291a');g.strokeStyle='#c8923f';P('M10 -18l12 -4M10 -16l12 3');break;
    case 4:P('M-18 12V-8L-6 -18L8 -14L16 -2V12z','#8a8668');P('M-5 -16q-2 14 -3 28h8q1 -14 1 -27z','#bfe0e6');P('M-14 12q12 5 22 0');break;
    case 5:P('M-14 12V-10H-7V12M7 12V-10H14V12','');P('M-17 -10h34v-6h-34z','#d9c294');P('M-14 12V-10H-7V12z','#e6d4ac');P('M7 12V-10H14V12z','#e6d4ac');P('M-18 12h36');break;
    case 6:P('M-15 -2a15 14 0 0 1 30 0q0 7 -6 9v6h-18v-6q-6 -2 -6 -9z','#e8dcc2');g.fillStyle='#3a2413';for(const k of [-6,6]){g.beginPath();g.ellipse(k,-1,3.6,4.4,0,0,7);g.fill();}P('M0 4l-2 4h4z','#3a2413');P('M-4 13v-5M0 13v-4M4 13v-5');break;
    case 7:P('M-18 12h36l-5 -8h-26z','#cdb07a');P('M-13 4h26l-4 -7h-18z','#d8bf8e');P('M-9 -3h18l-3 -7h-12z','#e3cfa2');P('M-3 12v-8h6v8','');break;
    case 8:P('M-15 12V-6h5v-5h5v5h10v-5h5v5h5V12z','#cbb892');P('M-3 12v-8q3 -4 6 0v8','#3a2413');P('M0 -6V-22');P('M0 -22l11 4l-11 4z','#20140e');break;
    case 9:P('M-19 4q4 12 14 10h14q8 -3 10 -12z','#7a4f2a');P('M-4 6L-9 -20M6 4L10 -12');P('M-9 -19q12 4 10 14q-6 -2 -8 -1z','#eadcb8');P('M-14 8h26');break;
    default:P('M-15 12V0h26v12z','#8f5a2a');P('M-15 0q0 -10 8 -10h10q8 0 8 10z','#a56a33');P('M-15 4h26');P('M-5 -1h6v8h-6z','#e0a53f');g.strokeStyle='#b8291a';g.lineWidth=4;P('M13 -20l10 10M23 -20l-10 10');}
  g.restore();
}
