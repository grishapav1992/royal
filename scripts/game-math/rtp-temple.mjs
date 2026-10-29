import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import data from '../../src/shared/floodedTempleData.json' with {type:'json'};
import {templeEvidence,TEMPLE_METHOD,baseSelections,bonusSelections,modelBase,modelSolver,modelActions,modelMove,modelScore,initialModelState} from './rtp-temple-model.mjs';
export {templeEvidence,TEMPLE_METHOD};
const hash=()=>createHash('sha256');
const key=(a,b)=>[a,b].sort((x,y)=>x-y).join(':');
const row=(c,s,b,stake)=>[c,s.at,s.left,s.mask,s.bridge,String(BigInt(stake)*BigInt(modelScore(b,s))/100n),s.done];
const stateRow=(c,s,b,stake)=>['state',...row(c,s,b,stake)];
const actionRow=(c,s,a,b,stake)=>['action',c,s.at,s.left,s.mask,s.bridge,a,...row(c,modelMove(b,s,a),b,stake).slice(1)];
const visitMask=ids=>ids.reduce((mask,id)=>mask|(1<<id),0);
function projected(c,state){return {at:state.at,left:state.left,mask:visitMask(state.visited),bridge:state.bridge!==null,done:state.done};}
const ticket=(weights,i)=>weights.slice(0,i).reduce((s,n)=>s+n,0);
function forced(base,bonus){const values=[base.layout,base.pattern,ticket(data.baseTiers.map(t=>t.weight),base.tier),base.relic?98:0,...(bonus?[bonus.layout,ticket(data.bonusTiers.map(t=>t.weight),bonus.tier)]:[])];let cursor=0;return max=>{const n=values[cursor++];assert(Number.isInteger(n)&&n>=0&&n<max);return n;};}
function record(h,value){h.update(JSON.stringify(value)+'\n');}
export function expectedTempleReplay(stake){
  const digest=hash();let checks=0;
  for(const c of baseSelections()){const b=modelBase(c);record(digest,['base',c,b.visited,String(BigInt(stake)*BigInt(b.cents)/100n),b.bonus]);checks++;}
  for(const c of bonusSelections()){
    const solver=modelSolver(c),b=solver.board;
    for(const [,s]of [...solver.states].sort(([a],[b])=>a.localeCompare(b))){
      record(digest,stateRow(c,s,b,stake));checks++;
      if(!s.done)for(const a of [...modelActions(b,s),{kind:'finish'}]){record(digest,actionRow(c,s,a,b,stake));checks++;}
    }
  }
  return {stakeUnits:stake,checks,sha256:digest.digest('hex')};
}
export function expectedTempleStreams(policy){
  const streams=[];
  for(const seed of policy.seeds)for(const stake of policy.stakes){
    let word=seed>>>0;const draw=max=>{word=(Math.imul(word,1664525)+1013904223)>>>0;return Math.floor(word/4294967296*max);};
    const pick=weights=>{let ticket=draw(weights.reduce((s,n)=>s+n,0));for(let i=0;i<weights.length;i++){if(ticket<weights[i])return i;ticket-=weights[i];}throw Error('Bad model draw');};
    for(const choice of policy.choices){const digest=hash();
      for(let n=0;n<policy.serverReplayRoundsPerSeed;n++){
        const baseCase={layout:draw(8),pattern:draw(4),tier:pick(data.baseTiers.map(t=>t.weight)),relic:pick(data.relicWeights)===1};
        const base=modelBase(baseCase),bonusCase=base.bonus?{layout:draw(8),tier:pick(data.bonusTiers.map(t=>t.weight))}:null,history=[];
        let cents=base.cents;
        if(bonusCase){const solver=modelSolver(bonusCase);let s=initialModelState();while(!s.done){const actions=modelActions(solver.board,s),a=choice==='random-walk'?actions[draw(actions.length)]:solver.choose(s,choice);history.push(a);s=modelMove(solver.board,s,a);}cents+=modelScore(solver.board,s);}
        record(digest,[baseCase,bonusCase,history,Number(BigInt(stake)*BigInt(cents)/100n)]);
      }
      streams.push({seed,stakeUnits:stake,choice,paidRounds:policy.serverReplayRoundsPerSeed,sha256:digest.digest('hex')});
    }
  }
  return streams;
}
export async function qualifyTemple(policy,progress=()=>{}){
  const evidence=templeEvidence(policy);
  const {startTemple,moveTemple}=await import('../../server/games/floodedTemple.ts');
  const {validTempleSettlement}=await import('../../src/shared/floodedTemple.ts');
  const replay=[];
  for(const stake of policy.stakes){
    const stakeText=String(stake),digest=hash();let checks=0;
    for(const c of baseSelections()){
      const result=startTemple({temple:{mode:'normal'}},stakeText,forced(c,c.relic?{layout:0,tier:0}:null)),v=result.view;
      assert(validTempleSettlement(result.ended?'settled':'active',stakeText,stakeText,String(result.credit),v));
      record(digest,['base',v.baseCase,[...v.baseResult.visited].sort((a,b)=>a-b),v.baseResult.payoutUnits,v.baseResult.bonus]);checks++;
    }
    for(const c of bonusSelections()){
      const solver=modelSolver(c),b=solver.board;
      const initial=startTemple({temple:{mode:'normal'}},stakeText,forced({layout:0,pattern:0,tier:0,relic:true},c));
      for(const [id,s]of [...solver.states].sort(([a],[b])=>a.localeCompare(b))){
        let result=initial;
        for(const a of solver.paths.get(id))result=moveTemple(result.view,stakeText,result.view.revision,'temple-'+a.kind,[a.to]);
        const actual=projected(c,result.view.bonusState);
        record(digest,['state',c,actual.at,actual.left,actual.mask,actual.bridge,result.view.bonusState.payoutUnits,actual.done]);checks++;
        const state=result.view.bonusState;
        assert.equal(state.ropeAvailable,!s.bridge);assert.equal(state.bridge,s.bridge?key(...b.gap):null);
        assert.deepEqual(state.opened,(s.mask&(1<<b.lever))?[key(...b.gate)]:[]);
        assert(validTempleSettlement(result.ended?'settled':'active',stakeText,stakeText,String(result.credit),result.view));
        if(!s.done)for(const a of [...modelActions(b,s),{kind:'finish'}]){
          const moved=moveTemple(result.view,stakeText,result.view.revision,a.kind==='finish'?'temple-finish':'temple-'+a.kind,a.kind==='finish'?undefined:[a.to]);
          const next=moved.view.bonusState,p=projected(c,next);
          record(digest,['action',c,s.at,s.left,s.mask,s.bridge,a,p.at,p.left,p.mask,p.bridge,next.payoutUnits,p.done]);checks++;
          assert(validTempleSettlement(moved.ended?'settled':'active',stakeText,stakeText,String(moved.credit),moved.view));
        }
      }
    }
    const coverage={stakeUnits:stake,checks,sha256:digest.digest('hex')};assert.deepEqual(coverage,expectedTempleReplay(stake));replay.push(coverage);
    progress({phase:'exhaustive-temple-server-replay',stakeUnits:stake,checks});
  }
  // Independent seeds exercise actual weighted boundaries in addition to exhaustive cases.
  const streams=[];
  for(const seed of policy.seeds)for(const stake of policy.stakes){
    let word=seed>>>0;const draw=max=>{word=(Math.imul(word,1664525)+1013904223)>>>0;return Math.floor(word/4294967296*max);};
    for(const choice of policy.choices){
      const digest=hash();let paidRounds=0;
      for(let n=0;n<policy.serverReplayRoundsPerSeed;n++){
        let result=startTemple({temple:{mode:'normal'}},String(stake),draw);const view=result.view;
        assert.deepEqual([...view.baseResult.visited].sort((a,b)=>a-b),modelBase(view.baseCase).visited);
        assert.equal(view.baseResult.payoutUnits,String(BigInt(stake)*BigInt(modelBase(view.baseCase).cents)/100n));
        if(view.bonusCase){let s=initialModelState();const solver=modelSolver(view.bonusCase);
          while(!result.ended){const legal=modelActions(solver.board,s),a=choice==='random-walk'?legal[draw(legal.length)]:solver.choose(s,choice);result=moveTemple(result.view,String(stake),result.view.revision,a.kind==='finish'?'temple-finish':'temple-'+a.kind,a.kind==='finish'?undefined:[a.to]);s=modelMove(solver.board,s,a);}
          assert.equal(result.view.bonusState.payoutUnits,String(BigInt(stake)*BigInt(modelScore(solver.board,s))/100n));
        }
        assert(validTempleSettlement('settled',String(stake),String(stake),String(result.credit),result.view));
        record(digest,[view.baseCase,view.bonusCase,result.view.history,result.credit]);paidRounds++;
      }
      streams.push({seed,stakeUnits:stake,choice,paidRounds,sha256:digest.digest('hex')});
    }
  }
  assert.deepEqual(streams,expectedTempleStreams(policy));
  return {...evidence,serverReplay:{coverage:replay,streams},serverReplayChecks:replay.reduce((sum,r)=>sum+r.checks,0)+streams.reduce((sum,r)=>sum+r.paidRounds,0)};
}
