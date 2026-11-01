import assert from 'node:assert/strict';
import {startCaramel,moveCaramel} from '../../server/games/caramelCarnival.ts';
import {startConvoy,moveConvoy} from '../../server/games/lastConvoy.ts';
import {startNitro,moveNitro} from '../../server/games/nitroRun.ts';
import {startAfter,moveAfter} from '../../server/games/afterglow.ts';
import {startLuelonSlotGame,moveLuelonSlotGame} from '../../server/games/luelonSlots.ts';
import {startDracona,moveDracona} from '../../server/games/dracona.ts';
import {startNeopolis,moveNeopolis} from '../../server/games/neopolis.ts';
import {startForestHeart,moveForestHeart} from '../../server/games/forestHeart.ts';
import {forestHeartBestRotation} from '../../src/shared/forestHeartMath.ts';
import {startTempleCascade,moveTempleCascade} from '../../server/games/floodedTempleCascade.ts';
import {startCaribbean,moveCaribbean} from '../../server/games/caribbeanTreasures.ts';
import {startJackie,moveJackie} from '../../server/games/jackieChan.ts';
import {startPenalty,movePenalty} from '../../server/games/crLeo.ts';
import {startFlagBattle} from '../../server/games/flagBattle.ts';
import {flagPayout,flagViewMode} from '../../src/shared/flagBattle.ts';
import {prepareGame} from '../../server/games/core.ts';
import {expansionExactAward,coreExactAward,makeRoundPrecision} from '../../src/shared/roundPrecision.ts';
import {cascadeRandom} from './rtp-temple-cascade-model.mjs';

export function settingsFor(game,choice){
 if(game==='studio-caramel-carnival')return {caramel:{mode:choice}};
 if(game==='studio-last-convoy')return {convoy:{mode:'normal'}};
 if(game==='studio-nitro-run'||game==='studio-meme-overload')return {nitro:{mode:'normal'}};
 if(game==='studio-afterglow')return {afterglow:{mode:'normal'}};
 if(game==='studio-cosmic-escape'||game==='studio-velvet-reign')return {luelon:{mode:choice}};
 if(game==='studio-dracona')return {dracona:{mode:'normal'}};
 if(game==='studio-neopolis')return {neopolis:{hero:choice}};
 if(game==='studio-forest-heart')return {forestHeart:{mode:'normal'}};
 if(game==='studio-flooded-temple')return {temple:{mode:'cascades'}};
 if(game==='flag-battle')return {flags:{country:'RU',mode:choice}};
 if(game==='original-cr-vs-leo')return {penalty:{hero:'cr',risk:'safe'}};
 if(game==='original-jackie-chan')return {jackie:{risk:'safe',costume:'master',location:'restaurant'}};
 if(game==='studio-caribbean-treasures'){const m=/^lines-(1|5|10|20)-(normal|buy)-(raid|flagship)$/.exec(choice);assert(m);return {caribbean:{lines:Number(m[1]),mode:m[2]==='normal'?'normal':'buy-'+m[3],stakeBasis:'total'}};}
 return {};
}
export function runtimeRound(game,choice,stakeUnits,seed){
 const rng=cascadeRandom(seed),tape=[];const draw=max=>{const value=rng(max);tape.push([max,value]);return value;};
 const settings=settingsFor(game,choice);let result,key,move;
 if(game==='royal-plinko'||game==='royal-roulette'){
  const [rows,risk]=choice.split(':'),input=game==='royal-plinko'?{rows:Number(rows),risk}:{bet:'number',number:7};
  const round=prepareGame(game,1,input).play(BigInt(stakeUnits),draw),a=coreExactAward(round),precision=makeRoundPrecision(a,round.payoutUnits,max=>Math.floor((cascadeRandom(seed+710107)(4294967296)/4294967296)*max));
  return {exact:a,base:round.payoutUnits,precision,tape,spins:1,round,settings};
 }
 if(game==='studio-caramel-carnival'){result=startCaramel(settings,stakeUnits,draw);key='caramel';move=r=>moveCaramel(r.view,stakeUnits,r.view.revision,draw);}
 else if(game==='studio-last-convoy'){result=startConvoy(settings,stakeUnits,draw);key='convoy';move=r=>moveConvoy(r.view,stakeUnits,r.view.revision,draw);}
 else if(game==='studio-nitro-run'||game==='studio-meme-overload'){result=startNitro(settings,stakeUnits,draw);key='nitro';move=r=>moveNitro(r.view,stakeUnits,r.view.revision,draw);}
 else if(game==='studio-afterglow'){result=startAfter(settings,stakeUnits,0,draw);key='afterglow';move=r=>moveAfter(r.view,stakeUnits,r.view.revision,draw);}
 else if(game==='studio-cosmic-escape'||game==='studio-velvet-reign'){result=startLuelonSlotGame(game,settings,stakeUnits,draw);key='luelon';move=r=>moveLuelonSlotGame(r.luelon,stakeUnits,r.luelon.revision,'luelon-spin',undefined,draw);}
 else if(game==='studio-dracona'){result=startDracona(settings,stakeUnits,draw);key='dracona';move=r=>moveDracona(r.view,stakeUnits,r.view.revision,draw);}
 else if(game==='studio-neopolis'){result=startNeopolis(settings,stakeUnits,undefined,draw);key='neopolis';move=r=>moveNeopolis(r.view,stakeUnits,r.view.revision,draw);}
 else if(game==='studio-forest-heart'){
  result=startForestHeart(settings,stakeUnits,draw);key='forestHeart';move=r=>{const v=r.view;let action='forest-spin';if(v.stage==='choice'){const best=choice==='optimal'?forestHeartBestRotation(v.base.bits).rotation:choice.startsWith('rotate-')?Number(choice.slice(7)):null;action=best===null?'forest-pass':'forest-turn-'+best;}return moveForestHeart(v,stakeUnits,v.revision,action,draw);};
 }else if(game==='studio-flooded-temple'){result=startTempleCascade(settings,stakeUnits,draw);key='templeCascade';move=r=>moveTempleCascade(r.view,stakeUnits,r.view.revision,'temple-cascade',draw);}
 else if(game==='studio-caribbean-treasures'){result=startCaribbean(settings.caribbean,stakeUnits,draw);key='caribbean';move=r=>moveCaribbean(r.view,r.view.revision,r.view.phase==='choice'?(choice.endsWith('-raid')?'choose-raid':'choose-flagship'):'spin',draw);}
 else if(game==='flag-battle'){
  const f=startFlagBattle(settings,stakeUnits,draw),base=f.order.at(-1)===f.country?flagPayout(stakeUnits,flagViewMode(f)):'0';result={view:f,ended:true,credit:Number(base)};key='flags';
 }else if(game==='original-cr-vs-leo'){
  const v=startPenalty(settings,stakeUnits,draw);result={view:v,ended:v.status!=='playing',credit:Number(v.availableUnits)};key='penalty';move=r=>{const v=movePenalty(r.view,stakeUnits,'cashout',r.view.revision,draw);return {view:v,ended:true,credit:Number(v.availableUnits)};};
 }else if(game==='original-jackie-chan'){
  const v=startJackie(settings,stakeUnits,0,draw);result={view:v,ended:v.combat.status!=='playing',credit:Number(v.combat.availableUnits)};key='jackie';move=r=>{const v=moveJackie(r.view,stakeUnits,'cashout',r.view.combat.revision,draw);return {view:v,ended:true,credit:Number(v.combat.availableUnits)};};
 }else if(game==='github-crash'){
  const multiplier=1.23,base=String(BigInt(stakeUnits)*123n/100n),s={gameId:game,stakeUnits,returnedUnits:base,multiplier,view:{}};
  const exact=expansionExactAward(s),coin=cascadeRandom(seed+710107);return {exact,base,precision:makeRoundPrecision(exact,base,max=>Math.floor(coin(4294967296)/4294967296*max)),tape,spins:1,settings};
 }else throw Error('Unsupported runtime '+game);
 let continuations=0;
 while(!result.ended){assert(continuations++<10000,'Finite paid round replay');result=move(result);}
 const v=result.luelon??result.view,base=String(result.creditUnits??result.credit??v.totalPayoutUnits),session={gameId:game,stakeUnits,returnedUnits:base,view:{[key]:v}};
 const exact=expansionExactAward(session),coin=cascadeRandom(seed+710107),precision=makeRoundPrecision(exact,base,max=>Math.floor(coin(4294967296)/4294967296*max));
 return {exact,base,precision,tape,spins:continuations+1,view:v,settings};
}
