import {VELVET_GAME,VELVET_FACTORS,velvetSame,velvetEmptyFeatures} from './velvetReign';
import {luelonSlotLineWins,type LuelonSlotView,type LuelonSlotFeatures,type LuelonSlotWild} from './luelonSlots';
function validFeatures(f:LuelonSlotFeatures){return f.multiplier===1&&f.rows===4&&velvetSame(f.heights,[4,4,4,4,4])&&!f.charges.length&&!f.held.length&&f.chosenSymbol===null&&f.route===0&&f.counters.length===2&&f.counters.every(n=>Number.isSafeInteger(n)&&n>=0)&&f.counters[1]<3&&f.wilds.every(w=>(VELVET_FACTORS as readonly number[]).includes(w.factor));}
function blank(f:LuelonSlotFeatures){return velvetSame(f,velvetEmptyFeatures());}
function starsAppend(before:LuelonSlotWild[],after:LuelonSlotWild[],count:number){return after.length===before.length+count&&before.every((w,i)=>velvetSame(w,after[i]))&&new Set(after.map(w=>w.column)).size===after.length;}
/** Reconstruct all public bonus transitions without drawing randomness. */
export function validVelvetHistory(view:LuelonSlotView):boolean{
  if(view.gameId!==VELVET_GAME||view.decisions.length||!['normal','booster','hyper','spotlight','super-encore'].includes(view.mode)||!['bonus','complete'].includes(view.phase)||view.history.length>21)return false;
  const purchased=view.mode==='spotlight'||view.mode==='super-encore';let bonusId:string|null=purchased?view.mode:null,awarded=purchased?10:0,played=0;
  for(let i=0;i<view.history.length;i++){
    const s=view.history[i],base=i===0&&!purchased,b=s.featuresBefore,a=s.featuresAfter,cap=s.stopReason==='win-cap';
    if(!validFeatures(b)||!validFeatures(a)||s.rows!==4||s.kind!==(base?'base':'free-spin')||s.frames.length!==1||!['complete','win-cap'].includes(s.stopReason)||!base&&played>=awarded||base&&!blank(b))return false;
    if(!base)played++;
    const f=s.frames[0],grid=[...f.gridBefore];if(f.removed.length||f.drops.length||f.refills.length)return false;
    if(f.events.length!==b.wilds.length)return false;
    for(let n=0;n<b.wilds.length;n++){
      const w=b.wilds[n],e=f.events[n],positions=[0,1,2,3].map(r=>r*5+w.column);
      if(e.kind!=='sticky'||!velvetSame(e.positions,positions)||e.value!==w.factor||e.before!==0||e.after!==w.factor||e.path.length)return false;
      for(const pos of positions)grid[pos]=8;
    }
    if(!velvetSame(grid,f.gridAfter)||!velvetSame(luelonSlotLineWins(VELVET_GAME,grid,b.wilds),f.wins.map(({payoutUnits:_,uncappedPayoutUnits:__,...w})=>w)))return false;
    const gems=grid.flatMap((x,p)=>x===9?[p]:[]);
    if(base){
      const grant=!cap&&gems.length>=3?10:0;
      if(s.triggerAwards!==grant)return false;
      if(grant){bonusId=gems.length>=4?'super-encore':'spotlight';awarded=10;const e=s.events[0];if(s.events.length!==1||e.kind!=='scatter'||!velvetSame(e.positions,gems)||e.value!==10||e.before!==0||e.after!==10||e.path.length)return false;
        if(bonusId==='super-encore'){if(a.wilds.length!==1||!velvetSame(a.counters,[3,0]))return false;}else if(!blank(a))return false;
      }else if(s.events.length||!blank(a))return false;
    }else{
      if(i===0){if(view.mode==='super-encore'?(b.wilds.length!==1||!velvetSame(b.counters,[3,0])):!blank(b))return false;}
      const collectible=!cap&&b.wilds.length<5?gems.length:0,added=Math.min(5-b.wilds.length,Math.floor((b.counters[1]+collectible)/3)),grant=added*2;
      if(!starsAppend(b.wilds,a.wilds,added)||a.counters[0]!==b.counters[0]+collectible||a.counters[1]!==(a.wilds.length===5?0:b.counters[1]+collectible-added*3)||s.triggerAwards!==grant)return false;
      if(!cap&&b.wilds.length<5){const c=s.events[0];if(s.events.length!==(grant?2:1)||c.kind!=='collect'||!velvetSame(c.positions,gems)||c.value!==collectible||c.before!==b.counters[0]||c.after!==a.counters[0]||c.path.length)return false;
        if(grant){const e=s.events[1];if(e.kind!=='retrigger'||e.positions.length||e.path.length||e.value!==grant||e.before!==0||e.after!==grant)return false;}
      }else if(s.events.length)return false;
      awarded+=grant;if(awarded>20)return false;
    }
  }
  const b=view.bonus;if(!bonusId)return b===null&&view.history.length===1&&view.phase==='complete';
  if(!b||b.id!==bonusId||b.limit!==20||b.respins!==0||b.awarded!==awarded||b.played!==played||b.remaining!==(view.capped?0:awarded-played)||!validFeatures(b.features))return false;
  if(!view.history.length&&(view.mode==='super-encore'?(b.features.wilds.length!==1||!velvetSame(b.features.counters,[3,0])):!blank(b.features)))return false;
  return view.phase===(b.remaining?'bonus':'complete');
}
