import { JACKIE_COSTUMES, JACKIE_LOCATIONS, JACKIE_RISKS, type JackieCostume, type JackieLocation, type JackieView } from '../../src/shared/jackieChan';
import type { PenaltyRisk } from '../../src/shared/crLeo';
import { JackieAudio } from './JackieAudio';
import { choreography, contactAt, chairReleaseAt, resultAt, fighterX, ease, type Furniture } from './JackieChoreography';
import { extractSpriteFrames } from '../../src/ui/crLeoSprites';
import { language } from '../../src/i18n/index';
import { OPPONENTS, opponentLineup } from './JackieOpponents';

export const JACKIE_SCENE_ASSETS = [...JACKIE_COSTUMES.flatMap(c => [`/assets/jackie-chan/${c.id}.webp`, `/assets/jackie-chan/${c.id}-furniture.webp`]), ...Object.values(OPPONENTS).map(foe=>foe.asset), '/assets/jackie-chan/props.webp', ...JACKIE_LOCATIONS.map(c => `/assets/jackie-chan/${c.id}.webp`)];
const cache = new Map<string, Promise<HTMLImageElement>>();
function load(url:string) {
  let request=cache.get(url);
  if(!request){request=new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{cache.delete(url);reject(Error('Artwork unavailable'));};image.src=url;});cache.set(url,request);}
  return request;
}
type Frame={image:HTMLCanvasElement;anchor:number;baseline:number};
type Sheet={frames:Frame[];height:number};
const sheets=new WeakMap<HTMLImageElement,Sheet>();
function prepare(image:HTMLImageElement,furniture=false):Sheet {
  const cached=sheets.get(image);if(cached)return cached;
  const cw=image.naturalWidth/4;
  const frames=extractSpriteFrames(image,4,2,false,undefined,furniture?2:1).map(f=>({image:f.image,anchor:cw*((furniture?.4:.5)-f.x),baseline:f.image.height}));
  const height=Math.max(...(furniture?[1,2,3,7]:[0,2,3,4,6,7]).map(i=>frames[i].image.height));
  const sheet={frames,height};sheets.set(image,sheet);return sheet;
}
export class JackieScene {
  readonly images=new Map<string,HTMLImageElement>();
  loading={ready:false,failed:false,loaded:0,total:JACKIE_SCENE_ASSETS.length};
  costume:JackieCostume='master';location:JackieLocation='restaurant';risk:PenaltyRisk='safe';
  private view?:JackieView;
  private started=-Infinity;
  private cashout=false;
  private dead=false;
  private key='';
  private resize:ResizeObserver;
  private motion=matchMedia('(prefers-reduced-motion: reduce)');
  constructor(private canvas:HTMLCanvasElement,private audio:JackieAudio){this.resize=new ResizeObserver(()=>this.key='');this.resize.observe(canvas);void this.retry();}
  async retry(){
    if(this.dead)return;this.loading.failed=false;
    await Promise.all(JACKIE_SCENE_ASSETS.map(async url=>{
      if(this.images.has(url))return;
      try{const image=await load(url);if(this.dead)return;if(!JACKIE_LOCATIONS.some(l=>url.endsWith('/'+l.id+'.webp')))prepare(image,url.includes('-furniture'));this.images.set(url,image);this.loading.loaded=this.images.size;}
      catch{if(!this.dead)this.loading.failed=true;}
    }));
    if(!this.dead){this.loading.ready=this.images.size===JACKIE_SCENE_ASSETS.length;this.key='';}
  }
  select(costume:JackieCostume,location:JackieLocation,risk:PenaltyRisk){this.costume=costume;this.location=location;this.risk=risk;this.view=undefined;this.started=-Infinity;this.cashout=false;this.key='';}
  chooseRisk(risk:PenaltyRisk){this.risk=risk;this.key='';}
  show(view:JackieView,animate:boolean,cashout=false){
    this.view=view;this.costume=view.costume;this.location=view.location;this.risk=view.combat.risk;this.cashout=cashout;
    const count=JACKIE_RISKS[this.risk].opponents,won=view.combat.shots.at(-1)!.goal;
    if(animate&&!this.motion.matches){this.started=cashout?performance.now():this.audio.begin(count,won,view.combat.status==='complete');if(cashout)this.audio.cashout();}
    else{this.started=-Infinity;if(animate)this.audio.result(won,cashout||view.combat.status==='complete');}
    this.key='';
  }
  settle(){this.started=-Infinity;this.audio.cancel();this.key='';}
  state(now=performance.now()){
    const elapsed=Math.max(0,(now-this.started)/1000),count=JACKIE_RISKS[this.risk].opponents;
    return {elapsed,...choreography(elapsed,count,this.view?.combat.status??'idle',this.cashout),reduced:this.motion.matches};
  }
  paint(now:number){
    if(!this.loading.ready||this.dead)return;
    const state=this.state(now),w=this.canvas.clientWidth,h=this.canvas.clientHeight,dpr=Math.min(2,devicePixelRatio||1);
    const nextKey=state.busy||!this.view&&!this.motion.matches?String(Math.floor(now/33)):[w,h,this.costume,this.location,this.risk,this.view?.combat.revision].join(':');
    if(this.key===nextKey)return;this.key=nextKey;
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    const c=this.canvas.getContext('2d')!;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const background=this.images.get(`/assets/jackie-chan/${this.location}.webp`)!;
    const scale=Math.max(w/background.naturalWidth,h/background.naturalHeight);c.drawImage(background,(w-background.naturalWidth*scale)/2,(h-background.naturalHeight*scale)/2,background.naturalWidth*scale,background.naturalHeight*scale);
    const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#18130c55');shade.addColorStop(.45,'#18130c00');shade.addColorStop(1,'#140e0855');c.fillStyle=shade;c.fillRect(0,0,w,h);
    const count=JACKIE_RISKS[this.risk].opponents,combat=this.view?.combat,won=combat?.shots.at(-1)?.goal??false,ground=h*.91,heroH=Math.min(h*.58,w*.40);
    const complete=combat?.status==='complete',fighting=!!combat&&!state.reveal;
    const wideVictory=!!complete&&state.reveal&&w>600;
    const heroX=w*(state.x+(wideVictory?.14*ease(state.victory/.12):0)),heroY=ground-h*state.lift+(complete&&state.reveal?h*.04:0);
    if(complete&&state.reveal){
      const glow=c.createRadialGradient(heroX,ground-heroH*.6,0,heroX,ground-heroH*.6,heroH*1.3);glow.addColorStop(0,state.celebrating?'#f9cf6970':'#f9cf692a');glow.addColorStop(1,'#eac26900');c.fillStyle=glow;c.fillRect(0,0,w,h);
      c.strokeStyle='#e9bd6770';c.lineWidth=2;c.strokeRect(8,8,w-16,h-16);
    }
    const draw=(sheet:Sheet,index:number,x:number,y:number,height:number,angle=0,ownHeight=false,shadow=true)=>{
      const f=sheet.frames[index],k=height/(ownHeight?f.image.height:sheet.height);c.save();c.translate(x,y);c.rotate(angle);
      if(shadow){c.fillStyle='#1c110b50';c.beginPath();c.ellipse(0,0,height*.2,height*.035,0,0,Math.PI*2);c.fill();}
      c.drawImage(f.image,-f.anchor*k,-f.baseline*k,f.image.width*k,f.image.height*k);c.restore();
    };
    const props=prepare(this.images.get('/assets/jackie-chan/props.webp')!);
    const floor:Furniture[]=[];
    // Each linked action already contains its own item. Never paint a second item at the grip.
    if(count>=3&&state.furniture!=='stool'){draw(props,1,w*fighterX(2)+heroH*.2,ground,heroH*.28,0,true);floor.push('stool');}
    if(count>=2&&state.furniture!=='table'){draw(props,2,w*fighterX(1)+heroH*.14,ground,heroH*.34,0,true);floor.push('table');}
    if(state.furniture!=='chair'){
      const released=!!combat&&state.elapsed>=chairReleaseAt();
      draw(props,0,w*(fighterX(0)-(released?.08:0))+heroH*.36,ground,heroH*.55,0,true);floor.push('chair');
    }
    const lineup=opponentLineup(this.location,Math.max(0,(combat?.shots.length??1)-1),count);
    const foeFrames:Array<{id:string;pose:number;left:number;right:number;top:number;bottom:number}>=[];
    const reach=(i:number)=>heroH*(i===0?.57:i===1?.68:.64);
    for(let i=count-1;i>=0;i--){
      const opponent=lineup[i];
      const local=state.elapsed-contactAt(i),defeated=!!combat&&(won||i<count-1)&&(state.reveal||local>=.13),engaged=fighting&&i===state.fighter;
      const initial=w*(.64+i*.1),target=w* fighterX(i)+reach(i),approach=engaged?ease((local+.4)/.32):0;
      const backY=ground-h*.075*i;
      let x=initial+(target-initial)*approach,y=backY+(ground-backY)*approach,pose=0,angle=0;
      if(defeated){const retreat=ease((local-.13)/.46);pose=local<.36&&state.busy?3:6;x=target+(initial-target)*retreat;y=ground+(backY-ground)*retreat;if(local<.36&&state.busy)y-=Math.sin(ease((local-.13)/.23)*Math.PI)*h*.025;}
      else if(engaged)pose=local<-.34?0:local<-.06?opponent.attack:local<.15?opponent.guard:won||i<count-1?2:opponent.attack;
      else if(combat&&!won&&state.reveal)pose=7;
      if(engaged&&local>=0&&local<.13&&(won||i<count-1)){pose=2;x+=Math.sin(local/.13*Math.PI)*w*.012;}
      if(wideVictory)x+=(w*(.22+i*.13)-x)*ease(state.victory/.2);
      const foe=prepare(this.images.get(opponent.asset)!),height=heroH*(.94-i*.03)*opponent.scale;
      const frame=foe.frames[pose],k=height/foe.height,left=frame.anchor*k,right=(frame.image.width-frame.anchor)*k;
      x=Math.max(6+left,Math.min(w-6-right,x));
      draw(foe,pose,x,y,height,angle);
      foeFrames.push({id:opponent.id,pose,left:x-left,right:x+right,top:y-frame.image.height*k,bottom:y});
    }
    const sheet=prepare(this.images.get(`/assets/jackie-chan/${this.costume}${state.atlas==='furniture'?'-furniture':''}.webp`)!,state.atlas==='furniture');
    draw(sheet,state.pose,heroX,heroY,heroH,state.angle);
    const contactLocal=state.elapsed-contactAt(state.fighter);
    if(fighting&&Math.abs(contactLocal)<.09){
      const x=heroX+reach(state.fighter),y=ground-heroH*.58;c.save();c.strokeStyle='#fbe3aa';c.lineWidth=2;c.globalAlpha=1-Math.abs(contactLocal)/.09;
      for(let j=0;j<5;j++){const angle=j*1.26;c.beginPath();c.moveTo(x+Math.cos(angle)*7,y+Math.sin(angle)*7);c.lineTo(x+Math.cos(angle)*17,y+Math.sin(angle)*17);c.stroke();}c.restore();
    }
    if(state.celebrating&&!this.motion.matches){
      const t=state.elapsed-resultAt(count),fade=Math.min(1,t/.25,(2.65-t)/.4);c.save();c.globalAlpha=Math.max(0,fade)*.8;
      for(let i=0;i<18;i++){const x=w*(.08+(i*.173)% .84)+Math.sin(t*1.8+i)*9,y=h*((.04+i*.037+t*.17)% .76);c.save();c.translate(x,y);c.rotate(t+i*.7);c.fillStyle=i%3===0?'#aa3e2e':'#e8bb6b';c.fillRect(-2,-3,4,6);c.restore();}c.restore();
    }
    Object.assign(this.canvas.dataset,{opponents:String(count),foes:lineup.map(foe=>foe.id).join(','),foeFrames:JSON.stringify(foeFrames),pose:String(state.pose),atlas:state.atlas,phase:state.phase,heldFurniture:state.furniture??'',floorFurniture:floor.join(','),reveal:String(state.reveal),celebrating:String(state.celebrating),sceneCostume:this.costume,sceneLocation:this.location});
    this.canvas.setAttribute('aria-label',(language==='en'?'Illustrated kung fu fight scene. Opponents: ':'Рисованная сцена кунг-фу. Противники: ')+lineup.map(foe=>language==='en'?foe.en:foe.ru).join(', '));
  }
  destroy(){this.dead=true;this.resize.disconnect();this.images.clear();this.audio.cancel();}
}
