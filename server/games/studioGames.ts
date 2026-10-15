import {randomInt} from 'node:crypto';
import {STUDIO_INFO,studioSlotProgram,studioPayFrame,studioSlotHasBonus,studioRiskThreshold,studioRiskMax,studioRiskMultiplier,studioMinesMultiplier,studioKenoMultiplier,studioDiceMultiplier,studioPlinkoTable,studioWheelSegments,studioWheelMultiplier,studioPaid,validStudioSettings,studioStrip,studioBaseFrame,studioBonusFrame,studioSlotPresentationDetails,studioCascadePresentationDetails,studioClusterPresentationDetails,isStudioCascadePresentationGame,isStudioClusterPresentationGame,isStudioPresentationGame,type StudioGameId,type StudioSettings,type StudioView,type StudioSlotView,type StudioSlotFrame,type StudioRiskView,type StudioPresentationGameId,type StudioSlotPresentationFrame} from '../../src/shared/studioGames';
import {DEMO_BETS} from '../../src/shared/demoWallet';

type SlotState={kind:'studio-slot';stops:number[];seeds:number[];step:number;ended:boolean};
type RiskState={kind:'studio-risk';dice:number[];history:StudioRiskView['history'];ended:boolean};
type MinesState={kind:'studio-mines';mines:number[];opened:number[];ended:boolean};
export type StudioState=SlotState|RiskState|MinesState;
export type StudioResult={engine?:StudioState;studio:StudioView;ended:boolean;credit:number;message:string};
export class StudioMoveError extends Error {}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value:Record<string,unknown>,keys:string)=>Object.keys(value).sort().join()===keys.split(',').sort().join();
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const array=(value:unknown,count:number,min:number,max:number):value is number[]=>Array.isArray(value)&&value.length===count&&value.every(n=>integer(n,min,max));
function stake(value:string){if(!(DEMO_BETS as readonly number[]).some(n=>String(n*100)===value))throw Error('Invalid studio stake');}
function credit(value:string):number {const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid studio payout');return n;}
function pool(length:number,count:number,draw:(max:number)=>number):number[]{const values=Array.from({length},(_,i)=>i);return Array.from({length:count},()=>values.splice(draw(values.length),1)[0]);}
function slotView(game:StudioGameId,engine:SlotState,stakeUnits:string):StudioSlotView {
  const raw=studioSlotProgram(game,engine.stops,engine.seeds);if(engine.step>=raw.length)throw Error('Invalid private studio slot step');
  const history=raw.slice(0,engine.step+1).map(frame=>studioPayFrame(game,frame,stakeUnits)),last=history[history.length-1];
  const remaining=!studioSlotHasBonus(game,raw[0])||engine.step===2||STUDIO_INFO[game].features.includes('tumble')&&engine.step>0&&!last.wins.length?0:2-engine.step;
  return {kind:'slot',cols:STUDIO_INFO[game].cols,rows:STUDIO_INFO[game].rows,grid:last.grid,wins:last.wins,history,stage:last.stage,step:engine.step,remaining,maxSteps:3,held:last.held,totalPayoutUnits:history.reduce((sum,frame)=>sum+BigInt(frame.payoutUnits),0n).toString()};
}
function riskView(game:StudioGameId,engine:RiskState,stakeUnits:string):StudioRiskView {const steps=engine.history.filter(item=>item.safe).length,lost=engine.history.some(item=>!item.safe),multiplier=lost?0:studioRiskMultiplier(game,steps);return {kind:STUDIO_INFO[game].kind as 'flight'|'crash',history:structuredClone(engine.history),steps,maxSteps:studioRiskMax(game),multiplier,cashoutUnits:studioPaid(stakeUnits,multiplier)};}
function minesView(engine:MinesState,stakeUnits:string):Extract<StudioView,{kind:'mines'}> {const lost=engine.opened.some(i=>engine.mines.includes(i)),steps=engine.opened.length-Number(lost),multiplier=lost?0:studioMinesMultiplier(steps);return {kind:'mines',cells:Array.from({length:16},(_,i)=>engine.ended?(engine.mines.includes(i)?'mine':'safe'):engine.opened.includes(i)?'safe':'hidden'),opened:[...engine.opened],steps,maxSteps:6,multiplier,cashoutUnits:studioPaid(stakeUnits,multiplier)};}
function checkedState(game:StudioGameId,value:unknown):StudioState {
  if(!record(value)||typeof value.ended!=='boolean')throw Error('Invalid private studio state');const kind=STUDIO_INFO[game].kind;
  if(kind==='slot'){if(!fields(value,'kind,stops,seeds,step,ended')||value.kind!=='studio-slot'||!array(value.stops,STUDIO_INFO[game].cols,0,5)||!array(value.seeds,2,0,5)||!integer(value.step,0,2))throw Error('Invalid private studio slot');}
  else if(kind==='crash'||kind==='flight'){if(!fields(value,'kind,dice,history,ended')||value.kind!=='studio-risk'||!array(value.dice,studioRiskMax(game),1,6)||!Array.isArray(value.history)||value.history.length>studioRiskMax(game))throw Error('Invalid private studio risk');let lost=false;for(let i=0;i<value.history.length;i++){const item=value.history[i];if(!record(item)||!fields(item,'safe,threshold')||item.threshold!==studioRiskThreshold(game)||item.safe!==((value.dice as number[])[i]>=studioRiskThreshold(game))||lost)throw Error('Invalid private studio history');if(!item.safe)lost=true;}}
  else if(kind==='mines'){if(!fields(value,'kind,mines,opened,ended')||value.kind!=='studio-mines'||!array(value.mines,4,0,15)||new Set(value.mines).size!==4||!Array.isArray(value.opened)||value.opened.length>6||!array(value.opened,value.opened.length,0,15)||new Set(value.opened).size!==value.opened.length||value.opened.slice(0,-1).some(i=>(value.mines as number[]).includes(i)))throw Error('Invalid private studio mines');}
  else throw Error('Studio instant game has no private state');return structuredClone(value) as StudioState;
}
/** Only reconstructs the current and past frames; unplayed bonus seeds are never used. */
export function currentStudioSlotPresentation(game:StudioPresentationGameId,value:unknown):StudioSlotPresentationFrame {
  if(!isStudioPresentationGame(game))throw Error('Unsupported studio presentation');
  const engine=checkedState(game,value);if(engine.kind!=='studio-slot')throw Error('Invalid studio presentation state');
  if(isStudioCascadePresentationGame(game)){
    let frame=studioBaseFrame(game,engine.stops),previous:typeof frame|null=null;
    for(let step=1;step<=engine.step;step++){
      if(!frame.wins.length)throw Error('Invalid studio presentation step');
      previous=frame;frame=studioBonusFrame(game,frame,engine.seeds[step-1],step);
    }
    return studioCascadePresentationDetails(game,previous,frame,engine.step);
  }
  const info=STUDIO_INFO[game];let before=Array.from({length:info.cols*info.rows},(_,i)=>studioStrip(game,i%info.cols)[(engine.stops[i%info.cols]+Math.floor(i/info.cols))%6]);
  let frame=studioBaseFrame(game,engine.stops),heldBefore:number[]=[];
  for(let step=1;step<=engine.step;step++){
    if(!studioSlotHasBonus(game,studioBaseFrame(game,engine.stops)))throw Error('Invalid studio presentation step');
    const seed=engine.seeds[step-1];heldBefore=[...frame.held];
    before=Array.from({length:info.cols*info.rows},(_,i)=>{const column=i%info.cols,row=Math.floor(i/info.cols);return studioStrip(game,column)[(seed*(column+1)+row+step+column)%6];});
    frame=studioBonusFrame(game,frame,seed,step);
  }
  return isStudioClusterPresentationGame(game)?studioClusterPresentationDetails(game,frame,engine.step):studioSlotPresentationDetails(game,before,frame,engine.step,heldBefore);
}
export function startStudioGame(game:StudioGameId,settings:StudioSettings,stakeUnits:string,draw:(max:number)=>number=randomInt):StudioResult {
  stake(stakeUnits);if(!validStudioSettings(game,settings))throw Error('Invalid studio settings');const random=(max:number)=>{const n=draw(max);if(!integer(n,0,max-1))throw Error('Invalid studio randomness');return n;};
  switch(STUDIO_INFO[game].kind){
    case 'slot':{const engine:SlotState={kind:'studio-slot',stops:Array.from({length:STUDIO_INFO[game].cols},()=>random(6)),seeds:[random(6),random(6)],step:0,ended:false},studio=slotView(game,engine,stakeUnits);engine.ended=studio.remaining===0;return {engine,studio,ended:engine.ended,credit:engine.ended?credit(studio.totalPayoutUnits):0,message:engine.ended?'Вращение завершено':'Начисление сохранено. Продолжи бесплатный бонус'};}
    case 'crash':case 'flight':{const engine:RiskState={kind:'studio-risk',dice:Array.from({length:studioRiskMax(game)},()=>random(6)+1),history:[],ended:false};return {engine,studio:riskView(game,engine,stakeUnits),ended:false,credit:0,message:'Пройди первый этап, затем можно забрать выплату'};}
    case 'mines':{const engine:MinesState={kind:'studio-mines',mines:pool(16,4,random),opened:[],ended:false};return {engine,studio:minesView(engine,stakeUnits),ended:false,credit:0,message:'Открой безопасную ячейку'};}
    case 'keno':{const {numbers,target}=settings.studio as {numbers:number[];target:2|3},drawn=pool(20,5,random).map(n=>n+1),hits=drawn.filter(n=>numbers.includes(n)).length,won=hits>=target,multiplier=studioKenoMultiplier(target);return {studio:{kind:'keno',numbers:[...numbers].sort((a,b)=>a-b),drawn,target,hits,won,multiplier},ended:true,credit:won?credit(studioPaid(stakeUnits,multiplier)):0,message:'Совпадений: '+hits};}
    case 'plinko':{const {risk}=settings.studio as {risk:'low'|'medium'|'high'},path=Array.from({length:12},()=>random(2)),bucket=path.reduce((a,b)=>a+b,0),table=studioPlinkoTable(risk),multiplier=table[bucket];return {studio:{kind:'plinko',risk,path,bucket,table,multiplier},ended:true,credit:credit(studioPaid(stakeUnits,multiplier)),message:'Шарик попал в лунку '+bucket};}
    case 'dice':{const {chance,direction}=settings.studio as {chance:25|50|75;direction:'under'|'over'},roll=random(100),won=direction==='under'?roll<chance:roll>=100-chance,multiplier=studioDiceMultiplier(chance);return {studio:{kind:'dice',chance,direction,roll,won,multiplier},ended:true,credit:won?credit(studioPaid(stakeUnits,multiplier)):0,message:'Результат: '+roll};}
    case 'wheel':{const {target}=settings.studio as {target:0|1|2|3},segments=studioWheelSegments(game),sector=random(segments.length),won=segments[sector]===target,multiplier=studioWheelMultiplier(game,target);return {studio:{kind:'wheel',target,sector,segments,won,multiplier},ended:true,credit:won?credit(studioPaid(stakeUnits,multiplier)):0,message:'Сектор: '+segments[sector]};}
  }
}
export function moveStudioGame(game:StudioGameId,value:unknown,move:string,picks:number[]|undefined,stakeUnits:string):StudioResult {
  stake(stakeUnits);const engine=checkedState(game,value);if(engine.ended)throw new StudioMoveError('Эта партия уже завершена.');
  if(engine.kind==='studio-slot'){const current=slotView(game,engine,stakeUnits);if(move!=='studio-spin'||picks!==undefined||!current.remaining)throw new StudioMoveError('Бесплатное вращение сейчас недоступно.');engine.step++;const studio=slotView(game,engine,stakeUnits);engine.ended=studio.remaining===0;return {engine,studio,ended:engine.ended,credit:engine.ended?credit(studio.totalPayoutUnits):0,message:engine.ended?'Бонус завершён, общая выплата начислена':'Продолжи бесплатный бонус без новой ставки'};}
  if(engine.kind==='studio-risk'){if(picks!==undefined||!['studio-advance','cashout'].includes(move)||engine.history.some(item=>!item.safe)||engine.history.length===studioRiskMax(game))throw new StudioMoveError('Этот этап недоступен.');if(move==='cashout'){if(!engine.history.length)throw new StudioMoveError('Сначала пройди первый этап.');engine.ended=true;}else{const safe=engine.dice[engine.history.length]>=studioRiskThreshold(game);engine.history.push({safe,threshold:studioRiskThreshold(game)});engine.ended=!safe||engine.history.length===studioRiskMax(game);}const studio=riskView(game,engine,stakeUnits);return {engine,studio,ended:engine.ended,credit:engine.ended?credit(studio.cashoutUnits):0,message:engine.ended?(studio.multiplier?'Выплата начислена':'Попытка завершилась неудачей'):'Этап пройден. Продолжить или забрать?'};}
  if(!['reveal','cashout'].includes(move)||engine.opened.some(i=>engine.mines.includes(i))||engine.opened.length===6)throw new StudioMoveError('Этот ход недоступен.');
  if(move==='cashout'){if(picks!==undefined||!engine.opened.length)throw new StudioMoveError('Сначала открой безопасную ячейку.');engine.ended=true;}else{if(!array(picks,1,0,15)||engine.opened.includes(picks[0]))throw new StudioMoveError('Выбери одну закрытую ячейку.');engine.opened.push(picks[0]);engine.ended=engine.mines.includes(picks[0])||engine.opened.length===6;}
  const studio=minesView(engine,stakeUnits);return {engine,studio,ended:engine.ended,credit:engine.ended?credit(studio.cashoutUnits):0,message:engine.ended?(studio.multiplier?'Выплата начислена':'Найдена ловушка'):'Ячейка безопасна. Продолжить или забрать?'};
}
