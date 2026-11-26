import {Rig,type Emotion} from './rig';
import {RIGS} from './rigs';
import {Pirate,type Pose} from '../../../../games/caribbean-treasures/scene/pirate';
const $=<T extends HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const ACTS:[Emotion,string,Pose,string,number][]=[['idle','Покой','idle','',0],['focus','Смотрит на поле','focus','',2.4],['win','Выигрыш','win','win',2.2],['big','Крупный выигрыш','laugh','big',3],['surprise','Залп','surprise','cannon',1.4],['bonus','Бонус','bonus','win',2.4],['soft','Без выигрыша','soft','soft',2.2]];
const oldC=$<HTMLCanvasElement>('#old'),newC=$<HTMLCanvasElement>('#new');
const crops:Record<string,any>=(window as any).CROPS;
let rig:Rig|undefined,old=new Pirate(oldC),demo=true,demoAt=1.5,demoI=0;
function size(){const dpr=Math.min(2,devicePixelRatio||1);for(const c of [oldC,newC]){const w=c.clientWidth,h=w*1.5;c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}old.resize(oldC.clientWidth,oldC.clientWidth*1.5,dpr);}
async function pick(id:string){const r=new Rig(newC,{...RIGS[id],crops:crops[id]} as any,'rig/'+id+'/');await r.load();r.wind=+$<HTMLSelectElement>('#wind').value;rig=r;old=new Pirate(oldC);await old.select(id as any);size();}
function act(i:number){const [e,,pose,g,hold]=ACTS[i];rig?.react(e,hold);old.show(pose,hold);if(g)old.gesture(g as any);if(e==='surprise'){rig&&(rig.flash=1);old.flash=1;}
 document.querySelectorAll<HTMLButtonElement>('#acts button').forEach((b,k)=>b.setAttribute('aria-pressed',String(k===i)));}
$('#acts').innerHTML=ACTS.map(([,l],i)=>`<button data-i="${i}" aria-pressed="false">${l}</button>`).join('');
$('#acts').addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;demo=false;$('#demo').setAttribute('aria-pressed','false');act(+b.dataset.i!);});
$('#demo').onclick=()=>{demo=!demo;$('#demo').setAttribute('aria-pressed',String(demo));demoAt=.5;};
$<HTMLSelectElement>('#who').onchange=e=>void pick((e.target as HTMLSelectElement).value);
$<HTMLSelectElement>('#wind').onchange=e=>{const w=+(e.target as HTMLSelectElement).value;if(rig)rig.wind=w;old.wind=w*1.6;old.tint=w?[.7,.78,.88]:[1,1,1];if(rig)rig.tint=w?[.72,.8,.9]:[1,1,1];};
addEventListener('resize',size);
let last=performance.now();
function loop(t:number){requestAnimationFrame(loop);const dt=Math.min(.05,(t-last)/1000);last=t;
 if(demo){demoAt-=dt;if(demoAt<0){demoI=demoI%(ACTS.length-1)+1;act(demoI);demoAt=ACTS[demoI][4]+1.6;}}
 old.step(dt);old.draw();if(rig){rig.flash=Math.max(0,rig.flash-dt*2);rig.step(dt);rig.draw();}old.flash=Math.max(0,old.flash-dt*2);}
void pick('isabella').then(()=>requestAnimationFrame(loop));
(window as any).cv={get rig(){return rig;},act};
