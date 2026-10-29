import { JACKIE_COSTUMES, JACKIE_LOCATIONS, JACKIE_RISKS, type JackieCostume, type JackieLocation, type JackieView } from '../../src/shared/jackieChan';
import type { PenaltyRisk } from '../../src/shared/crLeo';
import { JackieAudio } from './JackieAudio';
import { choreography, contactAt, chairReleaseAt, resultAt, fighterX, ease, impacts } from './JackieChoreography';
import {FIGHT_PLANS,fightPlan,moveFurniture,moveReach,type Furniture,type FightPlan} from './JackieFightPlans';
import { extractSpriteFrames } from '../../src/ui/crLeoSprites';
import { language } from '../../src/i18n/index';
import { OPPONENTS, opponentLineup } from './JackieOpponents';
import { JackiePlayback, type FightSpeed } from './JackiePlayback';

export const JACKIE_SCENE_ASSETS = [...JACKIE_COSTUMES.flatMap(c => [`/assets/jackie-chan/${c.id}.webp`, `/assets/jackie-chan/${c.id}-furniture.webp`, `/assets/jackie-chan/${c.id}-combat.webp`]), ...Object.values(OPPONENTS).map(foe=>foe.asset), '/assets/jackie-chan/props.webp', ...JACKIE_LOCATIONS.map(c => `/assets/jackie-chan/${c.id}.webp`)];
const cache = new Map<string, Promise<HTMLImageElement>>();
function load(url:string) {
  let request=cache.get(url);
  if(!request){request=new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{cache.delete(url);reject(Error('Artwork unavailable'));};image.src=url;});cache.set(url,request);}
  return request;
}
type Frame={image:HTMLCanvasElement;anchor:number;baseline:number};
type Sheet={frames:Frame[];height:number};
const sheets=new WeakMap<HTMLImageElement,Sheet>();
function prepare(image:HTMLImageElement,furniture=false,combat=false):Sheet {
  const cached=sheets.get(image);if(cached)return cached;
  const cw=image.naturalWidth/4;
  const frames=extractSpriteFrames(image,4,2,false,undefined,furniture?2:1).map(f=>({image:f.image,anchor:cw*((furniture?.4:.5)-f.x),baseline:f.image.height}));
  const height=Math.max(...(combat?[0,1,4,5,6]:furniture?[1,2,3,7]:[0,2,3,4,6,7]).map(i=>frames[i].image.height));
  const sheet={frames,height};sheets.set(image,sheet);return sheet;
}
export class JackieScene {
  readonly images=new Map<string,HTMLImageElement>();
  loading={ready:false,failed:false,loaded:0,total:JACKIE_SCENE_ASSETS.length};
  costume:JackieCostume='master';location:JackieLocation='restaurant';risk:PenaltyRisk='safe';
  private view?:JackieView;
  private plan:FightPlan=FIGHT_PLANS[0];
  private playback=new JackiePlayback();
  private cashout=false;
  private dead=false;
  private key='';
  private resize:ResizeObserver;
  private motion=matchMedia('(prefers-reduced-motion: reduce)');
  private onMotion=()=>{if(this.motion.matches)this.settle();this.key='';};
  constructor(private canvas:HTMLCanvasElement,private audio:JackieAudio){this.resize=new ResizeObserver(()=>this.key='');this.resize.observe(canvas);this.motion.addEventListener('change',this.onMotion);void this.retry();}
  async retry(){
    if(this.dead)return;this.loading.failed=false;
    await Promise.all(JACKIE_SCENE_ASSETS.map(async url=>{
      if(this.images.has(url))return;
      try{const image=await load(url);if(this.dead)return;if(!JACKIE_LOCATIONS.some(l=>url.endsWith('/'+l.id+'.webp')))prepare(image,url.includes('-furniture'),url.includes('-combat'));this.images.set(url,image);this.loading.loaded=this.images.size;}
      catch{if(!this.dead)this.loading.failed=true;}
    }));
    if(!this.dead){this.loading.ready=this.images.size===JACKIE_SCENE_ASSETS.length;this.key='';}
  }
  select(costume:JackieCostume,location:JackieLocation,risk:PenaltyRisk){this.costume=costume;this.location=location;this.risk=risk;this.view=undefined;this.plan=FIGHT_PLANS[0];this.playback.settle();this.cashout=false;this.key='';}
  chooseRisk(risk:PenaltyRisk){this.risk=risk;this.key='';}
  show(view:JackieView,animate:boolean,cashout=false,seriesId='preview',plan?:FightPlan){
    this.view=view;this.costume=view.costume;this.location=view.location;this.risk=view.combat.risk;this.cashout=cashout;
    this.plan=plan??fightPlan(seriesId,Math.max(0,view.combat.shots.length-1),view.location);
    const count=JACKIE_RISKS[this.risk].opponents,won=view.combat.shots.at(-1)!.goal;
    if(animate&&!this.motion.matches){this.playback.start(cashout?performance.now():this.audio.begin(count,won,view.combat.status==='complete',this.plan,this.playback.speed));if(cashout)this.audio.cashout();}
    else{this.playback.settle();if(animate)this.audio.result(won,cashout||view.combat.status==='complete');}
    this.key='';
  }
  setSpeed(speed:FightSpeed){
    const now=performance.now(),state=this.state(now);this.playback.setSpeed(speed,now);this.audio.cancel();
    if(this.view&&state.busy&&!this.cashout&&!this.motion.matches&&!document.hidden){
      const count=JACKIE_RISKS[this.risk].opponents,won=this.view.combat.shots.at(-1)!.goal;
      const anchor=this.audio.begin(count,won,this.view.combat.status==='complete',this.plan,speed,state.elapsed);
      this.playback.start(anchor,state.elapsed);
    }
    this.key='';
  }
  settle(){this.playback.settle();this.audio.cancel();this.key='';}
  state(now=performance.now()){
    if(this.motion.matches&&Number.isFinite(this.playback.elapsed(now)))this.settle();
    const elapsed=this.playback.elapsed(now),count=JACKIE_RISKS[this.risk].opponents;
    return {elapsed,...choreography(elapsed,count,this.view?.combat.status??'idle',this.cashout,this.plan),sequence:this.plan.id,moveSequence:this.plan.moves.join(','),speed:this.playback.speed,reduced:this.motion.matches};
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
    // The selected routine owns its props. Linked poses already contain the held item.
    for(let i=count-1;i>=0;i--){
      const item=moveFurniture(this.plan.moves[i]);if(!item||state.furniture===item)continue;
      const released=item==='chair'&&!!combat&&state.elapsed>=chairReleaseAt(i);
      const x=w*(fighterX(i)-(released?.08:0));
      if(item==='chair')draw(props,0,x+heroH*.36,ground,heroH*.55,0,true);
      else if(item==='table')draw(props,2,x+heroH*.14,ground,heroH*.34,0,true);
      else draw(props,1,x+heroH*.2,ground,heroH*.28,0,true);
      floor.push(item);
    }
    const lineup=opponentLineup(this.location,Math.max(0,(combat?.shots.length??1)-1),count);
    const foeFrames:Array<{id:string;pose:number;left:number;right:number;top:number;bottom:number}>=[];
    const reach=(i:number)=>heroH*moveReach(this.plan.moves[i]);
    for(let i=count-1;i>=0;i--){
      const opponent=lineup[i];
      const local=state.elapsed-contactAt(i),defeated=!!combat&&(won||i<count-1)&&(state.reveal||local>=.13),engaged=fighting&&i===state.fighter;
      const exchangeReach=this.plan.moves[i]==='chair'?reach(i):heroH*.4+(reach(i)-heroH*.4)*ease((local+.5)/.32);
      const initial=w*(.64+i*.1),target=w* fighterX(i)+exchangeReach,approach=engaged?ease((local+1.82)/.3):0;
      const backY=ground-h*.075*i;
      let x=initial+(target-initial)*approach,y=backY+(ground-backY)*approach,pose=0,angle=0;
      if(defeated){const retreat=ease((local-.13)/.46);pose=local<.36&&state.busy?3:6;x=target+(initial-target)*retreat;y=ground+(backY-ground)*retreat;if(local<.36&&state.busy)y-=Math.sin(ease((local-.13)/.23)*Math.PI)*h*.025;}
      else if(engaged)pose=local<-.34?0:local<-.06?opponent.attack:local<.15?opponent.guard:won||i<count-1?2:opponent.attack;
      if(engaged&&!won&&i===count-1)pose=local<-.34?0:local<-.18?opponent.guard:local<.16?opponent.attack:opponent.guard;
      if(engaged&&this.plan.moves[i]==='combo'&&local>=-.34&&local<-.17)pose=opponent.guard;
      else if(combat&&!won&&state.reveal)pose=7;
      if(engaged&&local<-.3){
        const exchange=impacts(this.plan,count).find(event=>event.fighter===i&&Math.abs(state.elapsed-event.at)<.16);
        pose=exchange?(exchange.actor==='foe'?opponent.attack:exchange.kind==='block'?opponent.guard:2):opponent.guard;
        if(exchange?.actor==='hero')x+=Math.sin(ease((state.elapsed-exchange.at+.16)/.32)*Math.PI)*w*.012;
      }
      if(engaged&&local>=0&&local<.13&&(won||i<count-1)){pose=2;x+=Math.sin(local/.13*Math.PI)*w*.012;}
      if(wideVictory)x+=(w*(.22+i*.13)-x)*ease(state.victory/.2);
      const foe=prepare(this.images.get(opponent.asset)!),height=heroH*(.94-i*.03)*opponent.scale;
      const frame=foe.frames[pose],k=height/foe.height,left=frame.anchor*k,right=(frame.image.width-frame.anchor)*k;
      x=Math.max(6+left,Math.min(w-6-right,x));
      draw(foe,pose,x,y,height,angle);
      foeFrames.push({id:opponent.id,pose,left:x-left,right:x+right,top:y-frame.image.height*k,bottom:y});
    }
    const sheet=prepare(this.images.get(`/assets/jackie-chan/${this.costume}${state.atlas==='base'?'':'-'+state.atlas}.webp`)!,state.atlas==='furniture',state.atlas==='combat');
    draw(sheet,state.pose,heroX,heroY,heroH,state.angle);
    const hero=sheet.frames[state.pose],heroScale=heroH/sheet.height;
    const corners=[[-hero.anchor,-hero.baseline],[hero.image.width-hero.anchor,-hero.baseline],[-hero.anchor,0],[hero.image.width-hero.anchor,0]].map(([x,y])=>({x:heroX+(x*Math.cos(state.angle)-y*Math.sin(state.angle))*heroScale,y:heroY+(x*Math.sin(state.angle)+y*Math.cos(state.angle))*heroScale}));
    const heroFrame={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
    for(const impact of impacts(this.plan,count)){
      const contactLocal=state.elapsed-impact.at;if(!fighting||impact.kind==='whoosh'||Math.abs(contactLocal)>=.09)continue;
      const x=heroX+(impact.actor==='foe'?heroH*.2:impact.primary?reach(impact.fighter):heroH*.4),y=ground-heroH*(impact.primary&&state.move==='sweep'?.22:impact.kind==='kick'?.67:.58);c.save();c.strokeStyle=impact.primary?'#fbe3aa':'#b9b5a5';c.lineWidth=2;c.globalAlpha=1-Math.abs(contactLocal)/.09;
      const rays=impact.primary?5:3,radius=impact.primary?17:11;
      for(let j=0;j<rays;j++){const angle=j*Math.PI*2/rays;c.beginPath();c.moveTo(x+Math.cos(angle)*7,y+Math.sin(angle)*7);c.lineTo(x+Math.cos(angle)*radius,y+Math.sin(angle)*radius);c.stroke();}c.restore();
    }
    const strikeLocal=state.elapsed-contactAt(state.fighter);
    if(fighting&&!this.motion.matches&&strikeLocal>=-.15&&strikeLocal<.26){
      const t=ease((strikeLocal+.15)/.41);c.save();c.globalAlpha=Math.sin(t*Math.PI)*.45;c.strokeStyle='#ead2a0';c.lineWidth=2;
      c.beginPath();c.ellipse(heroX+heroH*.25,heroY-heroH*.45,heroH*.45,heroH*.22,-.35,-1.2+t*.6,.1+t*.6);c.stroke();
      c.fillStyle='#bc977060';for(let i=0;i<6;i++)c.fillRect(heroX+(i-2.5)*heroH*.055*(1+t),ground-Math.sin(t*Math.PI)*(i%3+1)*3,3+i%2,2);c.restore();
    }
    if(state.celebrating&&!this.motion.matches){
      const t=state.elapsed-resultAt(count),fade=Math.min(1,t/.25,(2.65-t)/.4);c.save();c.globalAlpha=Math.max(0,fade)*.8;
      for(let i=0;i<18;i++){const x=w*(.08+(i*.173)% .84)+Math.sin(t*1.8+i)*9,y=h*((.04+i*.037+t*.17)% .76);c.save();c.translate(x,y);c.rotate(t+i*.7);c.fillStyle=i%3===0?'#aa3e2e':'#e8bb6b';c.fillRect(-2,-3,4,6);c.restore();}c.restore();
    }
    Object.assign(this.canvas.dataset,{opponents:String(count),foes:lineup.map(foe=>foe.id).join(','),foeFrames:JSON.stringify(foeFrames),heroFrame:JSON.stringify(heroFrame),playbackSpeed:String(state.speed),sequence:this.plan.id,move:state.move,moveSequence:state.moveSequence,pose:String(state.pose),atlas:state.atlas,phase:state.phase,heldFurniture:state.furniture??'',floorFurniture:floor.join(','),reveal:String(state.reveal),celebrating:String(state.celebrating),sceneCostume:this.costume,sceneLocation:this.location});
    this.canvas.setAttribute('aria-label',(language==='en'?'Illustrated kung fu fight scene. Opponents: ':'Рисованная сцена кунг-фу. Противники: ')+lineup.map(foe=>language==='en'?foe.en:foe.ru).join(', '));
  }
  destroy(){this.dead=true;this.resize.disconnect();this.motion.removeEventListener('change',this.onMotion);this.images.clear();this.audio.cancel();}
}
