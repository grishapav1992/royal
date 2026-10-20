import {startVelvet,moveVelvet} from './velvetReign';
import {randomInt} from 'node:crypto';
import {DEMO_BETS} from '../../src/shared/demoWallet';
import {validCosmicStake} from '../../src/shared/cosmicEscapeBets';
import {getLuelonSlotRules,LUELON_SLOT_PROFILES,COSMIC_MATH_ENTRY_PER_MILLION,COSMIC_MATH_PROFILE_VERSION,type CosmicMathProfileVersion,type SlotRules} from '../../src/shared/luelonSlotsModels';
import {luelonSlotLineWins,luelonSlotInitialCost,validLuelonSlotSettings,validLuelonSlotSettlement,type LuelonSlotGameId,type LuelonSlotSettings,type LuelonSlotView,type LuelonSlotFeatures,type LuelonSlotBonus,type LuelonSlotEvent,type LuelonSlotFrame,type LuelonSlotSpin,type LuelonSlotResult} from '../../src/shared/luelonSlots';
export class LuelonSlotMoveError extends Error {}
type Random=(max:number)=>number;
function checked(draw:Random):Random{return(max)=>{const value=draw(max);if(!Number.isSafeInteger(value)||value<0||value>=max)throw Error('Invalid full slot randomness');return value;};}
function allowedStake(game:LuelonSlotGameId|undefined,stake:string){if(game==='studio-cosmic-escape'?!validCosmicStake(stake):!(DEMO_BETS as readonly number[]).some(n=>String(n*100)===stake))throw Error('Invalid full slot stake');}
function features(rule:SlotRules):LuelonSlotFeatures{return {multiplier:1,wilds:[],charges:[],counters:[0,0],held:[],chosenSymbol:null,route:0,rows:rule.info.rows,heights:Array(rule.info.cols).fill(rule.info.rows)};}
function event(kind:LuelonSlotEvent['kind'],positions:number[],value:number,before=0,after=value,label:string=kind,path:number[]=[]):LuelonSlotEvent{return {kind,positions,value,before,after,label,path};}
function bonus(rule:SlotRules,id:string,spins:number,_random:Random):LuelonSlotBonus {const state=features(rule);if(id==='deep-echo')state.multiplier=3;return {id,remaining:spins,awarded:spins,played:0,limit:rule.bonusLimit,respins:0,features:state};}
function rawBoard(rule:SlotRules,mode:string,free:boolean,random:Random,bonusId='',profile:CosmicMathProfileVersion=COSMIC_MATH_PROFILE_VERSION):number[]{
  const cells=rule.info.cols*rule.info.rows,grid=Array.from({length:cells},()=>random(rule.ordinary));
  const wildChance=free?20:3;for(let pos=0;pos<cells;pos++)if(random(1000)<wildChance)grid[pos]=rule.wild;
  if(!free){
    const trigger=random(1000000)<COSMIC_MATH_ENTRY_PER_MILLION[profile],roll=trigger?random(100):0;
    const count=trigger?(roll<5?5:roll<20?4:3):random(3),pool=Array.from({length:rule.info.cols},(_,i)=>i);
    for(let i=0;i<count;i++){const col=pool.splice(random(pool.length),1)[0];grid[random(rule.info.rows)*rule.info.cols+col]=rule.scatter;}
  }else for(let col=0;col<rule.info.cols;col++)if(random(1000)<8)grid[random(rule.info.rows)*rule.info.cols+col]=rule.scatter;
  return grid;
}
function frame(rule:SlotRules,raw:number[],state:LuelonSlotFeatures,free:boolean,mode:string,random:Random,index:number,echo=false):LuelonSlotFrame {
  const grid=[...raw],events:LuelonSlotEvent[]=[],wilds=[...state.wilds];let global=1;
  if(rule.feature==='cosmic'&&free){
    if(!echo&&random(100)<25){const roll=random(1000),increment=roll<800?1:roll<900?2:roll<950?3:roll<980?5:roll<995?10:roll<999?25:50,before=state.multiplier;state.multiplier=Math.min(50,state.multiplier+increment);events.push(event('energy',[],state.multiplier-before,before,state.multiplier,'Энергия миссии'));}
    global=state.multiplier;
    const beams=LUELON_SLOT_PROFILES.cosmicBeamAttempts[mode as keyof typeof LUELON_SLOT_PROFILES.cosmicBeamAttempts]??1;
    const beamChance=LUELON_SLOT_PROFILES.cosmicBeamPerThousand[mode as keyof typeof LUELON_SLOT_PROFILES.cosmicBeamPerThousand]??346;
    for(let n=0;n<beams;n++)if(random(1000)<beamChance){const column=random(rule.info.cols);if(wilds.some(w=>w.column===column))continue;const positions=Array.from({length:rule.info.rows},(_,row)=>row*rule.info.cols+column);positions.forEach(pos=>grid[pos]=rule.wild);wilds.push({column,factor:state.multiplier});events.push(event('expand',positions,state.multiplier,0,state.multiplier,'Звёздный луч'));}
    if(echo){global=state.multiplier;events.push(event('echo',Array.from({length:grid.length},(_,i)=>i),global,0,global,'Второй отголосок'));}
  }
  for(const wild of wilds){const positions=Array.from({length:rule.info.rows},(_,row)=>row*rule.info.cols+wild.column);positions.forEach(pos=>grid[pos]=rule.wild);if(!events.some(e=>e.kind==='expand'&&e.positions[0]%rule.info.cols===wild.column))events.push(event('sticky',positions,wild.factor,0,wild.factor,'Постоянный WILD'));}
  const scoringWilds=rule.feature==='cosmic'?[]:wilds;
  const wins=luelonSlotLineWins(rule.info.id,grid,scoringWilds,global).map(win=>({...win,uncappedPayoutUnits:'0',payoutUnits:'0'}));
  return {index,gridBefore:raw,gridAfter:grid,wins,events,payoutUnits:'0',uncappedPayoutUnits:'0',removed:[],drops:[],refills:[]};
}
function pay(rule:SlotRules,frames:LuelonSlotFrame[],stake:string,prior:string){let total=0n,raw=0n;const cap=BigInt(stake)*BigInt(Math.round(rule.info.maxWin*100))/100n;
  for(const frame of frames){let framePaid=0n,frameRaw=0n;for(const win of frame.wins){const amount=BigInt(stake)*BigInt(win.payHundredths)*BigInt(win.factor)/100n,remaining=cap-BigInt(prior)-total-framePaid,award=amount<remaining?amount:remaining;win.uncappedPayoutUnits=String(amount);win.payoutUnits=String(award);framePaid+=award;frameRaw+=amount;}frame.payoutUnits=String(framePaid);frame.uncappedPayoutUnits=String(frameRaw);total+=framePaid;raw+=frameRaw;}
  return {paid:total,raw,capped:BigInt(prior)+total===cap};
}
function play(value:LuelonSlotView,stake:string,random:Random,profile:CosmicMathProfileVersion=COSMIC_MATH_PROFILE_VERSION):LuelonSlotView {
  const view=structuredClone(value),rule=getLuelonSlotRules(view.gameId),free=!!view.bonus,priorFeatures=view.bonus?.features??features(rule),before=structuredClone(priorFeatures),state=structuredClone(priorFeatures),raw=rawBoard(rule,view.mode,free,random,view.bonus?.id,profile),frames=[frame(rule,raw,state,free,view.bonus?.id??view.mode,random,0)],events:LuelonSlotEvent[]=[];
  const firstPayment=pay(rule,frames,stake,view.totalPayoutUnits);
  if(!firstPayment.capped&&rule.feature==='cosmic'&&free&&random(100)<(LUELON_SLOT_PROFILES.cosmicEchoPerHundred[view.bonus!.id as keyof typeof LUELON_SLOT_PROFILES.cosmicEchoPerHundred]??3))frames.push(frame(rule,rawBoard(rule,view.mode,true,random),state,true,view.bonus!.id,random,1,true));
  const payment=pay(rule,frames,stake,view.totalPayoutUnits),finalGrid=frames[frames.length-1].gridAfter;let grant=0;
  if(view.bonus){view.bonus.played++;view.bonus.remaining--;}
  if(!payment.capped&&!free&&rule.trigger){const count=raw.filter(symbol=>symbol===rule.scatter).length;if(count>=rule.trigger){const id=rule.feature==='velvet'?(count>=4?'super-encore':'spotlight'):'cosmic-chaos',spins=rule.feature==='cosmic'?(count>=5?15:count===4?12:10):10;view.bonus=bonus(rule,id,spins,random);grant=spins;Object.assign(state,view.bonus.features);events.push(event('scatter',raw.flatMap((s,pos)=>s===rule.scatter?[pos]:[]),spins,0,spins,'Бесплатная серия'));}}
  if(view.bonus)view.bonus.features=state;
  if(payment.capped&&view.bonus){view.bonus.remaining=0;view.bonus.respins=0;}
  const spin:LuelonSlotSpin={index:view.history.length,kind:free?'free-spin':'base',rows:rule.info.rows,initialGrid:raw,frames,finalGrid,payoutUnits:String(payment.paid),uncappedPayoutUnits:String(payment.raw),triggerAwards:grant,featuresBefore:before,featuresAfter:state,events,stopReason:payment.capped?'win-cap':'complete'};
  view.history.push(spin);view.spin=spin;view.revision=view.history.length+view.decisions.length;view.totalPayoutUnits=String(BigInt(view.totalPayoutUnits)+payment.paid);view.capped=payment.capped;view.phase=view.bonus&&(view.bonus.remaining||view.bonus.respins)?'bonus':'complete';return view;
}
function result(view:LuelonSlotView,stake:string):LuelonSlotResult {const ended=view.phase==='complete',spent=String(BigInt(stake)*BigInt(luelonSlotInitialCost(view.gameId,{luelon:{mode:view.mode}}))),credit=ended?Number(view.totalPayoutUnits):0;if(!validLuelonSlotSettlement(view.gameId,ended?'settled':'active',stake,spent,ended?String(credit):'0',view))throw Error('Invalid generated full slot state');return {luelon:view,ended,credit,message:ended?'Раунд завершён, общая выплата начислена':'Бесплатная серия сохранена, новая ставка не нужна',actions:ended?[]:[{move:view.phase==='choice'?'luelon-pick':'luelon-spin',label:view.phase==='choice'?'Выбрать символ':'Продолжить бесплатную серию',cost:0,...(view.phase==='choice'?{minPicks:1,maxPicks:1}:{})}]};}
export function startLuelonSlotGame(game:LuelonSlotGameId,settings:LuelonSlotSettings,stake:string,draw:Random=randomInt,profile:CosmicMathProfileVersion=COSMIC_MATH_PROFILE_VERSION):LuelonSlotResult {
  if(game==='studio-velvet-reign')return startVelvet(settings,stake,draw);
  allowedStake(game,stake);if(!validLuelonSlotSettings(game,settings)||!Object.hasOwn(COSMIC_MATH_ENTRY_PER_MILLION,profile))throw Error('Invalid full slot settings');const rule=getLuelonSlotRules(game),random=checked(draw);const mode=rule.info.modes.find(mode=>mode.id===settings.luelon.mode)!,view:LuelonSlotView={kind:'luelon-slot',version:2,gameId:game,mode:mode.id,phase:mode.bonus?'bonus':'complete',revision:0,decisions:[],spin:null,history:[],bonus:mode.bonus?bonus(rule,mode.bonus,mode.spins,random):null,totalPayoutUnits:'0',capped:false};return result(mode.bonus?view:play(view,stake,random,profile),stake);
}
export function moveLuelonSlotGame(value:unknown,stake:string,revision:unknown,move:string,picks:number[]|undefined,draw:Random=randomInt):LuelonSlotResult {
  if((value as LuelonSlotView)?.gameId==='studio-velvet-reign')return moveVelvet(value,stake,revision,move,picks,draw);
  const view=value as LuelonSlotView;allowedStake(view?.gameId,stake);if(!view||!validLuelonSlotSettlement(view.gameId,'active',stake,String(BigInt(stake)*BigInt(luelonSlotInitialCost(view.gameId,{luelon:{mode:view.mode}}))),'0',view))throw Error('Invalid saved full slot state');if(revision!==view.revision)throw new LuelonSlotMoveError('Этап уже изменился. Обнови сохранённую игру.');if(move!=='luelon-spin'||picks!==undefined||view.phase!=='bonus')throw new LuelonSlotMoveError('Этот ход сейчас недоступен.');return result(play(view,stake,checked(draw)),stake);
}
export {features as slotFeatures,event as slotEvent,pay as slotPay,result as slotResult};
