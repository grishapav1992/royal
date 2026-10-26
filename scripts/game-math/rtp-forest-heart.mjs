import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyzeForestHeart} from './forest-heart-model.mjs';
import {referenceBoard,referenceFlow,referenceHeld,referenceNextState,countFlowers} from './forest-heart-reference.mjs';
import {validateForestWalletEvidence} from './forest-heart-evidence.mjs';

export const FOREST_QUALIFICATION_METHOD='exact-forest-heart-runtime';
export const FOREST_SERVER_STATUS='server-qualified-client-pending';
export const FOREST_REVIEWED_SOURCES={
  "src/shared/forestHeartMath.ts": "c3e04efc098aa9d61f0faa70fc9159d8460dcf0816d96ef5b560efd45ab46658",
  "src/shared/forestHeart.ts": "6f0ba79987ff2d24e5c242103ec6735bea1b9fcb3a0fba2abec773eff1dab52e",
  "server/games/forestHeart.ts": "0c7412ea5438c72d63c7808759e79bb76fa95e12a32a23690dd7b36fcca9a1be"
};
const stakes=[1000,2000,5000,10000,20000,50000];
const choices=['optimal','pass',...Array.from({length:12},(_,i)=>'rotate-'+i)];
const cache=new Map();
export function forestRuntimeEvidence(policy){
  assert.equal(policy.method,FOREST_QUALIFICATION_METHOD);assert.equal(policy.releaseStatus,FOREST_SERVER_STATUS);
  assert.equal(policy.target,.96);assert.equal(policy.tolerance,.002);assert.equal(policy.rulesVersion,1);assert.equal(policy.progressVersion,1);
  assert.deepEqual(policy.stakes,stakes);assert.deepEqual(policy.choices,choices);
  assert.deepEqual(policy.seeds,[831749,962381]);assert.equal(policy.serverReplayRoundsPerSeed,64);
  const key=JSON.stringify(policy);
  if(cache.has(key))return structuredClone(cache.get(key));
  const analysis=analyzeForestHeart(),results=choices.flatMap(choice=>stakes.map(stakeUnits=>({
    choice,stakeUnits,rtpFraction:analysis.strategies.find(row=>row.choice===choice).rtp,
    rtp:analysis.strategies.find(row=>row.choice===choice).rtp.decimal,
  })));
  const evidence={method:FOREST_QUALIFICATION_METHOD,scope:'server-engine-and-primary-common-wallet',clientReady:false,analysis,results};
  cache.set(key,structuredClone(evidence));return evidence;
}
export function validateForestRuntimeProof(gameId,inputs,proof){
  assert.equal(gameId,'studio-forest-heart');
  for(const [source,digest]of Object.entries(FOREST_REVIEWED_SOURCES))
    assert.equal(inputs.sourceHashes[source],digest,'Forest Heart source changed: independently review its model and server sampler');
  const expected=forestRuntimeEvidence(inputs.policy);
  for(const field of ['method','scope','clientReady','analysis','results'])assert.deepEqual(proof[field],expected[field],'Invalid Forest Heart '+field);
  const replay=proof.serverReplay,p=inputs.policy;
  assert(replay&&Array.isArray(replay.coverage));assert.deepEqual(replay.seeds,p.seeds);
  assert.deepEqual(replay.entropyCensus,{boards:4096,energyTickets:10000,abilityTickets:32,bonusTickets:64});
  assert.equal(replay.coverage.length,stakes.length*choices.length);
  const keys=new Set();let total=0;
  for(const row of replay.coverage){
    assert(stakes.includes(row.stakeUnits)&&choices.includes(row.choice));
    const key=row.choice+':'+row.stakeUnits;assert(!keys.has(key));keys.add(key);
    assert.equal(row.paidRounds,128);assert(Number.isSafeInteger(row.spins)&&row.spins>=128);
    assert(/^[a-f0-9]{64}$/.test(row.sha256));total+=row.paidRounds;
  }
  assert.equal(replay.serverReplayChecks,total);assert.equal(proof.serverReplayChecks,total);
  assert.equal(replay.forcedMaximumChecks,stakes.length);
  assert.equal(replay.forcedChoiceChecks,stakes.length*13);
  assert(replay.naturalChoices>0&&replay.naturalBonuses>0,'Natural runtime branches missing');
  validateForestWalletEvidence(proof.walletEvidence);
  return true;
}
const referenceFlows=Array.from({length:4096},(_,bits)=>referenceFlow(referenceBoard(bits)));
const independentEnergy=ticket=>ticket<9000?1:ticket<9800?2:ticket<9980?5:ticket<9999?20:100;
function referenceTotal(view,stake){
  const base=view.base,second=base.rotation===null?base.bits:base.bits^(1<<base.rotation);
  let total=BigInt(stake)*631n*BigInt(base.energy*countFlowers(referenceFlows[base.bits].receiverMask|referenceFlows[second].receiverMask))/1000n,state=0;
  for(const spin of view.bonus){
    const held=referenceHeld(state);assert.equal(spin.bits&held.mask,held.values);
    const flow=referenceFlows[spin.bits],next=referenceNextState(state,spin.bits,flow.terminalRootMask);
    const amount=BigInt(stake)*631n*BigInt(spin.energy*countFlowers(flow.receiverMask))/1000n;
    assert.equal(spin.receiverMask,flow.receiverMask);assert.equal(spin.heldState,next);assert.equal(spin.payoutUnits,String(amount));
    state=next;total+=amount;
  }
  assert.equal(view.totalPayoutUnits,String(total));assert.equal(view.heldState,state);
  return total;
}
function bestRotation(bits){
  let best=null,count=countFlowers(referenceFlows[bits].receiverMask);
  for(let i=0;i<12;i++){
    const candidate=countFlowers(referenceFlows[bits].receiverMask|referenceFlows[bits^(1<<i)].receiverMask);
    if(candidate>count){count=candidate;best=i;}
  }
  return best;
}
function seeded(seed){
  let counter=0;
  return max=>{
    const limit=4294967296-4294967296%max;let value;
    do{value=createHash('sha256').update(seed+':'+counter++).digest().readUInt32LE(0);}while(value>=limit);
    return value%max;
  };
}
async function runtimeReplay(p,progress){
  const {startForestHeart:start,moveForestHeart:move,forestHeartEnergy}=await import('../../server/games/forestHeart.ts');
  const settings={forestHeart:{mode:'normal'}};
  const startWith=(values,stake='1000')=>{
    const bounds=[4096,10000,32,64];let i=0;
    const result=start(settings,stake,max=>{assert.equal(max,bounds[i]);return values[i++];});
    assert.equal(i,4);assert.equal(result.view.bonus.length,0);
    assert.equal(result.view.base.bits,values[0]);assert.equal(result.view.base.energy,independentEnergy(values[1]));
    assert.equal(result.view.base.ability,values[2]===0);assert.equal(result.view.base.bonusAwarded,values[3]===0);
    referenceTotal(result.view,stake);return result;
  };
  for(let bits=0;bits<4096;bits++)startWith([bits,0,1,1]);
  const energyCounts=new Map();
  for(let ticket=0;ticket<10000;ticket++){
    assert.equal(forestHeartEnergy(ticket),independentEnergy(ticket));
    const result=startWith([0,ticket,1,1]);energyCounts.set(result.view.base.energy,(energyCounts.get(result.view.base.energy)??0)+1);
  }
  assert.deepEqual([...energyCounts],[[1,9000],[2,800],[5,180],[20,19],[100,1]]);
  for(let i=0;i<32;i++)startWith([0,0,i,1]);for(let i=0;i<64;i++)startWith([0,0,1,i]);
  let forcedChoiceChecks=0,forcedMaximumChecks=0;
  for(const stake of stakes){
    for(const rotation of [null,...Array.from({length:12},(_,i)=>i)]){
      const initial=startWith([0,0,0,1],String(stake));
      const result=move(initial.view,String(stake),1,rotation===null?'forest-pass':'forest-turn-'+rotation,()=>{throw Error('Choice must not draw');});
      assert(result.ended);assert.equal(BigInt(result.credit),referenceTotal(result.view,stake));forcedChoiceChecks++;
    }
    let result=startWith([132,9999,1,0],String(stake));
    for(let i=0;i<4;i++){
      const values=[132,9999],bounds=[4096,10000];let count=0;
      result=move(result.view,String(stake),result.view.revision,'forest-spin',max=>{assert.equal(max,bounds[count]);return values[count++];});
      assert.equal(count,2);referenceTotal(result.view,stake);
    }
    assert(result.ended);assert.equal(BigInt(result.credit)*2n,BigInt(stake)*1893n);forcedMaximumChecks++;
  }
  const coverage=[];let serverReplayChecks=0,naturalChoices=0,naturalBonuses=0;
  for(const choice of choices)for(const stake of stakes){
    const digest=createHash('sha256');let paidRounds=0,spins=0;
    for(const seed of p.seeds){
      const random=seeded(seed+stakes.indexOf(stake)*100003+choices.indexOf(choice)*1000003);
      for(let round=0;round<p.serverReplayRoundsPerSeed;round++){
        const entropy=[];const draw=max=>{const value=random(max);entropy.push([max,value]);return value;};
        let result=start(settings,String(stake),draw);assert.deepEqual(entropy.map(row=>row[0]),[4096,10000,32,64]);
        assert.equal(result.view.base.bits,entropy[0][1]);assert.equal(result.view.base.energy,independentEnergy(entropy[1][1]));
        assert.equal(result.view.base.ability,entropy[2][1]===0);assert.equal(result.view.base.bonusAwarded,entropy[3][1]===0);
        naturalBonuses+=Number(result.view.base.bonusAwarded);paidRounds++;spins++;
        while(!result.ended){
          const prior=structuredClone(result.view),before=entropy.length;
          let action='forest-spin';
          if(prior.stage==='choice'){
            naturalChoices++;const rotation=choice==='optimal'?bestRotation(prior.base.bits):choice==='pass'?null:Number(choice.slice(7));
            action=rotation===null?'forest-pass':'forest-turn-'+rotation;
          }
          result=move(result.view,String(stake),result.view.revision,action,draw);
          if(prior.stage==='choice')assert.equal(entropy.length,before);
          else{
            assert.equal(entropy.length,before+2);assert.deepEqual(entropy.slice(before).map(row=>row[0]),[4096,10000]);
            const held=referenceHeld(prior.heldState),spin=result.view.bonus.at(-1);
            assert.equal(spin.bits,(entropy[before][1]&~held.mask)|held.values);
            assert.equal(spin.energy,independentEnergy(entropy[before+1][1]));spins++;
          }
          const expected=referenceTotal(result.view,stake);assert.equal(BigInt(result.credit),result.ended?expected:0n);
        }
        assert.equal(BigInt(result.credit),referenceTotal(result.view,stake));
        digest.update(JSON.stringify([result.view,result.credit])+'\n');
      }
    }
    serverReplayChecks+=paidRounds;coverage.push({choice,stakeUnits:stake,paidRounds,spins,sha256:digest.digest('hex')});
  }
  progress?.({phase:'forest-server-replay',serverReplayChecks});
  return {seeds:p.seeds,coverage,serverReplayChecks,naturalChoices,naturalBonuses,forcedChoiceChecks,forcedMaximumChecks,
    entropyCensus:{boards:4096,energyTickets:10000,abilityTickets:32,bonusTickets:64}};
}
async function walletReplay(){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const child=spawn(process.execPath,['--import','tsx','scripts/database-test.ts','--import','tsx','scripts/game-math/forest-heart-wallet.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;assert(stdout.length<500000);});
  child.stderr.on('data',chunk=>{stderr+=chunk;assert(stderr.length<500000);});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,'Forest Heart wallet qualification failed: '+stderr);
  const line=stdout.split(/\r?\n/).find(line=>line.startsWith('FOREST_WALLET_EVIDENCE:'));
  assert(line,'Missing actual Postgres wallet evidence');
  const evidence=JSON.parse(line.slice('FOREST_WALLET_EVIDENCE:'.length));validateForestWalletEvidence(evidence);return evidence;
}
export async function qualifyForestHeart(policy,progress){
  const expected=forestRuntimeEvidence(policy),serverReplay=await runtimeReplay(policy,progress);
  progress?.({phase:'forest-common-wallet-start'});
  const walletEvidence=await walletReplay();progress?.({phase:'forest-common-wallet-complete',cases:walletEvidence.cases.length});
  return {...expected,serverReplay,serverReplayChecks:serverReplay.serverReplayChecks,walletEvidence};
}
