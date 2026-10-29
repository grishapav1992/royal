import {JackieScene} from '../../games/jackie-chan/JackieScene';
import {JackieAudio} from '../../games/jackie-chan/JackieAudio';
import {JACKIE_RISKS,JACKIE_COLLECTION_MAX,type JackieCostume,type JackieLocation,type JackieView} from '../../src/shared/jackieChan';
import {penaltyPathQuote,type PenaltyRisk} from '../../src/shared/crLeo';
const canvas=document.querySelector('canvas')!,audio=new JackieAudio();audio.enabled=false;const scene=new JackieScene(canvas,audio);
type Config={costume?:JackieCostume;location?:JackieLocation;risk?:PenaltyRisk;status?:'playing'|'complete'|'lost';time?:number;fight?:number};
function view(config:Config):JackieView{
  const risk=config.risk??'safe',status=config.status??'playing',count=(config.fight??(status==='complete'?4:0))+1;
  const shots=Array.from({length:count},(_,index)=>({index,goal:status!=='lost',finish:status==='lost'?'save' as const:'goal' as const,side:-1 as const,risk,zone:0}));
  return{version:2,costume:config.costume??'master',location:config.location??'restaurant',collectionUnits:JACKIE_COLLECTION_MAX,combat:{version:2,hero:'cr',risk,revision:count,status,shots,availableUnits:status==='lost'?'0':penaltyPathQuote('1000',shots.map(s=>s.risk))}};
}
function render(config:Config={}){audio.cancel();scene.show(view(config),false);Reflect.set(scene,'started',0);Reflect.set(scene,'key','');scene.paint((config.time??0)*1000);return{...canvas.dataset};}
let playing=false,config:Config={},started=0;
const control=(id:string)=>(document.getElementById(id)as HTMLInputElement).value;
function inputs(){config={costume:control('costume')as JackieCostume,location:control('place')as JackieLocation,risk:control('risk')as PenaltyRisk,status:control('outcome')as Config['status'],time:Number(control('time'))};document.getElementById('elapsed')!.textContent=config.time!.toFixed(2);return config;}
document.querySelectorAll('select,input').forEach(el=>el.addEventListener('input',()=>{playing=false;render(inputs());}));
document.querySelector('#play')!.addEventListener('click',async()=>{await audio.unlock();config=inputs();scene.show(view(config),true);started=performance.now();playing=true;});
document.querySelector('#sound')!.addEventListener('click',()=>{audio.toggle();document.querySelector('#sound')!.textContent=audio.enabled?'Звук ON':'Звук OFF';});
function tick(now:number){if(scene.loading.ready){if(playing){scene.paint(now);const elapsed=scene.state(now).elapsed;document.getElementById('elapsed')!.textContent=elapsed.toFixed(2);if(!scene.state(now).busy)playing=false;}else if(!canvas.dataset.phase)render({time:0});}requestAnimationFrame(tick);}requestAnimationFrame(tick);
window.addEventListener('pagehide',()=>{scene.destroy();audio.destroy();});
(window as any).jackieMotion={scene,audio,render,restore(config:Config){scene.show(view(config),false);Reflect.set(scene,'key','');scene.paint(performance.now());return{...canvas.dataset};},ready:()=>scene.loading.ready,contacts:Object.values(JACKIE_RISKS).map(r=>r.opponents)};
