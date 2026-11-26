import {Stage} from './stage';
import {Sound} from './sound';
import {ease,lerp} from './clock';
import {playRound,xor,pay,outcome,type Round} from './rounds';
import {cascadeMoves} from '../../../../games/flooded-temple/cascadePresentation';
import {CASCADE_DATA,type CascadeFrame} from '../../../../src/shared/floodedTempleCascadeMath';
import {MAX_GAME_STAKE_CENTS,ROYAL_GAME_STAKE_CENTS,parseGameStake} from '../../../../src/shared/gameStakes';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const stage=new Stage(),{clock,lock,hero,fx,temple}=stage,sound=new Sound(),game=$('#game');
const money=(n:number)=>(n/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=(n:number)=>(n>0?'+':n<0?'−':'')+money(Math.abs(n));
/** Real rounds of the unchanged rules, found by seed with find.ts. */
const SEEDS:Record<string,number[]>={loss:[2654435761,1013904226,3668339987,387276917],partial:[2175734977,1070406884,2619514552],win:[2027808452,535203442,2323661502],chain:[2810603975,1530669837,3722888192],big:[4055616904,443779575,3394068386],huge:[2549672134,643110687,403760295],bonus:[4150184389,2326805120,3784488921]};
const used:Record<string,number>={},READY=[0,3,6,1,4,5,2,7,6,3,5,1,4,2,0],LEVEL=[.93,.62,.31,0],LIGHT=[.12,.40,.70,1],COUNTS=[10,25,50,100];
type Flow='idle'|'wait'|'show'|'error';
let losses=0,spins=0,flow:Flow='idle',stake=100,balance=100000,fast=false,auto=0,autoOn=false,pending:Round|null=null,shown=0,paid=0,run=0,last:Round|null=null,quiet=matchMedia('(prefers-reduced-motion: reduce)').matches;
const never=()=>new Promise<never>(()=>{});
/** A skipped show never continues: its token is stale and its movements are dropped. */
const live=async(t:number)=>{if(t!==run)await never();};
function say(text:string,kind=''){const e=$('#say');e.textContent=text;e.className=kind;}
function setPay(points:number){shown=points;$('#pay').textContent=money(pay(points,stake));}
async function countTo(points:number,d=.5){const a=shown;await clock.tween(d,u=>setPay(Math.round(lerp(a,points,u))),ease.out);setPay(points);}
const payAt=()=>{const a=$('#pay').getBoundingClientRect(),b=game.getBoundingClientRect();return{x:a.left+a.width/2-b.left,y:a.top+a.height/2-b.top};};
function levelFor(step:number){return lock.holy>.5?LIGHT[step]:LEVEL[step];}
function mult(f:CascadeFrame){return (f.mode==='free'?CASCADE_DATA.freeMultipliers:CASCADE_DATA.baseMultipliers).indexOf(f.multiplier);}
function pulseSeal(){void clock.tween(.5,u=>{lock.sealPulse=Math.sin(u*Math.PI);});}
async function toStep(step:number){
  if(lock.step===step&&Math.abs(lock.level-levelFor(step))<.01)return;const up=step>lock.step;lock.step=step;
  if(quiet){lock.level=levelFor(step);stage.spot=Math.max(0,step-1);stage.place();return;}
  let jump:Promise<void>|undefined;if(up){pulseSeal();sound.play('ebb');const spot=step>=3?2:step===2?1:0;if(spot!==stage.spot){if(hero.clip==='cheer'||hero.clip==='watch')hero.play('idle');jump=clock.wait(.1).then(()=>{sound.play('step');return stage.hop(spot);}).then(()=>clock.wait(.14));}}
  await Promise.all([lock.ebb(levelFor(step),up?.55:.4),jump]);
}
async function spinOut(){
  sound.play('lever');if(quiet){stage.spot=0;stage.place();lock.step=0;lock.level=levelFor(0);return;}
  if(stage.spot!==0)void stage.hop(0,.34).then(()=>stage.pull());else stage.pull();
  clock.after(.2,()=>sound.play('sink'));void toStep(0);await clock.wait(.16);await lock.sink();
}
async function spinIn(grid:readonly number[]){
  if(quiet){lock.set(grid);await clock.wait(.2);return;}
  hero.play('watch');const wet=spins++%3===2;lock.onLand=c=>{sound.play('land');sound.play('splash',.6);if(c===4&&wet&&!fast){hero.play('shield');fx.splash(hero.x+stage.heroH*.14,hero.y-stage.heroH*.7,14,.7);}};await lock.arrive(grid);if(hero.clip==='watch')hero.play('idle');
}
function free(left:number|null){const e=$('#free');e.hidden=left===null;game.classList.toggle('free',left!==null);if(left!==null)e.textContent='Бесплатных: '+left;}
async function bonusIn(added:number,t:number){
  say('');sound.play('bonus');hero.play('relic');hero.lit=1;void clock.tween(.5,u=>{stage.jade=u;});
  if(!quiet){void clock.tween(1.3,u=>{temple.dry=u;},ease.io);void lock.ebb(0,1.2);await clock.wait(1.15);await live(t);sound.play('gate');}
  stage.gateText=['Святилище реликвий',added+' бесплатных вращений'];await clock.tween(quiet?.05:.45,u=>{stage.gate=u;},ease.in);if(!quiet){stage.quake();sound.play('land');}
  temple.holy=1;temple.dry=1;lock.holy=1;lock.labels=[...CASCADE_DATA.freeMultipliers];lock.step=0;lock.level=0;lock.undim();stage.spot=0;stage.place();hero.play('idle');free(added);await clock.wait(quiet?1:1.3);await live(t);sound.play('gate');
  await clock.tween(quiet?.05:.75,u=>{stage.gate=1-u;},ease.io);await live(t);await lock.ebb(LIGHT[0],.4);
}
async function bonusOut(points:number,grid:readonly number[],step:number,t:number){
  stage.gateText=['Святилище пройдено','Собрано '+money(pay(points,stake))];sound.play('gate');await clock.tween(quiet?.05:.5,u=>{stage.gate=u;},ease.in);if(!quiet)stage.quake();
  base(step);lock.set(grid);await clock.wait(quiet?1:1.5);await live(t);sound.play('gate');await clock.tween(quiet?.05:.7,u=>{stage.gate=1-u;},ease.io);await live(t);
}
function base(step:number){temple.holy=0;temple.dry=0;lock.holy=0;lock.labels=[...CASCADE_DATA.baseMultipliers];lock.step=step;lock.level=LEVEL[step];stage.jade=0;hero.lit=0;stage.spot=0;stage.place();free(null);}
async function present(r:Round,t:number){
  let prior:CascadeFrame|undefined,parent:CascadeFrame|undefined;
  for(const f of r.frames){
    let source=prior?.removeMask?prior:undefined;
    if(prior?.mode==='base'&&f.mode==='free'){parent=prior;await bonusIn(prior.addedFreeSpins,t);await live(t);await spinOut();await live(t);source=undefined;}
    else if(prior?.mode==='free'&&f.mode==='base'){source=parent!;parent=undefined;await bonusOut(prior.totalPoints,source.grid,mult(source),t);await live(t);}
    else if(prior&&!source){await spinOut();await live(t);}
    if(f.mode==='free')free(f.remainingFreeSpins);
    const step=mult(f);
    if(source){
      const c=payAt();sound.play('crack');if(!quiet&&hero.clip!=='throw')hero.play(bits(source.removeMask)>=4?'shield':'watch');
      if(quiet)lock.undim();else await lock.crumble(source.removeMask,c,clock.rate);await live(t);
      const down=toStep(step);await live(t);if(quiet)lock.set(f.grid);else await lock.settle(cascadeMoves(source,f.grid),f.grid);await down;await live(t);
    }else{if(lock.step!==step)await toStep(step);await spinIn(f.grid);await live(t);}
    if(f.removeMask){
      const gain=pay(f.totalPoints,stake)-pay(prior?.totalPoints??0,stake);
      if(f.awardedPoints){const mid=lock.center(f.wins[0].cells[1]);Object.assign(stage.popup,{t:quiet?.3:-.25,x:mid.x,y:mid.y-lock.area.c*.1,text:'+'+money(gain),small:f.multiplier>1?'×'+f.multiplier:''});say((f.multiplier>1?'×'+f.multiplier+' · ':'')+'+'+money(gain),f.totalPoints>=20?'win':'quiet');}
      if(f.addedFreeSpins){sound.play('relic');if(f.mode==='free'){say('Ещё +'+f.addedFreeSpins+' бесплатных вращений','win');hero.play('relic');clock.after(1.1,()=>hero.play('idle'));}else hero.play('relic');}
      else if(f.awardedPoints>=20&&stage.spot===0&&stage.mode!=='portrait'){const cell=f.wins[0].cells.at(-1)!;void stage.hook(lock.center(cell),p=>{if(t!==run)return;sound.play('coin');fx.coins(p.x,p.y,8,.5);});}
      else if(f.awardedPoints>=20)hero.play('cheer');
      sound.play('coin',.7);if(f.awardedPoints)void clock.wait(.5).then(()=>t===run?countTo(f.totalPoints,.6):undefined);
      if(quiet){for(let i=0;i<15;i++)lock.cells[i].hot=f.removeMask&(1<<i)?1:0;lock.dim=1;await clock.wait(.55);}
      else await lock.celebrate(f.removeMask,f.wins,f.bonusLines,f.addedFreeSpins?1.25:.85);await live(t);setPay(Math.max(shown,f.totalPoints));
    }
    prior=f;
  }
}
const bits=(m:number)=>{let n=0;for(;m;m&=m-1)n++;return n;};
async function prize(kind:'big'|'huge',p:number,t:number){
  const P=stage.prize;P.label=kind==='huge'?'Сокровищница открыта':'Крупный выигрыш';P.text=money(0);hero.play('triumph');sound.play('chest');
  await clock.tween(.25,u=>{P.a=u;});await clock.tween(quiet?.05:.5,u=>{P.open=u;});sound.play('big');if(kind==='huge')stage.quake();
  const c=stage.chestAt(),n=kind==='huge'?70:34;fx.coins(c.x,c.y-c.S*.2,n,Math.min(1.25,c.S/170),1);const more=kind==='huge'?2:0;for(let i=1;i<=more;i++)clock.after(i*.75,()=>fx.coins(c.x,c.y-c.S*.2,46,Math.min(1.3,c.S/160),1.15));
  for(let i=0;i<(kind==='huge'?10:4);i++)clock.after(.15+i*.22,()=>fx.add({k:'spark',x:c.x+(Math.random()-.5)*c.S*2,y:c.y-c.S*(.2+Math.random()*1.1),d:.8,s:16,c:'255,232,160'}));
  await clock.tween(kind==='huge'?2.2:1.2,u=>{P.text=money(Math.round(p*ease.out(u)));});P.text=money(p);await clock.wait(kind==='huge'?1.5:1);await live(t);await clock.tween(.3,u=>{P.a=1-u;});P.open=0;
}
function finish(r:Round){
  const p=pay(r.points,stake),o=outcome(stake,p),net=p-stake;paid=p;balance+=p;pending=null;last=r;setPay(r.points);$('#net').textContent='Итог '+signed(net);
  if(o==='loss'){say('Без выигрыша','quiet');}else if(o==='partial')say('Частичный возврат '+money(p),'quiet');else if(o==='return')say('Ставка возвращена','quiet');else say((o==='huge'?'Сокровищница открыта · ':o==='big'?'Крупный выигрыш · ':'Выигрыш · ')+money(p),'win');
  flow='idle';ui();if(hero.clip==='triumph'){const t=run;void clock.wait(1.2).then(()=>{if(t===run&&hero.clip==='triumph')hero.play('idle');});}return o;
}
async function start(pick?:string){
  if(flow!=='idle'||!$<HTMLInputElement>('#stake').checkValidity()||readStake()===null||balance<stake)return;
  const t=++run;clock.rate=fast?2:1;flow='wait';balance-=stake;setPay(0);$('#net').textContent='';say('');
  const list=pick&&SEEDS[pick],i=pick?(used[pick]=(used[pick]??-1)+1):0;const r=playRound(list?xor(list[i%list.length]):m=>Math.floor(Math.random()*m));pending=r;ui();
  await spinOut();await live(t);await clock.wait(quiet?.1:.22);await live(t);
  if(pick==='lost'){await clock.wait(1.5);await live(t);flow='error';autoOn=false;auto=0;say('Ответ не получен. Ставка принята один раз, новой не будет','err');ui();return;}
  await reveal(r,t);
}
async function reveal(r:Round,t:number){
  flow='show';ui();await present(r,t);await live(t);
  const p=pay(r.points,stake),o=outcome(stake,p);if(o==='big'||o==='huge'){await prize(o,p,t);await live(t);}
  finish(r);if(o==='loss')hero.play(losses++%3===1&&!fast?'wring':'sigh');else if(o==='win'){hero.play('cheer');sound.play('win');}else if(o==='partial'||o==='return')sound.play('neutral');
  lock.undim();next(t);
}
function next(t:number){if(!autoOn)return;if(--auto<=0||balance<stake){autoOn=false;auto=0;ui();return;}ui();void clock.wait(fast?.25:.8).then(()=>{if(t===run&&autoOn&&flow==='idle')void start();});}
/** Shows the confirmed end of the accepted round at once. */
function skip(){
  const r=pending;if(!r||flow!=='show')return;const t=++run;clock.drop();fx.list=[];stage.rope.on=false;stage.gate=0;stage.prize.a=0;stage.prize.open=0;stage.popup.t=9;stage.lever=0;lock.pour=0;lock.sealPulse=0;
  const f=r.frames.at(-1)!;base(mult(f));lock.set(f.grid);lock.undim();hero.play('idle');stage.spot=mult(f)>=3?2:mult(f)===2?1:0;stage.place();finish(r);next(t);
}
function readStake(){const v=parseGameStake($<HTMLInputElement>('#stake').value.trim().replace(',','.'));return v===undefined?null:Number(v);}
function ui(){
  const idle=flow==='idle',bad=readStake()===null;$('#balance').textContent=money(balance);$('.stake').classList.toggle('bad',bad);
  for(const s of['#less','#more','#stake'])($(s) as HTMLInputElement).disabled=!idle||autoOn;
  const b=$<HTMLButtonElement>('#spin'),lab=b.querySelector('span')!;b.classList.toggle('run',flow==='wait');b.classList.toggle('skip',flow==='show');
  lab.textContent=flow==='show'?'Показать итог':flow==='error'?'Проверить раунд':flow==='wait'?'Шлюз открыт':'Вращать';b.disabled=flow==='wait'||idle&&(bad||balance<stake);
  const a=$<HTMLButtonElement>('#auto');a.textContent=autoOn?'Стоп '+auto:'Авто';a.setAttribute('aria-pressed',String(autoOn));a.disabled=!autoOn&&(!idle||bad||balance<stake);$('#fast').setAttribute('aria-pressed',String(fast));
  if(idle&&bad)say('Ставка от 0,10 до '+money(MAX_GAME_STAKE_CENTS),'err');
  document.querySelectorAll<HTMLButtonElement>('[data-show]').forEach(x=>x.disabled=!idle||autoOn);
}
function putStake(n:number){stake=n;$<HTMLInputElement>('#stake').value=money(n);say('');setPay(0);$('#net').textContent='';ui();}
$('#less').onclick=()=>{const l=ROYAL_GAME_STAKE_CENTS.filter(x=>x<stake);putStake(l.at(-1)??ROYAL_GAME_STAKE_CENTS[0]);};
$('#more').onclick=()=>putStake(ROYAL_GAME_STAKE_CENTS.find(x=>x>stake)??ROYAL_GAME_STAKE_CENTS.at(-1)!);
$<HTMLInputElement>('#stake').oninput=()=>{const v=readStake();if(v!==null){stake=v;if($('#say').className==='err')say('');}ui();};
$<HTMLInputElement>('#stake').onblur=()=>{const v=readStake();if(v!==null)$<HTMLInputElement>('#stake').value=money(v);};
$('#spin').onclick=()=>{if(flow==='show')skip();else if(flow==='error'&&pending){const t=++run;say('');void reveal(pending,t);}else void start();};
$('#fast').onclick=()=>{fast=!fast;clock.rate=fast?2:1;ui();};
$('#auto').onclick=()=>{if(autoOn){autoOn=false;auto=0;ui();return;}pop('<h2>Автоспины</h2><p>Счётчик тратят только платные вращения. «Стоп» отменяет следующие, принятый раунд доигрывается.</p><div class="row">'+COUNTS.map(n=>`<button class="main" data-n="${n}">${n}</button>`).join('')+'</div>',el=>el.querySelectorAll<HTMLElement>('[data-n]').forEach(b=>b.onclick=()=>{auto=Number(b.dataset.n);autoOn=true;close();ui();void start();}));};
$('#rules').onclick=()=>pop('<h2>Как устроен шлюз</h2><ul><li>Поле 5×3, 20 линий, одна ставка на все линии.</li><li>Три и больше одинаковых символа слева направо выигрывают, рассыпаются и освобождают место.</li><li>С каждым каскадом вода опускается на отметку: ×1, ×2, ×3, ×5.</li><li>Компас WILD заменяет символы на столбцах 2, 3 и 4.</li><li>Три реликвии подряд с первого столбца на линии открывают святилище: 10 бесплатных вращений за линию и ×3, ×6, ×9, ×15.</li><li>Предел выплаты за раунд 500 ставок.</li></ul><table><tr><th>Символ</th><th>3</th><th>4</th><th>5</th></tr>'+['Идол','Солнце','Ягуар','Сокол','Змея','Луна','Рыба'].map((n,i)=>`<tr><td>${n}</td>${CASCADE_DATA.paytable[i].map(v=>`<td>${v/20}×</td>`).join('')}</tr>`).join('')+'</table><p>Выплаты указаны за линию в долях ставки раунда. Правила и математика игры не меняются.</p><div class="row"><button class="main" data-close>Понятно</button></div>');
function pop(html:string,wire?:(e:HTMLElement)=>void){const p=$('#pop');p.innerHTML='<div class="card" role="dialog" aria-modal="true" tabindex="-1">'+html+'</div>';p.hidden=false;const c=p.firstElementChild as HTMLElement;wire?.(c);c.querySelector<HTMLElement>('[data-close]')?.addEventListener('click',close);(c.querySelector('button')??c).focus();}
function close(){$('#pop').hidden=true;$('#pop').innerHTML='';$('#spin').focus({preventScroll:true});}
$('#pop').onclick=e=>{if(e.target===$('#pop'))close();};
addEventListener('keydown',e=>{const open=!$('#pop').hidden;if(e.key==='Escape'&&open)close();if(e.code==='Space'&&!open&&document.activeElement?.tagName!=='INPUT'&&document.activeElement?.tagName!=='BUTTON'){e.preventDefault();$('#spin').click();}});
$('#sound').onclick=()=>{const on=sound.toggle(),b=$('#sound');b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',on?'Звук включён':'Звук выключен');};
$('#chat').onclick=()=>{const c=$('#chatbox');c.hidden=!c.hidden;$('#chat').setAttribute('aria-pressed',String(!c.hidden));fit();};
$('#calm').onclick=()=>{quiet=!quiet;calm();};
function calm(){$('#calm').setAttribute('aria-pressed',String(quiet));const k=quiet?0:1;stage.calm=hero.calm=temple.calm=lock.calm=fx.calm=k;if(quiet)fx.list=[];}
document.querySelectorAll<HTMLElement>('[data-show]').forEach(b=>b.onclick=()=>void start(b.dataset.show));
let fw=0,fh=0;function fit(){const r=game.getBoundingClientRect();if(!r.width||!r.height)return;fw=r.width;fh=r.height;stage.layout(r.width,r.height);}
new ResizeObserver(()=>{const r=game.getBoundingClientRect();if(Math.abs(r.width-fw)>.5||Math.abs(r.height-fh)>.5)fit();}).observe(game);
async function boot(){
  await stage.load();base(0);lock.set(READY);putStake(100);calm();fit();stage.warm();say('Открой шлюз');
  let prev=performance.now();const loop=(now:number)=>{const dt=Math.min(.05,(now-prev)/1000);prev=now;if(!document.hidden)stage.tick(dt);requestAnimationFrame(loop);};requestAnimationFrame(loop);document.documentElement.dataset.ready='1';
}
(window as any).mock={stage,state:()=>({flow,balance,stake,shown:pay(shown,stake),paid,auto,level:lock.level,step:lock.step,spot:stage.spot,clip:hero.clip,pose:hero.current,particles:fx.max,holy:lock.holy,mode:stage.mode}),start,skip,tick:(dt:number)=>stage.tick(dt)};
void boot();
