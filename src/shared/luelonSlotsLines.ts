import {getLuelonSlotRules,LUELON_SLOT_PROFILES} from './luelonSlotsModels';
import {luelonSlotLineWins,luelonSlotSame,type LuelonSlotView,type LuelonSlotSpin,type LuelonSlotFeatures,type LuelonSlotWild} from './luelonSlots';
const factors=[2,3,4,5,8,10,20,50,100],increments=[1,2,3,5,10,25,50];
function same(a:unknown,b:unknown){return luelonSlotSame(a,b);}
function empty(state:LuelonSlotFeatures){return state.multiplier===1&&!state.wilds.length&&!state.charges.length&&!state.held.length&&state.chosenSymbol===null&&state.route===0&&same(state.counters,[0,0]);}
function star(wild:LuelonSlotWild){return factors.includes(wild.factor);}
export function validLuelonLineHistory(view:LuelonSlotView):boolean {
  const rule=getLuelonSlotRules(view.gameId),info=rule.info,mode=info.modes.find(m=>m.id===view.mode)!;let awarded=mode.bonus?mode.spins:0,played=0,bonusId=mode.bonus;
  if(rule.feature==='neon'&&(view.history.length!==1||view.bonus!==null||view.history[0].kind!=='base'||view.phase!=='complete'))return false;
  for(let index=0;index<view.history.length;index++){
    const spin=view.history[index],atCap=spin.stopReason==='win-cap',base=index===0&&!mode.bonus,before=spin.featuresBefore,after=spin.featuresAfter;if(spin.kind!==(base?'base':'free-spin')||spin.rows!==info.rows||before.rows!==info.rows||after.rows!==info.rows||!same(before.heights,Array(info.cols).fill(info.rows))||!same(after.heights,Array(info.cols).fill(info.rows))||spin.frames.length>(rule.feature==='cosmic'&&!base?2:1)||base&&!empty(before)||!base&&played>=awarded)return false;
    if(rule.feature==='cosmic'&&index===0&&mode.bonus&&(!empty({...before,multiplier:1})||before.multiplier!==mode.startMultiplier))return false;
    if(!base)played++;if(!same(before.charges,[])||!same(after.charges,[])||!same(before.held,[])||!same(after.held,[])||before.chosenSymbol!==null||after.chosenSymbol!==null||before.route||after.route)return false;
    let energy=before.multiplier;
    for(let step=0;step<spin.frames.length;step++){
      const frame=spin.frames[step];if(frame.removed.length||frame.drops.length||frame.refills.length)return false;const transformed=[...frame.gridBefore],wilds:LuelonSlotWild[]=[];let global=1,energyEvents=0,echoEvents=0;
      for(const event of frame.events){
        if(rule.feature==='cosmic'&&!base&&event.kind==='energy'){
          if(step||energyEvents++||frame.events[0]!==event||event.positions.length||event.path.length||event.before!==energy||!increments.some(n=>Math.min(50,energy+n)===event.after)||event.value!==event.after-event.before)return false;energy=event.after;
        }else if(rule.feature==='cosmic'&&!base&&event.kind==='echo'){
          if(step!==1||echoEvents++||event.value!==energy||event.after!==energy||event.before!==0||event.positions.length!==transformed.length||!event.positions.every((pos,i)=>pos===i)||event.path.length)return false;global=event.value;
        }else if((rule.feature==='cosmic'&&!base&&event.kind==='expand')||(rule.feature==='velvet'&&!base&&event.kind==='sticky')){
          if(event.positions.length!==info.rows||event.path.length||event.before!==0||event.after!==event.value)return false;const col=event.positions[0]%info.cols;if(wilds.some(w=>w.column===col)||!same(event.positions,Array.from({length:info.rows},(_,row)=>row*info.cols+col)))return false;
          if(rule.feature==='cosmic'&&event.value!==energy)return false;if(rule.feature==='velvet'&&!before.wilds.some(w=>w.column===col&&w.factor===event.value))return false;
          wilds.push({column:col,factor:event.value});event.positions.forEach(pos=>transformed[pos]=rule.wild);
        }else return false;
      }
      if(step===1&&echoEvents!==1||rule.feature==='velvet'&&!same([...wilds].sort((a,b)=>a.column-b.column),[...before.wilds].sort((a,b)=>a.column-b.column))||!same(frame.gridAfter,transformed))return false;
      if(rule.feature==='cosmic'&&!base){global=energy;if(wilds.length>(LUELON_SLOT_PROFILES.cosmicBeamAttempts[bonusId as keyof typeof LUELON_SLOT_PROFILES.cosmicBeamAttempts]??1))return false;}
      const scoringWilds=rule.feature==='cosmic'?[]:wilds;
      const expected=luelonSlotLineWins(view.gameId,frame.gridAfter,scoringWilds,global),actual=frame.wins.map(({payoutUnits:_,uncappedPayoutUnits:__,...win})=>win);if(!same(expected,actual))return false;
      if(rule.feature==='cosmic')for(let col=0;col<info.cols;col++)if(frame.gridBefore.filter((symbol,pos)=>pos%info.cols===col&&symbol===rule.scatter).length>1)return false;
    }
    if(rule.feature==='neon'){if(!empty(after)||spin.events.length||spin.triggerAwards)return false;continue;}
    const gems=spin.frames[0].gridAfter.flatMap((symbol,pos)=>symbol===rule.scatter?[pos]:[]);
    if(base){
      const grant=gems.length>=rule.trigger?(rule.feature==='cosmic'?(gems.length>=5?15:gems.length===4?12:10):10):0;
      if(spin.triggerAwards!==(atCap?0:grant))return false;
      if(grant&&!atCap){awarded=grant;bonusId=rule.feature==='cosmic'?'cosmic-chaos':gems.length>=4?'super-encore':'spotlight';if(spin.events.length!==1||spin.events[0].kind!=='scatter'||!same(spin.events[0].positions,gems)||spin.events[0].value!==grant||spin.events[0].before!==0||spin.events[0].after!==grant||spin.events[0].path.length)return false;
        if(bonusId==='super-encore'){if(after.multiplier!==1||after.wilds.length!==1||!star(after.wilds[0])||!same(after.counters,[3,0]))return false;}else if(!empty(after))return false;
      }else if(spin.events.length||!empty(after))return false;
    }else if(rule.feature==='cosmic'){
      if(spin.events.length||spin.triggerAwards||after.multiplier!==energy||after.wilds.length||!same(after.counters,before.counters))return false;
    }else if(rule.feature==='velvet'){
      if(!before.wilds.every(star)||!after.wilds.every(star)||after.wilds.length>5||!before.wilds.every((wild,i)=>same(after.wilds[i],wild))||before.multiplier!==1||after.multiplier!==1)return false;
      const collectible=before.wilds.length<5&&!atCap?gems.length:0,needed=Math.min(5-before.wilds.length,Math.floor((before.counters[1]+collectible)/3)),newStars=after.wilds.length-before.wilds.length,grant=Math.min(needed*2,rule.bonusLimit-awarded);
      if(newStars!==needed||after.counters[0]!==before.counters[0]+collectible||after.counters[1]!==before.counters[1]+collectible-needed*3||spin.triggerAwards!==grant)return false;awarded+=grant;
      if(before.wilds.length<5&&!atCap){const collect=spin.events[0];if(!collect||collect.kind!=='collect'||!same(collect.positions,gems)||collect.value!==collectible||collect.before!==before.counters[0]||collect.after!==after.counters[0]||collect.path.length||spin.events.length!==(grant?2:1))return false;if(grant){const retrigger=spin.events[1];if(retrigger.kind!=='retrigger'||retrigger.value!==grant||retrigger.before!==0||retrigger.after!==grant||retrigger.positions.length||retrigger.path.length)return false;}}else if(spin.events.length)return false;
    }
  }
  if(bonusId===null)return view.bonus===null;
  const saved=view.bonus;if(!saved||saved.id!==bonusId||saved.limit!==rule.bonusLimit||saved.awarded!==awarded||saved.played!==played||saved.remaining!==(view.capped?0:awarded-played)||saved.respins!==0)return false;
  if(!view.history.length){const f=saved.features;if(mode.bonus==='super-encore')return f.wilds.length===1&&f.wilds.every(star)&&same(f.counters,[3,0])&&f.multiplier===1;return empty({...f,multiplier:1})&&f.multiplier===mode.startMultiplier;}
  return true;
}
