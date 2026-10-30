import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const KEYS_METHOD='exact-six-step-pair-keys-v1';
const stakes=[1000,5000,10000,50000,1000000,2000000,5000000,10000000];
const pairs=Array.from({length:4},(_,a)=>Array.from({length:3-a},(_,b)=>[a,a+b+1])).flat();
export const keysChoices=pairs.flatMap(pair=>Array.from({length:6},(_,i)=>pair.join(',')+':stop-'+(i+1)));
const frozenShared='6f525322bc640eb29ad7bfc025205686f87214b174a08a92d0f800afe636eaa7';
const digest=value=>createHash('sha256').update(value).digest('hex');
const jsonHash=rows=>digest(rows.map(row=>JSON.stringify(row)+'\n').join(''));
const paid=(stake,steps)=>BigInt(stake)*98n*2n**BigInt(steps)/100n;
function parse(choice){const[pair,stop]=choice.split(':stop-');return{pair:pair.split(',').map(Number),stop:Number(stop)};}
function trapsFor(encoded,length){return Array.from({length},()=>{const n=encoded%4;encoded=Math.floor(encoded/4);return n;});}
function outcome(stake,pair,stop,traps){let successes=0;for(;successes<stop;successes++)if(pair.includes(traps[successes]))break;return[String(successes===stop?paid(stake,stop):0n),successes,Math.min(stop,successes+1)];}
function outcomes(stake,choice){const{pair,stop}=parse(choice);return Array.from({length:4**stop},(_,encoded)=>[encoded,...outcome(stake,pair,stop,trapsFor(encoded,stop))]);}
export function keysMetadataEvidence(value=readFileSync(new URL('../../src/shared/casinoNextVariants.ts',import.meta.url),'utf8')){
  const source=value.replace(/\r\n/g,'\n');
  const replacement="'variant-keys':'variant-keys'",prior="'variant-keys':'github-tower'";
  assert.equal(source.split(replacement).length,2,'Only the reviewed keys base metadata may replace the retired relationship');
  assert.equal(digest(source.replace(replacement,prior)),frozenShared,'Shared next-variant mathematical functions or unrelated metadata changed; independently qualify every affected game');
  return{path:'src/shared/casinoNextVariants.ts',frozenSourceSha256:frozenShared,currentSourceSha256:digest(source),
    change:{from:prior,to:replacement},equivalence:'Restoring this one metadata value reproduces every frozen byte. All mathematical functions and the other five game definitions are unchanged.'};
}
export function keysQualificationEvidence(policy){
  assert.equal(policy.method,KEYS_METHOD);assert.equal(policy.rulesVersion,1);assert.equal(policy.progressVersion,1);assert.equal(policy.target,.98);assert.equal(policy.tolerance,.001);
  assert.deepEqual(policy.stakes,stakes);assert.deepEqual(policy.choices,keysChoices);assert.equal(new Set(policy.seeds).size,2);assert(policy.seeds.every(Number.isSafeInteger));assert.equal(policy.serverReplayRoundsPerSeed,64);
  return{method:KEYS_METHOD,metadataEquivalence:keysMetadataEvidence(),analysis:{rows:6,cellsPerRow:4,chosenCells:2,trapsPerRow:1,safeChance:'1/2',
    targetBeforeIntegerFloor:'98/100',settlement:'floor(stake * 98 * 2^successfulSteps / 100)',
    completeRound:'One paid start and up to six free unlocks; cashout is available after any success. A trap ends the round with zero return.',
    adaptivePolicies:'For every revealed history, every pair has two safe trap locations among four independent next-row locations. The unfloored conditional return is a martingale after the initial 2% edge. Every adaptive pair choice and stopping time from one to six is covered.',
    integerBounds:'For every positive integer stake s: 0.98 - 1/s < RTP <= 0.98. All declared wallet stakes have exact 98% RTP at every stopping depth.',
    boundsKind:'Exact enumeration and integer settlement; no Monte Carlo confidence interval.'},
    results:policy.choices.flatMap(choice=>policy.stakes.map(stakeUnits=>{
      const{stop}=parse(choice),rows=outcomes(stakeUnits,choice),returned=rows.reduce((sum,row)=>sum+BigInt(row[1]),0n),cost=BigInt(rows.length)*BigInt(stakeUnits),rtp=Number(returned)/Number(cost);
      assert.equal(returned*100n,cost*98n);
      return{choice,stakeUnits,outcomes:rows.length,totalCostUnits:String(cost),totalReturnedUnits:String(returned),rtp,rtpBounds:[rtp,rtp],maximumSteps:stop,sha256:jsonHash(rows)};
    }))};
}
function stream(stake,choice,seed,rounds){
  const{pair,stop}=parse(choice);let state=seed>>>0;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%4;};
  return Array.from({length:rounds},()=>{const traps=Array.from({length:6},random);return[traps,...outcome(stake,pair,stop,traps)];});
}
export async function qualifyKeys(policy){
  const evidence=keysQualificationEvidence(policy),{startNextVariant,moveNextVariant}=await import('../../server/games/casinoNextVariants.ts'),{validNextVariantView}=await import('../../src/shared/casinoNextVariants.ts');
  const{DEMO_BETS}=await import('../../src/shared/demoWallet.ts'),{USDT_BETS}=await import('../../src/shared/usdtWallet.ts');
  assert.deepEqual([...new Set([...DEMO_BETS.map(value=>value*100),...USDT_BETS.map(Number)])].sort((a,b)=>a-b),policy.stakes);
  let serverReplayChecks=0;const serverReplay=[];
  function run(stake,choice,traps){
    const{pair,stop}=parse(choice);let index=0,result=startNextVariant('variant-keys',{variant:{}},String(stake),max=>{assert.equal(max,4);return traps[index++];});
    assert.equal(index,6);assert.equal(result.credit,0);assert.equal(result.ended,false);assert(validNextVariantView(result.variant,'variant-keys',false));
    assert.throws(()=>moveNextVariant('variant-keys',result.engine,'cashout',undefined,String(stake)));
    for(let step=0;step<stop&&!result.ended;step++){
      result=moveNextVariant('variant-keys',result.engine,'unlock',pair,String(stake));assert(validNextVariantView(result.variant,'variant-keys',result.ended));
      if(!result.ended)assert.equal(result.credit,0);
    }
    if(!result.ended)result=moveNextVariant('variant-keys',result.engine,'cashout',undefined,String(stake));
    assert.equal(result.ended,true);assert(validNextVariantView(result.variant,'variant-keys',true));
    return[String(result.credit),result.variant.steps,result.variant.picks.length];
  }
  for(const row of evidence.results){
    const{stop}=parse(row.choice),rows=[];
    for(let encoded=0;encoded<4**stop;encoded++){
      const traps=[...trapsFor(encoded,stop),...Array(6-stop).fill(0)];rows.push([encoded,...run(row.stakeUnits,row.choice,traps)]);serverReplayChecks++;
    }
    assert.equal(jsonHash(rows),row.sha256);
    const streams=policy.seeds.map(seed=>{
      const records=stream(row.stakeUnits,row.choice,seed,policy.serverReplayRoundsPerSeed);
      for(const[traps,...expected]of records){assert.deepEqual(run(row.stakeUnits,row.choice,traps),expected);serverReplayChecks++;}
      return{seed,rounds:records.length,sha256:jsonHash(records)};
    });
    serverReplay.push({choice:row.choice,stakeUnits:row.stakeUnits,outcomes:rows.length,sha256:jsonHash(rows),streams});
  }
  return{...evidence,serverReplayChecks,serverReplay};
}
export function validateKeysProof(policy,proof){
  const expected=keysQualificationEvidence(policy);assert.equal(proof.method,expected.method);assert.deepEqual(proof.analysis,expected.analysis);assert.deepEqual(proof.results,expected.results);assert.deepEqual(proof.metadataEquivalence,expected.metadataEquivalence);
  assert.equal(proof.serverReplay.length,expected.results.length);let checks=0;
  for(let i=0;i<expected.results.length;i++){
    const result=expected.results[i],row=proof.serverReplay[i];assert.equal(row.choice,result.choice);assert.equal(row.stakeUnits,result.stakeUnits);assert.equal(row.outcomes,result.outcomes);assert.equal(row.sha256,result.sha256);
    assert.deepEqual(row.streams,policy.seeds.map(seed=>({seed,rounds:policy.serverReplayRoundsPerSeed,sha256:jsonHash(stream(result.stakeUnits,result.choice,seed,policy.serverReplayRoundsPerSeed))})));
    checks+=row.outcomes+policy.seeds.length*policy.serverReplayRoundsPerSeed;
  }
  assert.equal(proof.serverReplayChecks,checks);return true;
}
