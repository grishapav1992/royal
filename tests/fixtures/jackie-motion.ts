import {JackieScene} from '../../games/jackie-chan/JackieScene';
import {JackieAudio} from '../../games/jackie-chan/JackieAudio';
import {Fight,RATE,contactAt,revealAt} from '../../games/jackie-chan/JackieFight';
import {JACKIE_RISKS,JACKIE_COLLECTION_MAX,type JackieCostume,type JackieLocation,type JackieView} from '../../src/shared/jackieChan';
import {penaltyPathQuote,type PenaltyRisk} from '../../src/shared/crLeo';
const canvas=document.querySelector('canvas')!,audio=new JackieAudio();audio.enabled=false;const scene=new JackieScene(canvas,audio);
type Config={costume?:JackieCostume;location?:JackieLocation;risk?:PenaltyRisk;status?:'playing'|'complete'|'lost'|'banked';time?:number;fight?:number;seriesId?:string;plan?:string};
function view(config:Config):JackieView{
  const risk=config.risk??'safe',status=config.status??'playing',count=(config.fight??(status==='complete'?4:0))+1;
  const shots=Array.from({length:count},(_,index)=>({index,goal:status!=='lost',finish:status==='lost'?'save' as const:'goal' as const,side:-1 as const,risk,zone:0}));
  return{version:2,costume:config.costume??'master',location:config.location??'restaurant',collectionUnits:JACKIE_COLLECTION_MAX,combat:{version:2,hero:'cr',risk,revision:count,status,shots,availableUnits:status==='lost'?'0':penaltyPathQuote('1000',shots.map(s=>s.risk))}};
}
const only=(config:Config)=>config.plan&&config.plan!=='auto'?config.plan:undefined;
function show(config:Config,animate=false){scene.show(view(config),animate,false,config.seriesId??'motion-preview',only(config));}
/** `time` is in display seconds at normal speed. */
function render(config:Config={}){audio.cancel();show(config);Reflect.get(scene,'playback').start(0);Reflect.set(scene,'key','');scene.paint((config.time??0)*1000/scene.state(0).speed);return{...canvas.dataset};}
let playing=false,config:Config={};
const control=(id:string)=>(document.getElementById(id)as HTMLInputElement).value;
(document.getElementById('time')as HTMLInputElement).max='12';
function inputs(){config={costume:control('costume')as JackieCostume,location:control('place')as JackieLocation,risk:control('risk')as PenaltyRisk,status:control('outcome')as Config['status'],plan:control('plan'),time:Number(control('time'))};document.getElementById('elapsed')!.textContent=config.time!.toFixed(2);return config;}
document.querySelectorAll('select,input').forEach(el=>el.addEventListener('input',()=>{playing=false;render(inputs());}));
document.querySelector('#play')!.addEventListener('click',async()=>{await audio.unlock();config=inputs();show(config,true);playing=true;});
document.querySelector('#sound')!.addEventListener('click',()=>{audio.toggle();document.querySelector('#sound')!.textContent=audio.enabled?'Звук ON':'Звук OFF';});
function moves(){const fight=Reflect.get(scene,'fight') as Fight;return{exchanges:fight.phrases().map(({id,d,duo,only,place,uses})=>({id,d,duo,only,place,uses})),finishers:fight.finishers().map(({id,place,prop})=>({id,place,prop}))};}
function tick(now:number){if(scene.loading.ready){
  if(playing){scene.paint(now);const elapsed=scene.state(now).elapsed;document.getElementById('elapsed')!.textContent=elapsed.toFixed(2);if(!scene.state(now).busy)playing=false;}
  else if(!canvas.dataset.phase){render({time:0});const list=moves();document.getElementById('plan')!.innerHTML='<option value="auto">Auto</option>'+[...list.exchanges,...list.finishers].map(m=>`<option value="${m.id}">${m.id}</option>`).join('');}
}requestAnimationFrame(tick);}requestAnimationFrame(tick);
window.addEventListener('pagehide',()=>{scene.destroy();audio.destroy();});
(window as any).jackieMotion={scene,audio,render,moves,times:{rate:RATE,contacts:[0,1,2].map(i=>contactAt(i)/RATE),reveal:[1,2,3].map(n=>revealAt(n)/RATE)},fight:(config:Config)=>{show(config);scene.state();return Reflect.get(scene,'fight');},
  restore(config:Config){show(config);Reflect.set(scene,'key','');scene.paint(performance.now());return{...canvas.dataset};},ready:()=>scene.loading.ready,contacts:Object.values(JACKIE_RISKS).map(r=>r.opponents)};
