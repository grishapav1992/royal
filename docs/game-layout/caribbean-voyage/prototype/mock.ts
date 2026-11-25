import {Harbor} from './harbor';
import {Pirate,soften} from './pirate';
import {gunMuzzle,Stage,type Layout} from './stage';
import {Sound} from './sound';
import {nameOf,Voyage,type CrewState} from './voyage';
import {CREW,pointsFor,unlockedCount} from './crew';
import {loadSymbols} from './symbols';
import {ease} from './clock';
import {dialogClose,dialogOpen,lang,money,points,signed,t} from './text';
import {startCaribbeanRound,moveCaribbeanRound,caribbeanInitialCost,type CaribbeanView,type CaribbeanStartMode} from '../../../../src/shared/caribbeanTreasures';
import {CARIBBEAN_BONUS_SPINS,CARIBBEAN_LINES,CARIBBEAN_LINE_COUNTS,settleCaribbeanFrame,type CaribbeanLineCount} from '../../../../src/shared/caribbeanTreasuresMath';
import {MAX_GAME_STAKE_CENTS,MIN_GAME_STAKE_CENTS,parseGameStake,ROYAL_GAME_STAKE_CENTS} from '../../../../src/shared/gameStakes';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const game=$('#game'),harbor=new Harbor($('#harbor') as any),pirate=new Pirate($('#pirate') as any),stage=new Stage($('#field') as any,$('#fx') as any,$('#rain') as any,harbor,pirate),sound=new Sound();
const xor=(seed:number)=>{let s=seed>>>0||1;return(m:number)=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)%m;};};
const fair=(m:number)=>Math.floor(Math.random()*m);
type Draw=typeof fair;
/** Saved real rounds of the unchanged rules, found by seed. Twenty lines. */
const SEEDS:Record<string,number[]>={loss:[3041712678,774553834,295853050],win:[387276917,2732519868,831056492,3267723310,1296417516],giant:[1936384585,2415085369,3246141861,909140599],cannon:[1705275882,317434499,3176299443,417100055,3964193037],big:[4231412114,1432193446,3894350619,3157096324],bonus:[4020695695,1713517571,516765611],symbols:[2732519868,3636562396,1101419187,2934994598,50297888,587538249]};
const used:Record<string,number>={},STAKES=ROYAL_GAME_STAKE_CENTS,COUNTS=[10,25,50,100];
type Flow='idle'|'wait'|'show'|'error';
let lines:CaribbeanLineCount=20,stake=10,balance=100000,view:CaribbeanView|undefined,flow:Flow='idle',auto=0,autoOn=false,kind:''|'win'|'quiet'|'error'='',say='',sum='',pieces=0,settled=false,shownAt=0,mode:'wide'|'portrait'|'short'='wide',tiny=false;
/** The accepted operation is kept until its answer is known. It is never sent as a new stake. */
let pending:{cost:number;free:boolean;series:boolean;view:CaribbeanView}|null=null;
const busy=()=>flow==='wait'||flow==='show';
const crew:CrewState={points:239,met:new Set(['isabella','amara']),selected:'isabella'};
const voyage=new Voyage($('#voyage'),crew,{select:id=>{crew.selected=id;void pirate.select(id).then(()=>pirate.gesture('enter'));renderCrew();},changed:()=>renderCrew(),cue:c=>sound.play(c),reduced:()=>stage.clock.reduced,blocked:()=>busy()||!!view&&view.phase!=='complete',mode:()=>mode});
stage.onCue=c=>sound.play(c);
const phase=()=>view&&view.phase!=='complete'?view.phase:'idle';
const price=(m:CaribbeanStartMode)=>Number(caribbeanInitialCost({lines,mode:m,stakeBasis:'total'},String(stake)));

/* Layout: the field keeps one place in every state of the same window. */
function layout(){
  const W=game.offsetWidth,H=game.offsetHeight;if(!W||!H)return;
  mode=W/H<.82?'portrait':H<440?'short':'wide';const small=mode==='wide'&&(H<760||W<1010),roomy=mode==='portrait'&&W>=600;
  const v=(k:string,n:number)=>game.style.setProperty('--'+k,Math.round(n*10)/10+'px');
  let b:number,bx:number,by:number,bw:number,bh:number,con:number,rh:number,ry:number,P={x:0,y:0,w:0,h:0},plate={x:0,y:0,w:0,h:0},place:{x:number;y:number;z:number},muzzle:{x:number;y:number},gun:Layout['gun'],plx=0;tiny=false;
  if(mode==='wide'){
    con=small?106:122;rh=small?46:52;b=small?24:Math.min(36,26+W*.004);const top=small?60:66,capW=Math.min(Math.max(W*.272,226),430),ship=Math.min(Math.max(W*.056,44),150);
    const availH=H-con-top-rh-b*2-(small?12:16),availW=W-capW-ship-b*2;
    bw=Math.min(availW,availH*1.5,940);bh=bw/1.5;bx=ship+b+Math.max(0,(availW-bw)*.5);
    // the field stands low: the sails of the galleon rise above it
    const slack=Math.max(0,availH-bh);ry=H-con-rh-(small?22:26)-Math.max(0,slack-120)*.5;by=ry-(small?5:7)-b-bh;
    const free=W-(bx+bw+b);plate={w:Math.min(free-30,300),h:small?74:84,x:0,y:0};plate.x=bx+bw+b+(free-plate.w)/2+4;plate.y=H-con-plate.h-(small?10:16);
    const ph=Math.min(H-con-top+(small?10:6)-plate.h*.45,(free+b*1.5)*1.5);P={h:ph,w:ph*2/3,x:0,y:0};P.x=Math.min(W+P.w*.015-P.w,bx+bw+b+free/2-P.w/2+6);P.y=plate.y+plate.h*.62-ph;
    const z=Math.max(W/1600,H/900),over=1600*z-W;place={z,x:-Math.min(over,over*.12),y:Math.max(H-con+18-900*z,8-92*z)};
    const gs=Math.min(190,Math.max(112,bx-b+86));gun={x:Math.max(6,(bx-b)/2-gs*.36),y:H-con+(small?2:0),s:gs};muzzle=gunMuzzle(gun);plx=bx+bw*(small?.66:.68);
  }else if(mode==='portrait'){
    const low=H<700;con=roomy?126:low?178:212;rh=roomy?52:46;b=roomy?27:W<350?11:16;
    bw=W-(W<350?8:12)-b*2;if(roomy)bw=Math.min(bw,(H-con-rh-14-b*2-330)*1.5);bh=bw/1.5;bx=(W-bw)/2;ry=H-con-rh-(roomy?24:3);by=ry-5-b-bh;const strip=by-b;tiny=strip<170;
    if(!tiny){const ph=Math.min(strip*(roomy?1.22:1.2),W*.84);P={h:ph,w:ph*2/3,x:W-ph*2/3+2-(roomy?W*.06:0),y:Math.max(2,strip-ph*.84)};plate={x:roomy?bx-b:8,y:strip-92,w:roomy?270:Math.min(176,W-P.w-10),h:roomy?84:86};}
    const z=Math.max((strip+40)/470,W/1600,roomy?.86:.52);place={z,x:Math.max(W-1600*z,roomy?-20:-70*z),y:strip-505*z};muzzle={x:place.x+300*z,y:place.y+385*z};
  }else{
    tiny=W<700||H<310;con=0;rh=tiny?40:46;b=tiny?10:15;const side=tiny?208:Math.min(292,W*.335);v('side',side);bh=H-rh-b*2-(tiny?10:14);bw=bh*1.5;if(bw>W-side-b*2-20){bw=W-side-b*2-20;bh=bw/1.5;}bx=W-side-12-b-bw;by=4+b;ry=by+bh+b+(tiny?2:3);
    const free=bx-b;const ph=free>70?Math.min(H*1.0,(free+30)*1.75):0;P={h:ph,w:ph*2/3,x:free/2-ph/3+4,y:H-ph*.96};
    const z=Math.max(W/1600,H/620);place={z,x:-30,y:-60*z};muzzle={x:Math.max(10,bx-b-16),y:by+bh*.42};
  }
  game.dataset.mode=mode;game.toggleAttribute('data-small',small);game.toggleAttribute('data-roomy',roomy);game.toggleAttribute('data-tiny',tiny);game.toggleAttribute('data-narrow',mode!=='wide'&&!roomy);
  v('console',con);v('bx',bx);v('by',by);v('bw',bw);v('bh',bh);v('b',b);v('rh',rh);v('ry',ry);v('rx',gun?Math.max(bx-b,gun.x+gun.s*.80):bx-b);v('px',plate.x);v('py',plate.y);v('pw',plate.w);v('ph',plate.h);v('plx',plx);
  const dpr=Math.min(2,window.devicePixelRatio||1),L:Layout={W,H,mode,board:{x:bx,y:by,w:bw,h:bh},b,pirate:P,muzzle,gun};
  harbor.place=place;harbor.resize(W,H,Math.min(dpr,1.5));stage.layout(L,dpr);
  Object.assign(pirate.canvas.style,{left:P.x+'px',top:P.y+'px',width:P.w+'px',height:P.h+'px',display:P.h>60?'block':'none'});
  // The lower edge dissolves into the plate, so every drawing ends softly.
  soften(pirate.canvas,mode==='portrait'?'linear-gradient(transparent,#000 3%,#000 76%,transparent 86%)':mode==='short'?'linear-gradient(transparent,#000 3%)':'linear-gradient(transparent,#000 3%,#000 88%,transparent 99%)');
  if(P.h>60)pirate.resize(P.w,P.h,dpr);
  render();renderCrew();if(voyage.open)voyage.render();
}
const L=()=>stage.L,near=()=>game.hasAttribute('data-narrow');
/* Round ------------------------------------------------------------------------------ */
async function spin(buy?:CaribbeanStartMode){
  if(flow!=='idle'||phase()==='choice')return;
  const f=$<HTMLSelectElement>('#force').value,free=phase()==='bonus';let draw:Draw=fair;
  if(!free&&!buy&&SEEDS[f]){const l=SEEDS[f];used[f]=((used[f]??-1)+1)%l.length;if(lines===20)draw=xor(l[used[f]]);}
  const m:CaribbeanStartMode=buy??'normal',cost=free?0:price(m);
  if(!free&&f==='funds'&&balance>=cost){balance=Math.max(0,cost-5);}
  if(balance<cost){kind='error';say=t('Не хватает средств','Not enough funds');sum='';settled=false;autoOn=false;render();return;}
  pending={cost,free,series:!!buy,view:free?moveCaribbeanRound(view!,view!.revision,'spin',draw).view:startCaribbeanRound({lines,mode:m,stakeBasis:'total'},String(stake),draw).view};
  $('#amount').hidden=true;stage.clock.hurry=false;pieces=0;
  await ask(f==='offline');
}
/** Sends the kept operation. Without an answer the field, the balance and the stake stay as they were. */
async function ask(lost:boolean){
  const op=pending!;flow='wait';kind='';sum='';settled=false;say=op.free?t('Корабль идёт вперёд','Full sail ahead'):op.series?t('Подтверждаем покупку','Confirming the purchase'):t('Барабаны пошли','The reels are off');stage.resetWins();render();
  pirate.show('focus');pirate.gesture('nod');if(!op.series)stage.startRoll();
  await stage.clock.wait(lost?2.6:.72);
  if(lost){
    kind='error';autoOn=false;say=t('Ответ не получен','No answer yet');render();if(!op.series)await stage.abort();flow='error';pirate.show('idle');render();$('#spin').focus({preventScroll:true});return;
  }
  pending=null;const before=op.free?Number(view!.totalPayoutUnits):0;view=op.view;balance-=op.cost;flow='show';shownAt=performance.now();
  if(op.series){render();await enterSeries();flow='idle';stage.clock.hurry=false;say='';render();return;}
  await reveal(op.free,before);
}
async function reveal(free:boolean,before:number){
  const now=view!,s=now.spins.at(-1)!,fr=s.frame,total=Number(now.totalPayoutUnits),add=Number(s.payoutUnits),cost=Number(now.costUnits);
  say=t('Барабаны остановились','The reels stop');render();
  await stage.stop(fr);
  if(fr.blockBefore){say=near()?t('Гигантский символ','Giant symbol'):t('Из глубины поднимается гигантский символ','A giant symbol rises from the deep');render();pirate.show('focus');await stage.giant();}
  if(fr.cannon&&fr.block){say=t('Залп!','Fire!');render();await stage.cannon(fr.block,fr.grid);}
  else if(fr.block){stage.block={...fr.block};stage.grid=[...fr.grid];}
  const pay=settleCaribbeanFrame(fr.grid,now.settings.lines,now.lineStakeUnits,now.settings.stakeBasis==='total'?now.settings.lines:1);
  if(fr.wins.length){
    // only a result above the whole accepted price is a profit
    const quiet=total<=cost;kind=quiet?'quiet':'win';say=fr.wins.length===1?t('Совпала одна линия','One line matched'):t(`Совпало линий: ${fr.wins.length}`,`Lines matched: ${fr.wins.length}`);render();
    const r=L(),to={x:r.board.x+r.board.w-20,y:r.board.y+r.board.h+r.b+26};
    await Promise.all([stage.wins(fr,pay.linePayoutUnits.map(Number),quiet),(async()=>{await stage.clock.wait(.35);if(!quiet)stage.coinsTo(to,Math.min(14,4+fr.wins.length*2));await stage.clock.tween(.5,u=>{sum=money(Math.round(before+add*u));paintResult();},ease.out);})()]);
  }
  sum=total?money(total):'';
  if(now.phase==='choice'){
    pieces=3;kind='';say=near()?t('Выбери тактику','Choose a tactic'):t('Карта собрана. Выбери тактику','The map is complete. Choose a tactic');pirate.show('bonus');sound.play('choose');flow='idle';stage.clock.hurry=false;render();showCards();return;
  }
  pieces=free?0:now.mapPieces;
  if(now.phase==='complete')await finish();
  else{kind=add?kind:'';say=t(`Осталось вращений: ${now.remaining}`,`Spins left: ${now.remaining}`);pirate.show(add&&kind==='win'?'win':'idle',add&&kind==='win'?1:0);}
  stage.clock.hurry=false;flow='idle';render();
  if(autoOn){if(phase()==='idle')auto--;if(auto<=0)autoOn=false;render();setTimeout(autoNext,450);}
}
function autoNext(){if(autoOn&&flow==='idle'&&phase()!=='choice')void spin();}
async function finish(){
  const v=view!,paid=Number(v.totalPayoutUnits),cost=Number(v.costUnits),series=!!v.tactic;
  balance+=paid;settled=true;const pts=pointsFor(cost);
  if(paid>=cost*20){
    kind='win';say=t('Крупный выигрыш','Big win');render();pirate.show('laugh',2.8);pirate.gesture('big');
    const a=$('#amount');a.querySelector('small')!.textContent=t('Крупный выигрыш','Big win');a.querySelector('em')!.textContent=t('Чистый итог ','Net ')+signed(paid-cost);
    await stage.treasure(u=>{a.hidden=false;a.querySelector('b')!.textContent=money(Math.round(paid*u));});a.hidden=true;
  }else if(paid>cost){kind='win';say=series?near()?t('Добыча на борту','Loot aboard'):t('Серия завершена, добыча на борту','The series is over, the loot is aboard'):t('Добыча раунда','Round loot');pirate.show('win',1.8);pirate.gesture('win');sound.play('win');}
  else if(paid===cost){kind='quiet';say=t('Цена раунда вернулась','The price came back');pirate.show('idle');}
  else if(paid>0){kind='quiet';say=series?near()?t('Вернулась часть цены','Part came back'):t('Серия завершена, вернулась часть цены','The series is over, part of the price came back'):near()?t('Вернулась часть','Part came back'):t('Вернулась часть ставки','Part of the stake came back');pirate.show('soft',1.1);pirate.gesture('soft');}
  else{kind='';say=t('Без выигрыша','No win');pirate.show('soft',1);pirate.gesture('soft');sound.play('loss');}
  if(series)await leaveSeries();
  addPoints(pts);
}
function addPoints(n:number){
  const had=unlockedCount(crew.points);crew.points+=n;renderCrew();
  for(const a of document.querySelectorAll<HTMLElement>('.pl-add')){a.textContent='+'+n;a.hidden=false;a.style.animation='none';void a.offsetWidth;a.style.animation='';}
  if(unlockedCount(crew.points)>had)sound.play('choose');
}
/* Series ------------------------------------------------------------------------------- */
function showCards(){
  const c=$('#cards');c.hidden=false;
  const brief=tiny||mode==='short';c.innerHTML=`<h3>${brief?t('Выбери тактику','Choose a tactic'):t('Карта абордажа собрана. Выбери тактику','The boarding map is complete. Choose a tactic')}</h3><div><button class="card raid" data-t="raid"><em></em><i>14</i><span><b>${t('Рейд на торговцев','Merchant raid')}</b><small>${brief?t('14 вращений, символ 2×2 с залпом','14 spins, 2×2 symbol, broadside'):t('14 бесплатных вращений. Символ 2×2, залп растит его до 3×3','14 free spins. A 2×2 symbol, a broadside grows it to 3×3')}</small></span></button><button class="card flag" data-t="flagship"><em></em><i>6</i><span><b>${t('Штурм флагмана','Flagship assault')}</b><small>${brief?t('6 вращений, символ 3×3','6 spins, 3×3 symbol'):t('6 бесплатных вращений. Сразу символ 3×3','6 free spins. A 3×3 symbol at once')}</small></span></button></div>`;
  c.querySelectorAll<HTMLElement>('[data-t]').forEach(x=>x.addEventListener('click',async()=>{if(flow!=='idle')return;flow='show';shownAt=performance.now();c.hidden=true;sound.play('choose');view=moveCaribbeanRound(view!,view!.revision,x.dataset.t==='raid'?'choose-raid':'choose-flagship',fair).view;$('#spin').focus({preventScroll:true});render();await enterSeries();flow='idle';stage.clock.hurry=false;render();if(autoOn)setTimeout(autoNext,450);}));
  c.querySelector<HTMLElement>('[data-t]')!.focus({preventScroll:true});
}
async function enterSeries(){
  const raid=view!.tactic==='raid';game.dataset.sea=raid?'raid':'storm';stage.resetWins();stage.block=null;
  say=raid?near()?t('Абордаж!','Boarding!'):t('Рейд на торговцев. Абордаж!','Merchant raid. Boarding!'):near()?t('Держим курс!','Hold the course!'):t('Штурм флагмана. Держим курс!','Flagship assault. Hold the course!');kind='';render();pirate.show('bonus',2.2);pirate.gesture('win');
  const k=raid?'sunset':'storm',z=harbor.place.z,x=harbor.place.x,y=harbor.place.y,W=L().W,H=L().H;
  // the camera leans towards the ships, the field stays still
  void stage.clock.tween(2,u=>{const q=.035*Math.sin(u*Math.PI);harbor.place={z:z*(1+q),x:x-q*(W*.2-x),y:y-q*(H*.4-y)};},ease.lin,true).then(()=>{harbor.place={z,x,y};});
  if(!raid)setTimeout(()=>stage.bolt(),400);
  await stage.clock.tween(1,u=>{(harbor as any)[k]=u;grade(raid,u);if(!raid){stage.fx.rain=u;pirate.wind=u*1.6;}else pirate.wind=u*.5;},ease.io);
  if(raid)await stage.boarding();else await stage.clock.wait(.3);
  say=(near()?t('Вращений: ','Free spins: '):t('Бесплатных вращений: ','Free spins: '))+view!.remaining;
}
const grade=(raid:boolean,u:number)=>{const c=raid?[1.04,.84,.78]:[.70,.78,.88];pirate.tint=[1+(c[0]-1)*u,1+(c[1]-1)*u,1+(c[2]-1)*u];};
async function leaveSeries(){
  const raid=game.dataset.sea==='raid',k=raid?'sunset':'storm';game.dataset.sea='day';await stage.release();
  void stage.clock.tween(1.6,u=>{(harbor as any)[k]=1-u;grade(raid,1-u);if(!raid)stage.fx.rain=1-u;pirate.wind=(raid?.5:1.6)*(1-u);},ease.io);
}
/** Reopening in the middle of a series: the kept round returns without a new charge. */
async function reopen(){
  if(flow!=='idle'||phase()!=='idle')return;autoOn=false;
  let v=startCaribbeanRound({lines,mode:'buy-raid',stakeBasis:'total'},String(stake),fair).view;balance-=Number(v.costUnits);for(let i=0;i<3;i++)v=moveCaribbeanRound(v,v.revision,'spin',fair).view;
  const c=$('#curtain');c.hidden=false;c.textContent=t('Возвращаем незавершённый раунд','Restoring the unfinished round');flow='wait';stage.resetWins();render();
  await stage.clock.wait(1.1);view=v;const fr=v.spins.at(-1)!.frame;stage.grid=[...fr.grid];stage.block=fr.block?{...fr.block}:null;game.dataset.sea='raid';harbor.sunset=1;grade(true,1);pirate.wind=.5;stage.moored();
  flow='idle';kind='';sum=Number(v.totalPayoutUnits)?money(v.totalPayoutUnits):'';settled=false;say=t('Рейд продолжается','The raid goes on');c.hidden=true;render();
}
/* HUD ------------------------------------------------------------------------------------- */
function paintResult(){$('#result .sum').textContent=sum;}
function ledger(){
  const narrow=game.hasAttribute('data-narrow'),v=view;
  if(flow==='error'||kind==='error'&&pending)return narrow?t('Ставка не повторится','No second charge'):t('Повторной ставки не будет','There will be no second stake');
  if(kind==='error')return narrow?t(`Нужно ${money(price('normal'))}`,`${money(price('normal'))} needed`):t(`Для вращения нужно ${money(price('normal'))} USDT`,`A spin needs ${money(price('normal'))} USDT`);
  if(flow==='wait')return pending&&!pending.free?t('Цена раунда ','Round price ')+money(pending.cost):v&&v.phase!=='complete'?t('Цена раунда ','Round price ')+money(v.costUnits):'';
  if(!v)return t(`Линий ${lines}, слева направо`,`${lines} lines, left to right`);
  const cost=Number(v.costUnits),paid=Number(v.totalPayoutUnits);
  if(settled)return narrow?t('Цена ','Price ')+money(cost)+t(' · итог ',' · net ')+signed(paid-cost):t('Цена раунда ','Round price ')+money(cost)+t(' · выплата ',' · payout ')+money(paid)+t(' · чистый итог ',' · net ')+signed(paid-cost);
  return t(narrow?'Цена ':'Цена раунда ',narrow?'Price ':'Round price ')+money(cost)+(v.tactic&&paid&&!(tiny&&mode==='portrait')?t(' · накоплено ',' · so far ')+money(paid):'');
}
function render(){
  const p=phase(),bonus=p==='bonus',choice=p==='choice',r=$('#result');r.dataset.kind=kind;game.dataset.flow=flow;
  $('#result .say').textContent=say||(bonus?(near()?t('Вращений: ','Free spins: '):t('Бесплатных вращений: ','Free spins: '))+view!.remaining:t('Корабль готов','The ship is ready'));$('#result .ledger').textContent=ledger();paintResult();
  document.querySelectorAll('.pieces i').forEach((i,k)=>i.classList.toggle('on',k<pieces));const pc=$('.pieces'),all=bonus?CARIBBEAN_BONUS_SPINS[view!.tactic!]:1,run=bonus?all-view!.remaining:0;pc.toggleAttribute('data-series',bonus);pc.style.setProperty('--run',run/all*100+'%');pc.querySelector('small')!.textContent=bonus?(view!.tactic==='raid'?t('Рейд ','Raid '):t('Штурм ','Assault '))+run+'/'+all:t('Карта ','Map ')+pieces+'/3';pc.title=bonus?'':t('Три части карты на поле открывают выбор тактики','Three map pieces on the field open the tactics');
  const retry=$<HTMLButtonElement>('#retry');retry.hidden=flow!=='error';retry.textContent=game.hasAttribute('data-narrow')?t('Проверить','Check'):t('Проверить тот же ход','Check the same move');$('#result .sum').hidden=flow==='error';
  $('#balance').textContent=money(balance);$('#moneylabel').textContent=t('Баланс','Balance');
  const held=p!=='idle'||!!pending,shown=held&&view&&p!=='idle'?Number(view.costUnits):pending?pending.cost:stake;
  $('#stake').textContent=money(shown);$('#stakelabel').textContent=held&&!(pending&&!pending.free&&pending.cost===stake)?t('Цена раунда','Round price'):t('Ставка за вращение','Spin stake');$('#stake').toggleAttribute('data-held',held);
  const lock=flow!=='idle'||p!=='idle'||autoOn;for(const id of ['#less','#more','#stake','#buy'])$<HTMLButtonElement>(id).disabled=lock;
  $<HTMLButtonElement>('#less').disabled=lock||stake<=STAKES[0];$<HTMLButtonElement>('#more').disabled=lock||stake>=STAKES.at(-1)!;
  // the same wheel starts a spin, opens the result at once and checks a lost answer. It never loses the keyboard focus.
  const s=$<HTMLButtonElement>('#spin'),off=flow==='wait'||flow==='idle'&&(choice||autoOn);s.setAttribute('aria-disabled',String(off));s.classList.toggle('turn',busy());s.classList.toggle('skip',flow==='show');
  const [a1,a2]=flow==='wait'?[t('Ждём','Wait'),t('ответ','answer')]:flow==='show'?[t('Итог','Result'),t('сразу','now')]:flow==='error'?near()?[t('Узнать','Check'),t('итог','result')]:[t('Проверить','Check'),t('тот же ход','same move')]:bonus?near()?[t('Вращать','Spin'),t('ещё ','left ')+view!.remaining]:[t('Бесплатно','Free'),t('осталось ','left ')+view!.remaining]:choice?[t('Тактика','Tactic'),t('выбери','choose')]:[t('Вращать','Spin'),money(price('normal'))];
  s.querySelector('b')!.textContent=a1;s.querySelector('small')!.textContent=a2;s.setAttribute('aria-label',flow==='show'?t('Показать итог сразу','Show the result now'):a1+' '+a2);
  const a=$<HTMLButtonElement>('#auto');a.setAttribute('aria-pressed',String(autoOn));a.disabled=!autoOn&&(flow!=='idle'||p!=='idle');a.querySelector('b')!.textContent=autoOn?t('Стоп','Stop'):t('Авто','Auto');a.querySelector('small')!.textContent=autoOn?t('ещё ','left ')+auto:'';
  $('#buy b').textContent=mode==='wide'?t('Купить бонус','Buy bonus'):t('Бонус','Bonus');$('#buy small').textContent=p!=='idle'?tiny?'':t('после раунда','after round'):money(price('buy-raid'))+(game.hasAttribute('data-tiny')?'':' USDT');
  $('#lines').textContent=t('Линии ','Lines ')+lines;$('#title').textContent=t('Карибские сокровища','Caribbean Treasures');
  for(const [id,ru,en] of [['sound','Звук','Sound'],['music','Музыка','Music'],['history','История раунда','Round history'],['info','Правила','Rules'],['menu','Меню','Menu'],['fund','Пополнить','Add funds'],['less','Меньше','Less'],['more','Больше','More'],['plate','Карта плавания','Voyage map'],['crewmini','Карта плавания','Voyage map']] as const)$('#'+id).setAttribute('aria-label',t(ru,en));
  $('#stake').setAttribute('aria-label',t('Ставка ','Stake ')+money(shown));
  if(stage.tour&&(flow!=='idle'))stage.tour=null;
}
function renderCrew(){
  const n=unlockedCount(crew.points),next=CREW[n],m=CREW.find(x=>x.id===crew.selected)!,fresh=voyage.fresh(),prev=CREW[n-1].points,pc=next?(crew.points-prev)/(next.points-prev)*100:100,need=next?next.points-crew.points:0;
  $('.pl-top b').textContent=nameOf(m);$('.pl-top small').textContent=t(`Команда ${crew.met.size} из ${CREW.length}`,`Crew ${crew.met.size} of ${CREW.length}`);
  $('.plate .bar i').style.width=(fresh?100:pc)+'%';$('.pl-next').textContent=fresh?t('Новая пиратка ждёт','A new pirate is waiting'):next?mode==='portrait'?t(`Ещё ${need} ${points(need)}`,`${need} ${points(need)} to go`):t(`До следующей ещё ${need} ${points(need)}`,`Next in ${need} ${points(need)}`):t('Вся команда в сборе','The whole crew is here');
  for(const id of ['#plate','#crewmini'])$(id).classList.toggle('new',!!fresh);
  const c=$('#crewmini');c.querySelector('img')!.src='assets/crew/'+m.id+'-thumb.webp';c.querySelector<HTMLElement>('.ring')!.style.setProperty('--p',String(fresh?100:pc));c.querySelector('b')!.textContent=nameOf(m);c.querySelector('small')!.textContent=fresh?t('новая!','new!'):next?t(`ещё ${need}`,`${need} to go`):t('все','all');
}
/* Sheets ------------------------------------------------------------------------------------- */
function closeSheet(){const el=$('#sheet');if(el.hidden)return;el.hidden=true;dialogClose(el);}
function sheet(html:string,bind:(el:HTMLElement)=>void=()=>{},first=''){
  const el=$('#sheet'),title=html.match(/<h3>(.*?)<\/h3>/)?.[1]??'';el.innerHTML='<div class="panel"><button class="sx" data-x aria-label="'+t('Закрыть','Close')+'">×</button>'+html+'</div>';el.hidden=false;
  el.onclick=e=>{if(e.target===el)closeSheet();};bind(el);el.querySelectorAll('[data-x]').forEach(b=>b.addEventListener('click',closeSheet));
  dialogOpen(el,title,first?el.querySelector<HTMLElement>(first):null);
}
const openStake=()=>{
  let draft=money(stake).replace(/\s/g,'');
  sheet(`<h3>${t('Ставка за вращение','Spin stake')}</h3><label class="field"><span>${t('Сумма, USDT','Amount, USDT')}</span><input id="amountin" inputmode="decimal" autocomplete="off" value="${draft}" aria-describedby="amounterr"></label><p class="err" id="amounterr" role="alert"></p><div class="grid five">${STAKES.map(v=>`<button data-v="${v}" aria-pressed="${v===stake}">${money(v)}</button>`).join('')}</div><div class="foot"><button data-x>${t('Отмена','Cancel')}</button><button class="main" data-go>${t('Готово','Done')}</button></div>`,el=>{
    const inp=el.querySelector<HTMLInputElement>('#amountin')!,err=el.querySelector<HTMLElement>('#amounterr')!,go=el.querySelector<HTMLButtonElement>('[data-go]')!;
    const check=()=>{const v=parseGameStake(inp.value);go.disabled=!v;inp.setAttribute('aria-invalid',String(!v));err.textContent=v?'':t(`От ${money(MIN_GAME_STAKE_CENTS)} до ${money(MAX_GAME_STAKE_CENTS)}, не больше двух знаков`,`From ${money(MIN_GAME_STAKE_CENTS)} to ${money(MAX_GAME_STAKE_CENTS)}, two decimals at most`);el.querySelectorAll<HTMLElement>('[data-v]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===v)));return v;};
    const apply=()=>{const v=check();if(!v)return;stake=Number(v);closeSheet();render();};
    inp.oninput=check;inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply();}};go.onclick=apply;el.querySelectorAll<HTMLElement>('[data-v]').forEach(b=>b.onclick=()=>{stake=Number(b.dataset.v);closeSheet();render();});
  },'#amountin');
};
$('#stake').onclick=openStake;
$('#less').onclick=()=>{stake=[...STAKES].reverse().find(v=>v<stake)??STAKES[0];sound.play('click');render();};
$('#more').onclick=()=>{stake=STAKES.find(v=>v>stake)??STAKES.at(-1)!;sound.play('click');render();};
$('#auto').onclick=()=>{if(autoOn){autoOn=false;auto=0;render();return;}let pick=10;
  const open=()=>sheet(`<h3>${t('Автоигра','Autoplay')}</h3><p>${t('Платных вращений по ставке','Paid spins at')} ${money(stake)} USDT. ${t('Тактику бонуса выберешь сам, бесплатные вращения пойдут без списаний','You choose the bonus tactic, free spins go on without charges')}.</p><div class="grid two">${COUNTS.map(v=>`<button data-v="${v}" aria-pressed="${v===pick}">${v}</button>`).join('')}</div><div class="foot"><button data-x>${t('Отмена','Cancel')}</button><button class="main" data-go>${t('Начать','Start')}</button></div>`,el=>{el.querySelectorAll<HTMLElement>('[data-v]').forEach(b=>b.onclick=()=>{pick=Number(b.dataset.v);open();el.querySelector<HTMLElement>(`[data-v="${pick}"]`)!.focus();});el.querySelector<HTMLElement>('[data-go]')!.onclick=()=>{closeSheet();autoOn=true;auto=pick;render();void spin();};},'[data-v="'+pick+'"]');open();};
$('#buy').onclick=()=>{let pick:CaribbeanStartMode='buy-raid';
  const open=()=>sheet(`<h3>${t('Купить бонус','Buy the bonus')}</h3><p>${t('Ставка','Stake')} ${money(stake)} USDT, ${t('линий','lines')} ${lines}. ${t('Цена за всю серию','Price for the whole series')}: <b>${money(price(pick))} USDT</b>.</p><div class="grid two"><button data-m="buy-raid" aria-pressed="${pick==='buy-raid'}">${t('Рейд','Raid')}<small>${t('14 вращений','14 spins')}</small></button><button data-m="buy-flagship" aria-pressed="${pick==='buy-flagship'}">${t('Флагман','Flagship')}<small>${t('6 вращений','6 spins')}</small></button></div><div class="foot"><button data-x>${t('Отмена','Cancel')}</button><button class="main" data-go>${t('Купить за','Buy for')} ${money(price(pick))}</button></div>`,el=>{el.querySelectorAll<HTMLElement>('[data-m]').forEach(b=>b.onclick=()=>{pick=b.dataset.m as CaribbeanStartMode;open();el.querySelector<HTMLElement>(`[data-m=${pick}]`)!.focus();});el.querySelector<HTMLElement>('[data-go]')!.onclick=()=>{closeSheet();$('#spin').focus({preventScroll:true});void spin(pick);};},'[data-m='+pick+']');open();};
const openLines=()=>{const lock=flow!=='idle'||phase()!=='idle'||autoOn;
  sheet(`<h3>${t('Линии','Lines')}</h3><div class="grid two">${CARIBBEAN_LINE_COUNTS.map(v=>`<button data-v="${v}" aria-pressed="${v===lines}" ${lock?'disabled':''}>${v}</button>`).join('')}</div><button class="wideb" data-tour ${flow!=='idle'?'disabled':''}>${t('Показать на поле по очереди','Show on the field one by one')}</button><div class="minis">${CARIBBEAN_LINES.slice(0,lines).map((l,i)=>`<svg viewBox="0 0 62 46" role="img" aria-label="${t('Линия','Line')} ${i+1}"><rect x=".5" y=".5" width="61" height="45" rx="4"/>${Array.from({length:24},(_,k)=>`<circle class="${l[k%6]===Math.floor(k/6)?'on':''}" cx="${6+k%6*10}" cy="${17+Math.floor(k/6)*8}" r="${l[k%6]===Math.floor(k/6)?2.9:1.5}"/>`).join('')}<polyline points="${l.map((y,x)=>`${6+x*10},${17+y*8}`).join(' ')}"/><text x="31" y="10">${i+1}</text></svg>`).join('')}</div>`,el=>{el.querySelectorAll<HTMLElement>('[data-v]').forEach(b=>b.onclick=()=>{lines=Number(b.dataset.v) as CaribbeanLineCount;closeSheet();render();});el.querySelector<HTMLElement>('[data-tour]')!.onclick=()=>{closeSheet();stage.resetWins();stage.tour={line:0,t:0,count:lines};kind='';say=near()?t('Линии по очереди','Lines one by one'):t('Линии по очереди. Нажми на поле, чтобы закончить','Lines one by one. Tap the field to stop');sum='';settled=false;render();};});};
$('#lines').onclick=openLines;
const openHistory=()=>{const v=view;if(!v){sheet(`<h3>${t('История раунда','Round history')}</h3><p>${t('Раундов ещё не было','No rounds yet')}.</p>`);return;}
  const cost=Number(v.costUnits),paid=Number(v.totalPayoutUnits),hide=flow==='show'?1:0,list=v.spins.slice(0,v.spins.length-hide);
  sheet(`<h3>${t('История раунда','Round history')}</h3><dl><dt>${t('Цена раунда','Round price')}</dt><dd>${money(cost)}</dd><dt>${v.phase==='complete'&&!hide?t('Выплата','Payout'):t('Накоплено','So far')}</dt><dd>${money(hide?list.reduce((n,s)=>n+Number(s.payoutUnits),0):paid)}</dd>${v.phase==='complete'&&!hide?`<dt>${t('Чистый итог','Net result')}</dt><dd>${signed(paid-cost)}</dd>`:''}</dl><ol class="spins">${list.map(s=>`<li><span>${s.frame.block?t('Символ','Symbol')+' '+s.frame.block.size+'×'+s.frame.block.size:t('Обычное поле','Plain field')}${s.frame.cannon?', '+t('залп','broadside'):''}</span><b>${money(s.payoutUnits)}</b></li>`).join('')}</ol>`);};
$('#history').onclick=openHistory;
const openRules=()=>sheet(`<h3>${t('Правила','Rules')}</h3><p>${t('Совпадения считаются слева направо по активным линиям. Гигантский символ занимает 2×2 или 3×3 клетки. Залп увеличивает 2×2 до 3×3. Три части карты открывают выбор тактики.','Matches count from left to right on active lines. A giant symbol covers 2×2 or 3×3 cells. A broadside grows 2×2 to 3×3. Three map pieces open the tactics.')}</p><p>${t('Очки команды дают завершённые платные раунды. Пиратка меняет только внешний вид.','Finished paid rounds give crew points. A pirate changes the look only.')}</p>`);
$('#info').onclick=openRules;
const flipSound=()=>{$('#sound').setAttribute('aria-pressed',String(sound.toggle()));},flipMusic=async()=>{$('#music').setAttribute('aria-pressed',String(await sound.toggleMusic()));};
$('#sound').onclick=flipSound;$('#music').onclick=()=>void flipMusic();
$('#menu').onclick=()=>{const on=(id:string)=>$('#'+id).getAttribute('aria-pressed')==='true';sheet(`<h3>${t('Меню','Menu')}</h3><div class="grid two menu"><button data-q="sound" aria-pressed="${on('sound')}">${t('Звук','Sound')}</button><button data-q="music" aria-pressed="${on('music')}">${t('Музыка','Music')}</button><button data-q="lines">${t('Линии','Lines')} ${lines}</button><button data-q="history">${t('История','History')}</button><button data-q="rules">${t('Правила','Rules')}</button><button data-q="crew">${t('Карта плавания','Voyage map')}</button></div>`,el=>el.querySelectorAll<HTMLElement>('[data-q]').forEach(b=>b.onclick=()=>{const q=b.dataset.q;if(q==='sound'){flipSound();b.setAttribute('aria-pressed',String(on('sound')));}else if(q==='music'){void flipMusic().then(()=>b.setAttribute('aria-pressed',String(on('music'))));}else{closeSheet();(q==='lines'?openLines:q==='history'?openHistory:q==='rules'?openRules:()=>{if(!busy())void voyage.show();})();}}));};
$('#fund').onclick=()=>{balance+=10000;if(kind==='error'&&flow==='idle'){kind='';say='';}render();};
const press=()=>{if($('#spin').getAttribute('aria-disabled')==='true')return;sound.play('click');if(flow==='show'){if(performance.now()-shownAt>350)hurry();}else if(flow==='error')void ask(false);else void spin();};
$('#spin').onclick=press;$('#retry').onclick=()=>{void ask(false);$('#spin').focus({preventScroll:true});};
function hurry(){stage.clock.hurry=true;stage.fx.clear();}
$('#tap').onclick=()=>{if(stage.tour){stage.tour=null;say='';render();}else if(flow==='show'&&performance.now()-shownAt>350)hurry();};
$('#plate').onclick=$('#crewmini').onclick=()=>{if(!busy())void voyage.show();};
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('#sheet').hidden)closeSheet();else if(voyage.open)voyage.close();else if(stage.tour){stage.tour=null;say='';render();}});
/* Desk ------------------------------------------------------------------------------------------ */
function fit(){const d=$('#device'),k=Math.min(1,$('#desk').clientWidth/d.offsetWidth);d.style.transform=`scale(${k})`;$('#desk').style.height=d.offsetHeight*k+'px';d.style.marginLeft=Math.max(0,($('#desk').clientWidth-d.offsetWidth*k)/2)+'px';}
$<HTMLSelectElement>('#view').onchange=e=>{$('#device').dataset.view=(e.target as HTMLSelectElement).value;fit();layout();};
$<HTMLSelectElement>('#points').onchange=e=>{crew.points=Number((e.target as HTMLSelectElement).value);crew.met=new Set(CREW.slice(0,unlockedCount(crew.points)).map(m=>m.id));if(!crew.met.has(crew.selected)){crew.selected='isabella';void pirate.select('isabella');}renderCrew();if(voyage.open)voyage.close();};
$<HTMLSelectElement>('#force').onchange=e=>{const s=e.target as HTMLSelectElement;used[s.value]=-1;if(s.value==='reopen'){s.value='';void reopen();}else if(s.value!=='funds'&&balance<100000&&kind==='error')balance=100000,kind='',say='',render();};
$<HTMLSelectElement>('#language').onchange=e=>{lang.en=(e.target as HTMLSelectElement).value==='en';say='';if(!$('#cards').hidden)showCards();$('#host').textContent=t('Карибские сокровища','Caribbean Treasures');$('#hall').textContent=t('Все игры','All games');$('#chatb').textContent=t('Чат','Chat');layout();};
let rate=1;$<HTMLInputElement>('#slow').onchange=e=>{rate=(e.target as HTMLInputElement).checked?.35:1;};
const calm=$<HTMLInputElement>('#calm'),setCalm=()=>{const c=calm.checked;stage.clock.reduced=stage.fx.reduced=c;pirate.live=c?0:1;harbor.calm=c?0:1;game.classList.toggle('calm',c);};
calm.checked=matchMedia('(prefers-reduced-motion: reduce)').matches;calm.onchange=setCalm;setCalm();
if(innerWidth<600){$<HTMLSelectElement>('#view').value='phone';$('#device').dataset.view='phone';}
addEventListener('resize',()=>{fit();});
/* Wheel of the spin button: the ship's helm around the familiar red button. */
$('.wheel').innerHTML=Array.from({length:8},(_,i)=>`<g transform="rotate(${i*45})"><path d="M-4 -44h8l1.5-9a6 6 0 1 0-11 0z" fill="#7a4a24" stroke="#2c170a" stroke-width="1.4"/><circle cy="-55" r="4.6" fill="#b9823f" stroke="#2c170a" stroke-width="1.2"/><path d="M-2.4 -42l-1-8h2z" fill="#c79252"/></g>`).join('')+'<circle r="46" fill="none" stroke="#2c170a" stroke-width="9"/><circle r="46" fill="none" stroke="#d7a653" stroke-width="6"/><circle r="47.5" fill="none" stroke="#ffe9ad" stroke-width="1"/>'+Array.from({length:8},(_,i)=>`<circle transform="rotate(${i*45+22.5})" cy="-46" r="1.8" fill="#6b4312"/>`).join('');
let last=0;
function loop(now:number){
  requestAnimationFrame(loop);const raw=Math.min(.05,(now-last)/1000||.016);last=now;if(document.hidden)return;const dt=raw*rate;
  harbor.time+=dt;stage.step(dt);pirate.step(dt);stage.rock=stage.clock.reduced?0:harbor.storm*.0075*Math.sin(harbor.time*1.05);
  harbor.draw(L()?.W??1,L()?.H??1);stage.draw();pirate.draw();voyage.step(dt);
}
fit();layout();render();renderCrew();
Promise.all([harbor.load(),loadSymbols().then(()=>layout()),stage.load(),pirate.select('isabella')]).then(()=>{layout();$('#load').classList.add('off');setTimeout(()=>$('#load').remove(),600);}).catch(e=>{$('#load').textContent=t('Не удалось загрузить рисунки','The art did not load');console.error(e);});
requestAnimationFrame(loop);
(window as any).cv={stage,harbor,pirate,crew,voyage,spin,press,layout,get busy(){return busy();},get flow(){return flow;},get view(){return view;},get kind(){return kind;}};
