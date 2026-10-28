import { JACKIE_COSTUMES, JACKIE_LOCATIONS, JACKIE_RISKS, type JackieCostume, type JackieLocation, type JackieView } from '../../src/shared/jackieChan';
import type { PenaltyRisk } from '../../src/shared/crLeo';
import { contactAt, resultAt, JackieAudio } from './JackieAudio';
import { extractSpriteFrames } from '../../src/ui/crLeoSprites';

const urls = [...JACKIE_COSTUMES.map(c => `/assets/jackie-chan/${c.id}.webp`), '/assets/jackie-chan/foes.webp', '/assets/jackie-chan/props.webp', ...JACKIE_LOCATIONS.map(c => `/assets/jackie-chan/${c.id}.webp`)];
const cache = new Map<string, Promise<HTMLImageElement>>();
function load(url: string) {
  let request = cache.get(url);
  if (!request) { request = new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => { cache.delete(url); reject(Error('Artwork unavailable')); }; img.src = url; }); cache.set(url, request); }
  return request;
}
type Frame = {image:HTMLCanvasElement; x: number; y: number; w: number; h: number; anchor: number; baseline: number};
type Sheet = {image: HTMLImageElement; frames: Frame[]; height: number};
const sheets = new WeakMap<HTMLImageElement, Sheet>();
function prepare(image: HTMLImageElement): Sheet {
  const cached = sheets.get(image); if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', {willReadFrequently:true})!; ctx.drawImage(image,0,0);
  const cw=canvas.width/4;
  const frames=extractSpriteFrames(image,4,2,false).map(f=>({image:f.image,x:0,y:0,w:f.image.width,h:f.image.height,anchor:cw*(.5-f.x),baseline:f.image.height}));
  const result={image,frames,height:Math.max(...[0,2,3,4,6,7].map(i=>frames[i].h))}; sheets.set(image,result); return result;
}
const smooth = (n:number) => {const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};
export class JackieScene {
  readonly images = new Map<string,HTMLImageElement>();
  loading = {ready:false,failed:false,loaded:0,total:urls.length};
  costume: JackieCostume = 'master'; location: JackieLocation = 'restaurant'; risk: PenaltyRisk = 'safe';
  private view?: JackieView;
  private started = -Infinity;
  private duration = 0;
  private celebration = false;
  private dead = false;
  private key = '';
  private resize: ResizeObserver;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  constructor(private canvas:HTMLCanvasElement, private audio:JackieAudio) {
    this.resize = new ResizeObserver(()=>this.key='');this.resize.observe(canvas);void this.retry();
  }
  async retry() {
    if(this.dead)return;this.loading.failed=false;
    await Promise.all(urls.map(async url=>{if(this.images.has(url))return;try{const img=await load(url);if(this.dead)return;if(!url.includes('restaurant')&&!url.includes('harbor')&&!url.includes('market'))prepare(img);this.images.set(url,img);this.loading.loaded=this.images.size;}catch{if(!this.dead)this.loading.failed=true;}}));
    if(!this.dead){this.loading.ready=this.images.size===urls.length;this.key='';}
  }
  select(costume:JackieCostume,location:JackieLocation,risk:PenaltyRisk){this.costume=costume;this.location=location;this.risk=risk;this.view=undefined;this.started=-Infinity;this.key='';}
  chooseRisk(risk:PenaltyRisk){this.risk=risk;this.key='';}
  show(view:JackieView,animate:boolean,cashout=false){
    this.view=view;this.costume=view.costume;this.location=view.location;this.risk=view.combat.risk;this.celebration=cashout;
    const count=JACKIE_RISKS[this.risk].opponents,won=view.combat.shots.at(-1)!.goal;
    this.duration=cashout?1.05:resultAt(count)+(view.combat.status==='complete'?1.1:.48);
    if(animate&&!this.motion.matches){this.started=cashout?performance.now():this.audio.begin(count,won,view.combat.status==='complete');if(cashout)this.audio.cashout();}
    else {this.started=-Infinity;if(animate)this.audio.result(won,cashout||view.combat.status==='complete');}
    this.key='';
  }
  settle(){this.started=-Infinity;this.audio.cancel();this.key='';}
  state(now=performance.now()){
    const elapsed=Math.max(0,(now-this.started)/1000),count=JACKIE_RISKS[this.risk].opponents;
    return {elapsed,busy:elapsed<this.duration,reveal:this.celebration||elapsed>=resultAt(count),reduced:this.motion.matches};
  }
  paint(now:number){
    if(!this.loading.ready||this.dead)return;
    const state=this.state(now),w=this.canvas.clientWidth,h=this.canvas.clientHeight,dpr=Math.min(2,devicePixelRatio||1);
    const nextKey=state.busy||!this.view&&!this.motion.matches?String(Math.floor(now/40)):[w,h,this.costume,this.location,this.risk,this.view?.combat.revision].join(':');
    if(this.key===nextKey)return;this.key=nextKey;
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    const c=this.canvas.getContext('2d')!;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const bg=this.images.get(`/assets/jackie-chan/${this.location}.webp`)!;
    const scale=Math.max(w/bg.naturalWidth,h/bg.naturalHeight);c.drawImage(bg,(w-bg.naturalWidth*scale)/2,(h-bg.naturalHeight*scale)/2,bg.naturalWidth*scale,bg.naturalHeight*scale);
    const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#18130c55');shade.addColorStop(.45,'#18130c00');shade.addColorStop(1,'#140e0855');c.fillStyle=shade;c.fillRect(0,0,w,h);
    const count=JACKIE_RISKS[this.risk].opponents,combat=this.view?.combat,won=combat?.shots.at(-1)?.goal??false,ground=h*.91,heroH=Math.min(h*.58,w*.48);
    const sheet=prepare(this.images.get(`/assets/jackie-chan/${this.costume}.webp`)!);const foe=prepare(this.images.get('/assets/jackie-chan/foes.webp')!);
    const elapsed=state.elapsed,activeIndex=Math.max(0,Math.min(count-1,Math.floor((elapsed-.28)/.62))),local=elapsed-contactAt(activeIndex);
    let heroX=w*.28,pose=0,lift=0,rotation=0;
    const fighting=!!combat&&state.busy&&!this.celebration&&!state.reveal;
    if(fighting){
      heroX=w*(.28+.1*smooth((elapsed-.12)/.35));
      pose=local<-.29?0:local<-.13?(activeIndex%2?1:2):local<.12?(activeIndex%2?4:3):5;
      if(activeIndex%2&&local>-.14&&local<.24)lift=Math.sin(smooth((local+.14)/.38)*Math.PI)*h*.045;
    }else if(combat){pose=!won?6:combat.status==='complete'||combat.status==='banked'?7:0;heroX=w*.34;}
    else if(!this.motion.matches)lift=Math.sin(now/520)*h*.003;
    const draw=(s:Sheet,index:number,x:number,y:number,height:number,angle=0,alpha=1)=>{
      const f=s.frames[index],k=height/s.height;c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha=alpha;
      c.fillStyle='#1c110b50';c.beginPath();c.ellipse(0,0,height*.2,height*.035,0,0,Math.PI*2);c.fill();
      c.drawImage(f.image,f.x,f.y,f.w,f.h,-f.anchor*k,-f.baseline*k,f.w*k,f.h*k);c.restore();
    };
    const props=prepare(this.images.get('/assets/jackie-chan/props.webp')!),propIndex=this.location==='restaurant'?0:this.location==='harbor'?5:7;
    const moved=combat&&won?smooth((elapsed-contactAt(0))/.55):0;
    const propX=w*.48+w*.17*moved,propY=ground-(state.busy?Math.sin(moved*Math.PI)*h*.09:0);
    draw(props,this.location==='restaurant'&&moved===1?3:propIndex,propX,propY,heroH*(this.location==='restaurant'?.5:this.location==='harbor'?.42:.28),moved*(this.location==='restaurant'?.13:this.location==='harbor'?2.5:.5));
    if(fighting&&elapsed>contactAt(0)&&elapsed<contactAt(0)+.45){c.save();c.fillStyle='#d5b17a40';c.beginPath();c.ellipse(propX,ground,w*.04,h*.015,0,0,Math.PI*2);c.fill();c.restore();}
    for(let i=count-1;i>=0;i--){
      const ownLocal=elapsed-contactAt(i),defeated=!!combat&&won&&(state.reveal||ownLocal>=.1),engaged=fighting&&i===activeIndex;
      const initial=w*(.64+i*.12),approach=engaged?smooth((ownLocal+.4)/.3):0;
      let x=initial+(heroX+w*.12-initial)*approach,y=ground-h*.016*i,index=0,angle=0;
      if(defeated){index=ownLocal<.26&&state.busy?3:6;x=w*.5+(initial-w*.5)*smooth((ownLocal-.08)/.45);}
      else if(engaged){index=ownLocal<-.2?1:ownLocal<.1?7:won?2:1;}
      else if(combat&&!won&&state.reveal)index=i===count-1?0:7;
      if(fighting&&won&&ownLocal>=0&&ownLocal<.16){index=2;x+=Math.sin(ownLocal/.16*Math.PI)*w*.025;}
      draw(foe,index,x,y,heroH*(.94-i*.035),angle,1);
    }
    if(fighting&&!won&&activeIndex===count-1&&local>=0){pose=6;heroX-=smooth(local/.24)*w*.04;rotation=-.04;}
    draw(sheet,pose,heroX,ground-lift,heroH,rotation);
    if(fighting&&Math.abs(local)<.09){
      c.save();c.strokeStyle='#fbe3aa';c.lineWidth=2;c.globalAlpha=1-Math.abs(local)/.09;const x=heroX+w*.13,y=ground-heroH*.57;
      for(let j=0;j<5;j++){const a=j*1.26;c.beginPath();c.moveTo(x+Math.cos(a)*7,y+Math.sin(a)*7);c.lineTo(x+Math.cos(a)*18,y+Math.sin(a)*18);c.stroke();}c.restore();
    }
    this.canvas.dataset.opponents=String(count);this.canvas.dataset.pose=String(pose);this.canvas.dataset.reveal=String(state.reveal);
  }
  destroy(){this.dead=true;this.resize.disconnect();this.images.clear();this.audio.cancel();}
}
