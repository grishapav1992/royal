import {randomInt} from 'node:crypto';
import {validCosmicStake} from '../../src/shared/cosmicEscapeBets';
import {VELVET_GAME,VELVET_INFO,VELVET_FACTORS,velvetEmptyFeatures} from '../../src/shared/velvetReign';
import {luelonSlotLineWins,validLuelonSlotSettings,validLuelonSlotSettlement,type LuelonSlotSettings,type LuelonSlotView,type LuelonSlotFeatures,type LuelonSlotBonus,type LuelonSlotSpin,type LuelonSlotEvent,type LuelonSlotResult} from '../../src/shared/luelonSlots';
import {LuelonSlotMoveError} from './luelonSlots';
import {VELVET_MATH as M} from './velvetMath';
type Random=(max:number)=>number;
const checked=(draw:Random):Random=>max=>{const value=draw(max);if(!Number.isSafeInteger(value)||value<0||value>=max)throw Error('Invalid Velvet randomness');return value;};
export function velvetWeighted(weights:readonly number[],random:Random){let n=random(weights.reduce((a,b)=>a+b,0));for(let i=0;i<weights.length;i++){if(n<weights[i])return i;n-=weights[i];}throw Error('Invalid Velvet weight');}
function addStar(features:LuelonSlotFeatures,random:Random){const available=[0,1,2,3,4].filter(c=>!features.wilds.some(w=>w.column===c));if(!available.length)throw Error('No free Velvet reel');features.wilds.push({column:available[random(available.length)],factor:VELVET_FACTORS[velvetWeighted(M.starWeights,random)]});}
function bonus(id:string,random:Random):LuelonSlotBonus{const features=velvetEmptyFeatures();if(id==='super-encore'){addStar(features,random);features.counters=[3,0];}return {id,remaining:10,awarded:10,played:0,limit:20,respins:0,features};}
const event=(kind:LuelonSlotEvent['kind'],positions:number[],value:number,before=0,after=value,label=''):LuelonSlotEvent=>({kind,positions,value,before,after,label,path:[]});
/** Draw only the next accepted stage. No future bonus results are stored or sent. */
export function velvetBoard(mode:string,features:LuelonSlotFeatures,bonusId:string|null,random:Random):number[]{
  const free=bonusId!==null,weights=free?M.freeOrdinaryWeights:M.baseOrdinaryWeights[mode as keyof typeof M.baseOrdinaryWeights];if(!weights)throw Error('Invalid Velvet mode');
  const raw=Array(20).fill(8) as number[];
  for(let c=0;c<5;c++)for(let r=0;r<4;r++){
    if(free&&features.wilds.some(w=>w.column===c))continue;
    const p=r*5+c,z=random(1000000),gem=free?M.freeGemPerMillion[bonusId as keyof typeof M.freeGemPerMillion]:0;
    raw[p]=z<gem?9:z<gem+(free?M.freeWildPerMillion:M.baseWildPerMillion)?8:velvetWeighted(weights,random);
  }
  if(!free){const chance=M.entryPerMillion*(mode==='booster'?3:mode==='hyper'?20:1),trigger=random(1000000)<chance;
    const count=trigger?(random(1000)<M.encorePerThousand?4:3):((n:number)=>n<600?0:n<950?1:2)(random(1000)),columns=[0,1,2,3,4];
    for(let i=0;i<count;i++){const col=columns.splice(random(columns.length),1)[0];raw[random(4)*5+col]=9;}
  }
  return raw;
}
export function velvetPlay(value:LuelonSlotView,stake:string,random:Random):LuelonSlotView{
  const view=structuredClone(value),free=!!view.bonus,before=structuredClone(view.bonus?.features??velvetEmptyFeatures()),after=structuredClone(before),raw=velvetBoard(view.mode,before,view.bonus?.id??null,random),grid=[...raw];
  const frameEvents=before.wilds.map(w=>{const positions=[0,1,2,3].map(r=>r*5+w.column);positions.forEach(p=>grid[p]=8);return event('sticky',positions,w.factor,0,w.factor,'Постоянная звезда WILD');});
  let paid=0n,uncapped=0n;const cap=BigInt(stake)*10000n,prior=BigInt(view.totalPayoutUnits);
  const wins=luelonSlotLineWins(VELVET_GAME,grid,before.wilds).map(w=>{const rawPay=BigInt(stake)*BigInt(w.payHundredths)*BigInt(w.factor)/100n,room=cap-prior-paid,pay=rawPay<room?rawPay:room;paid+=pay;uncapped+=rawPay;return {...w,payoutUnits:String(pay),uncappedPayoutUnits:String(rawPay)};});
  const capped=prior+paid===cap,events:LuelonSlotEvent[]=[],gems=grid.flatMap((x,p)=>x===9?[p]:[]);let grant=0;
  if(free){view.bonus!.played++;view.bonus!.remaining--;
    if(!capped&&before.wilds.length<5){after.counters[0]+=gems.length;after.counters[1]+=gems.length;
      while(after.counters[1]>=3&&after.wilds.length<5){after.counters[1]-=3;addStar(after,random);grant+=2;}
      if(after.wilds.length===5)after.counters[1]=0;
      view.bonus!.remaining+=grant;view.bonus!.awarded+=grant;
      events.push(event('collect',gems,gems.length,before.counters[0],after.counters[0],'Самоцветы приглашают звёзд'));
      if(grant)events.push(event('retrigger',[],grant,0,grant,'Новая звезда: дополнительные вращения'));
    }
  }else if(!capped&&gems.length>=3){view.bonus=bonus(gems.length>=4?'super-encore':'spotlight',random);Object.assign(after,view.bonus.features);grant=10;events.push(event('scatter',gems,10,0,10,'Занавес поднимается'));
  }
  if(view.bonus){view.bonus.features=after;if(capped)view.bonus.remaining=0;}
  const spin:LuelonSlotSpin={index:view.history.length,kind:free?'free-spin':'base',rows:4,initialGrid:raw,frames:[{index:0,gridBefore:raw,gridAfter:grid,wins,events:frameEvents,payoutUnits:String(paid),uncappedPayoutUnits:String(uncapped),removed:[],drops:[],refills:[]}],finalGrid:grid,payoutUnits:String(paid),uncappedPayoutUnits:String(uncapped),triggerAwards:grant,featuresBefore:before,featuresAfter:after,events,stopReason:capped?'win-cap':'complete'};
  view.history.push(spin);view.spin=spin;view.revision=view.history.length;view.totalPayoutUnits=String(prior+paid);view.capped=capped;view.phase=view.bonus?.remaining?'bonus':'complete';return view;
}
function result(view:LuelonSlotView,stake:string):LuelonSlotResult{const ended=view.phase==='complete',cost=VELVET_INFO.modes.find(m=>m.id===view.mode)!.cost,credit=ended?Number(view.totalPayoutUnits):0;
  if(!validLuelonSlotSettlement(VELVET_GAME,ended?'settled':'active',stake,String(BigInt(stake)*BigInt(cost)),ended?String(credit):'0',view))throw Error('Invalid generated Velvet result');
  return {luelon:view,ended,credit,message:ended?'Раунд завершён. Общая выплата зачислена.':'Серия сохранена. Продолжение бесплатно.',actions:ended?[]:[{move:'luelon-spin',label:'Продолжить выступление',cost:0}]};
}
export function startVelvet(settings:LuelonSlotSettings,stake:string,draw:Random=randomInt):LuelonSlotResult{
  if(!validCosmicStake(stake)||!validLuelonSlotSettings(VELVET_GAME,settings))throw Error('Invalid Velvet start');const random=checked(draw),mode=VELVET_INFO.modes.find(m=>m.id===settings.luelon.mode)!;
  const view:LuelonSlotView={kind:'luelon-slot',version:2,gameId:VELVET_GAME,mode:mode.id,phase:mode.bonus?'bonus':'complete',revision:0,decisions:[],spin:null,history:[],bonus:mode.bonus?bonus(mode.id,random):null,totalPayoutUnits:'0',capped:false};
  return result(mode.bonus?view:velvetPlay(view,stake,random),stake);
}
export function moveVelvet(value:unknown,stake:string,revision:unknown,move:string,picks:number[]|undefined,draw:Random=randomInt):LuelonSlotResult{
  const view=value as LuelonSlotView;
  if(!validCosmicStake(stake)||!view||!validLuelonSlotSettings(VELVET_GAME,{luelon:{mode:view.mode}})||!validLuelonSlotSettlement(VELVET_GAME,'active',stake,String(BigInt(stake)*BigInt(VELVET_INFO.modes.find(m=>m.id===view.mode)!.cost)),'0',view))throw Error('Invalid saved Velvet state');
  if(revision!==view.revision)throw new LuelonSlotMoveError('Этап уже изменился. Проверь сохранённую игру.');
  if(move!=='luelon-spin'||picks!==undefined||view.phase!=='bonus')throw new LuelonSlotMoveError('Этот ход сейчас недоступен.');
  return result(velvetPlay(view,stake,checked(draw)),stake);
}
