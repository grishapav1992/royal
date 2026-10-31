import {advanceCaramelSpin} from '../../server/games/caramelCarnival.ts';
import {advanceConvoySpin} from '../../server/games/lastConvoy.ts';
import {nitroNext} from '../../server/games/nitroRun.ts';
import {afterInitial,afterNext} from '../../src/shared/afterglow.ts';
import {afterRandomSymbol} from '../../server/games/afterglow.ts';
import {velvetPlay,velvetBonus} from '../../server/games/velvetReign.ts';
import {VELVET_INFO} from '../../src/shared/velvetReign.ts';
import {cascadeRandom} from './rtp-temple-cascade-model.mjs';

// Shared deterministic decisions are replayed against the real start/move server
// in the qualifier. Independent seeds are reserved for statistical qualification.
// Stake 100 makes every hundredth coefficient exact. Nonnegative wins and a
// final unbiased cent settlement give the same normalized expected reward at
// every permitted denomination, including the complete capped bonus chain.
export function sampleLegacyRound(game,choice,draw,retainHistory=false){
 let spins=0;const retain=v=>{spins++;if(!retainHistory)v.history=[];return v;};
 let v,cost=1;
 if(game==='studio-caramel-carnival'){
  cost=choice==='festival'?35:1;
  v={kind:'caramel-carnival',version:1,mode:choice,revision:0,history:[],spin:null,bonus:cost===35?{awarded:10,played:0,remaining:10,multiplier:1}:null,totalPayoutUnits:'0',capped:false};
  if(cost===1)v=retain(advanceCaramelSpin(v,'100',draw));
  while(v.bonus?.remaining&&!v.capped)v=retain(advanceCaramelSpin(v,'100',draw));
 }else if(game==='studio-last-convoy'){
  v=retain(advanceConvoySpin({kind:'last-convoy',version:1,mode:'normal',revision:0,history:[],spin:null,bonus:null,totalPayoutUnits:'0',capped:false},'100',draw));
  while(v.bonus?.remaining&&!v.capped)v=retain(advanceConvoySpin(v,'100',draw));
 }else if(game==='studio-nitro-run'||game==='studio-meme-overload'){
  v=retain(nitroNext({kind:'nitro-run',version:1,mode:'normal',revision:0,history:[],spin:null,bonus:null,totalPayoutUnits:'0',capped:false},'100',draw));
  while(v.bonus?.remaining&&!v.capped)v=retain(nitroNext(v,'100',draw));
 }else if(game==='studio-afterglow'){
  v=retain(afterNext(afterInitial(0),'100',()=>afterRandomSymbol(draw)));
  while(v.bonus?.remaining&&!v.capped)v=retain(afterNext(v,'100',()=>afterRandomSymbol(draw)));
 }else if(game==='studio-velvet-reign'){
  const mode=VELVET_INFO.modes.find(m=>m.id===choice);if(!mode)throw Error('Invalid Velvet mode');cost=mode.cost;
  v={kind:'luelon-slot',version:2,gameId:game,mode:choice,phase:mode.bonus?'bonus':'complete',revision:0,decisions:[],spin:null,history:[],bonus:mode.bonus?velvetBonus(choice,draw):null,totalPayoutUnits:'0',capped:false};
  if(!mode.bonus)v=retain(velvetPlay(v,'100',draw));
  while(v.phase!=='complete')v=retain(velvetPlay(v,'100',draw));
 }else throw Error('No independent complete-round sampler for '+game);
 return {reward:Number(v.totalPayoutUnits)/100/cost,cost,spins,bonus:spins>1,capped:v.capped,view:v};
}
export function legacySampleStream(game,choice,seed,rounds,progress=()=>{}){
 const draw=cascadeRandom(seed),start=Date.now();let reward=0,squared=0,freeSpins=0,bonuses=0,capped=0;
 for(let i=0;i<rounds;i++){
  const r=sampleLegacyRound(game,choice,draw);reward+=r.reward;squared+=r.reward*r.reward;freeSpins+=r.spins-1;bonuses+=Number(r.bonus);capped+=Number(r.capped);
  if((i+1)%100000===0)progress({game,choice,seed,paidRounds:i+1,rtp:reward/(i+1),elapsedMs:Date.now()-start});
 }
 return {game,choice,seed,paidRounds:rounds,reward,rewardSquared:squared,freeSpins,bonuses,capped,durationMs:Date.now()-start};
}
