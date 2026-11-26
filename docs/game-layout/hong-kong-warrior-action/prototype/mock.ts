import {Scene} from './scene';
import {Sound} from './sound';
import {contactAt,RATE} from './fight';
import type {Costume,Location} from './art';
import {opponentLineup,OPPONENTS} from '../../../../games/jackie-chan/JackieOpponents';
import {JACKIE_COSTUMES,JACKIE_LOCATIONS} from '../../../../src/shared/jackieChan';
import {penaltyPathQuote,type PenaltyRisk} from '../../../../src/shared/crLeo';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const RISK={safe:{n:1,p:75,ru:'Лёгкий',o:'1 противник'},sharp:{n:2,p:60,ru:'Средний',o:'2 противника'},extreme:{n:3,p:45,ru:'Сложный',o:'3 противника'}} as const;
const money=(n:number)=>n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const scene=new Scene($<HTMLCanvasElement>('#scene')),sound=new Sound();
scene.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let risk:PenaltyRisk='safe',costume:Costume='master',place:Location='restaurant',stake=10,balance=100000;
let shots:{risk:PenaltyRisk;won:boolean}[]=[],state:'idle'|'wait'|'fight'|'won'|'lost'|'complete'|'paid'='idle',seed='m'+Math.floor(Math.random()*1e9),paid=0,credited=true,reel='';
const quote=(path:PenaltyRisk[],units=stake)=>Number(penaltyPathQuote(String(units),path));
const active=()=>state==='won';
const count=()=>RISK[risk].n;
const setup=(fightIndex:number,status:'playing'|'complete'|'lost')=>({costume,location:place,lineup:opponentLineup(place,fightIndex,count()).map(x=>x.id),seed,fightIndex,status});
async function preview(){if(state==='fight'||state==='wait')return;if(state==='won'||state==='idle'||state==='paid'||state==='lost'||state==='complete'){if(state!=='won'){shots=[];state='idle';seed='m'+Math.floor(Math.random()*1e9);await scene.show(setup(0,'playing'));}}render();}
async function fight(){
  if(state==='fight'||state==='wait')return;reel='';
  if(!active()){if(balance<stake)return;balance-=stake;shots=[];seed='m'+Math.floor(Math.random()*1e9);await scene.show(setup(0,'playing'));}
  state='wait';credited=false;clap(false);render();
  await new Promise(r=>setTimeout(r,320));
  const mode=$<HTMLSelectElement>('#outcome').value,won=mode==='win'||mode==='random'&&Math.random()*100<RISK[risk].p;
  shots.push({risk,won});const n=shots.length,status=!won?'lost':n===5?'complete':'playing';
  state='fight';clap(true);await scene.play(setup(n-1,status));sound.schedule(scene.fight!.cues,scene.speed*RATE);render();
}
function reveal(){
  const last=shots.at(-1)!;
  if(!last.won)state='lost';else if(shots.length===5){state='complete';paid=quote(shots.map(s=>s.risk));balance+=paid;}else state='won';
  credited=true;render();
}
function cashout(){if(!active()||scene.busy)return;paid=quote(shots.map(s=>s.risk));balance+=paid;state='paid';render();}
function clap(shut:boolean){const c=$('#clap');c.className='clap '+(shut?'shut':'open');$('#clap-take').textContent=String((shut?shots.length:shots.length+1));if(shut)setTimeout(()=>{if(c.classList.contains('shut'))c.className='clap';},620);}
function render(){
  const busy=state==='wait'||state==='fight'||scene.busy&&state!=='idle';
  document.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b=>{const r=b.dataset.risk as PenaltyRisk;b.setAttribute('aria-pressed',String(r===risk));b.disabled=busy;b.querySelector('em')!.textContent='×'+(100/RISK[r].p).toFixed(2).replace('.',',');});
  const done=(state==='fight'?shots.slice(0,-1):shots),passed=done.filter(s=>s.won).map(s=>s.risk);
  $('#film').innerHTML=Array.from({length:5},(_,i)=>{const path=passed.slice(0,i+1);while(path.length<i+1)path.push(risk);const lost=done[i]&&!done[i].won,won=done[i]?.won,now=state==='fight'&&i===shots.length-1||!done[i]&&i===done.length&&state!=='lost'&&state!=='paid';
    const q=quote(path,1000000)/1000000;return `<li class="${won?'won':lost?'lost':now?'now':''}"><small>ДУБЛЬ ${i+1}${won?' ✓':lost?' ×':''}</small><b>×${q.toFixed(2).replace('.',',')}</b><span>${money(quote(path)/100)} USDT</span></li>`;}).join('');
  const go=$<HTMLButtonElement>('#go');go.disabled=busy;go.firstElementChild!.textContent=busy?'ИДЁТ СЪЁМКА':active()?'СЛЕДУЮЩИЙ БОЙ':state==='idle'?'МОТОР!':'НОВЫЙ ДУБЛЬ';
  $('#go small').textContent=busy?'':active()?'бесплатно':`ставка ${money(stake/100)} USDT`;
  const cash=$<HTMLButtonElement>('#cash');cash.hidden=!active();cash.disabled=busy;$('#cash b').textContent=active()?money(quote(passed)/100)+' USDT':'';
  $('.actions').classList.toggle('two',active());
  $('#balance').textContent=money(balance/100);
  const sel=$<HTMLSelectElement>('#stake');sel.disabled=busy||active();
  const r=$('#result'),show=!reel&&['won','lost','complete','paid'].includes(state);r.hidden=!show;r.dataset.kind=state;
  if(show){$('#r-cap').textContent=state==='complete'?'ВСЕ ПЯТЬ БОЁВ ПРОЙДЕНЫ':state==='won'?`${passed.length} ИЗ 5 · ГРУППА ПОБЕЖДЕНА`:'СЕРИЯ ЗАВЕРШЕНА';$('#r-title').textContent=state==='lost'?'ПЕРЕСНИМЕМ?':state==='paid'?'ОТЛИЧНЫЙ ДУБЛЬ':'ПОБЕДА!';$('#r-money').textContent=state==='won'?`Можно забрать ${money(quote(passed)/100)} USDT`:state==='lost'?'Выплата 0,00 USDT':`Выплата ${money(paid/100)} USDT`;}
  const li=JACKIE_LOCATIONS.findIndex(l=>l.id===place);$('#place-no').textContent='СЦЕНА 0'+(li+1);$('#place-name').textContent=JACKIE_LOCATIONS[li].name;
  $('#film-name').textContent=JACKIE_COSTUMES.find(c=>c.id===costume)!.film;
  $('#foes').textContent=opponentLineup(place,active()?shots.length:Math.max(0,state==='fight'?shots.length-1:0),count()).map(f=>OPPONENTS[f.id].ru).join(' · ');
  $('#speed').textContent=scene.speed+'×';$('#sound').setAttribute('aria-pressed',String(sound.enabled));$('#sound').innerHTML=sound.enabled?'♪ <i>Звук</i>':'<s>♪</s> <i>Без звука</i>';$('#sound').setAttribute('aria-label',sound.enabled?'Звук включён':'Звук выключен');$('#versus-cap').textContent=active()?'СЛЕДУЮЩАЯ ГРУППА':'ПРОТИВНИКИ';
  ($('#place') as HTMLButtonElement).disabled=busy||active();($('#wardrobe') as HTMLButtonElement).disabled=busy||active();
}
document.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b=>b.onclick=()=>{risk=b.dataset.risk as PenaltyRisk;void preview();render();});
$('#go').onclick=()=>void fight();$('#cash').onclick=cashout;
$<HTMLSelectElement>('#stake').onchange=e=>{stake=Number((e.target as HTMLSelectElement).value);render();};
$('#speed').onclick=()=>{const t=scene.elapsed();scene.setSpeed(scene.speed===1?2:1);if(scene.busy)sound.schedule(scene.fight!.cues,scene.speed*RATE,t);render();};
$('#sound').onclick=async()=>{await sound.toggle();if(sound.enabled&&scene.busy)sound.schedule(scene.fight!.cues,scene.speed*RATE,scene.elapsed());render();};
const sheet=$('#sheet');
$('#place').onclick=()=>{sheet.innerHTML='<h3>Съёмочная площадка</h3><div class="pick">'+JACKIE_LOCATIONS.map(l=>`<button data-l="${l.id}" aria-pressed="${l.id===place}"><img src="assets/${l.id}.webp" alt=""><b>${l.name}</b></button>`).join('')+'</div>';sheet.hidden=false;sheet.querySelectorAll<HTMLButtonElement>('[data-l]').forEach(b=>b.onclick=()=>{place=b.dataset.l as Location;sheet.hidden=true;state=state==='won'?'won':'idle';void preview();});};
$('#wardrobe').onclick=()=>{sheet.innerHTML='<h3>Костюмы</h3><div class="pick suits">'+JACKIE_COSTUMES.map(l=>`<button data-c="${l.id}" aria-pressed="${l.id===costume}"><i style="background-image:url(assets/${l.id}.webp)"></i><b>${l.film}</b></button>`).join('')+'</div>';sheet.hidden=false;sheet.querySelectorAll<HTMLButtonElement>('[data-c]').forEach(b=>b.onclick=()=>{costume=b.dataset.c as Costume;sheet.hidden=true;state='idle';void preview();});};
document.addEventListener('pointerdown',e=>{if(!sheet.hidden&&!(e.target as Element).closest('#sheet,#place,#wardrobe'))sheet.hidden=true;});
// ---- review desk
$<HTMLSelectElement>('#view').onchange=fit;
function fit(){const v=$<HTMLSelectElement>('#view').value,d=$('#device');d.dataset.view=v;const [w,h]=v==='desktop'?[1440,900]:v==='phone'?[390,844]:[844,390],k=Math.min(1,($('#desk').clientWidth)/w,v==='desktop'?9:9);d.style.width=w+'px';d.style.height=h+'px';d.style.transform=`scale(${k})`;$('#desk').style.height=h*k+'px';d.style.marginLeft=Math.max(0,($('#desk').clientWidth-w*k)/2)+'px';}
addEventListener('resize',fit);
$('#move').onchange=async()=>{const id=$<HTMLSelectElement>('#move').value;if(!id)return;const m=moves.find(x=>x.id===id)!;if(state==='fight'||state==='wait')return;reel=id;state='idle';shots=[];const n=m.duo?2:1;await scene.play({costume,location:(m.place??place) as Location,lineup:m.duo?['agile','bruiser']:[(m.only??'street') as any],seed:'reel',fightIndex:0,status:'playing',only:id} as any);sound.schedule(scene.fight!.cues,scene.speed*RATE);render();};
$('#again').onclick=()=>$('#move').dispatchEvent(new Event('change'));
let moves:{id:string;ru:string;duo?:boolean;only?:string;place?:string}[]=[];
$('#slow').onchange=()=>{scene.setSpeed($<HTMLInputElement>('#slow').checked?.25:1);render();};
function tick(now:number){scene.paint(now);if(state==='fight'&&scene.ready&&scene.revealed&&scene.elapsed()>0)reveal();if(scene.ready&&state!=='fight'&&state!=='wait'&&wasBusy&&!scene.busy)render();wasBusy=scene.busy;requestAnimationFrame(tick);}
let wasBusy=false;
(window as any).mock={scene,contactAt,state:()=>state,shots:()=>shots};
fit();render();
void scene.show(setup(0,'playing')).then(()=>{const f=scene.fight!;moves=[...f.phrases().filter(p=>!/^m\d$/.test(p.id)),...f.finishers()].map(({id,ru,duo,only,place}:any)=>({id,ru,duo,only,place}));$('#move').innerHTML='<option value="">Выбери приём</option><optgroup label="Обмены">'+moves.slice(0,-f.finishers().length).map(m=>`<option value="${m.id}">${m.ru}</option>`).join('')+'</optgroup><optgroup label="Завершающие">'+moves.slice(-f.finishers().length).map(m=>`<option value="${m.id}">${m.ru}</option>`).join('')+'</optgroup>';$('#load').hidden=true;render();}).catch(e=>{$('#load').textContent='Не удалось загрузить рисунки: '+e.message;});
requestAnimationFrame(tick);
