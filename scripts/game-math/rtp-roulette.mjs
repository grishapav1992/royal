import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const ROULETTE_METHOD='exhaustive-european-roulette-v1';
// Independently written table, not imported from production colour or payout helpers.
const red=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
export const rouletteChoices=['red','black','even','odd',...Array.from({length:37},(_,n)=>'number-'+n)];
const inputFor=choice=>choice.startsWith('number-')?{bet:'number',number:Number(choice.slice(7))}:{bet:choice};
function multiplier(choice,n){
  const won=choice.startsWith('number-')?n===Number(choice.slice(7)):n!==0&&(choice==='red'?red.includes(n):choice==='black'?!red.includes(n):choice==='even'?n%2===0:n%2===1);
  return won?(choice.startsWith('number-')?36:2):0;
}
export function rouletteQualificationEvidence(policy){
  assert.equal(policy.method,ROULETTE_METHOD);assert.equal(policy.rulesVersion,1);assert.equal(policy.progressVersion,1);
  assert.deepEqual(policy.choices,rouletteChoices);assert.deepEqual(policy.stakes,[1000,5000,10000,50000]);
  assert.equal(policy.target,36/37);assert.equal(policy.tolerance,1e-12);
  assert.equal(new Set(policy.seeds).size,2);assert(policy.seeds.every(Number.isSafeInteger));assert.equal(policy.serverReplayRoundsPerSeed,64);
  const results=[];
  for(const choice of policy.choices)for(const stakeUnits of policy.stakes){
    const stake=BigInt(stakeUnits),hash=createHash('sha256');let returned=0n,wins=0;
    for(let n=0;n<37;n++){
      const mult=multiplier(choice,n),payout=stake*BigInt(mult);returned+=payout;if(mult)wins++;
      hash.update(JSON.stringify([n,mult,String(payout)])+'\n');
    }
    assert.equal(returned,36n*stake);assert.equal(wins,choice.startsWith('number-')?1:18);
    results.push({choice,stakeUnits,outcomes:37,wins,totalCostUnits:String(37n*stake),totalReturnedUnits:String(returned),rtp:36/37,rtpBounds:[36/37,36/37],sha256:hash.digest('hex')});
  }
  return{method:ROULETTE_METHOD,analysis:{outcomes:37,equalProbability:'1/37',completeRound:'One accepted stake and one settled draw; no bonus continuations or additional paid choices.',returnNumerator:36,returnDenominator:37,houseEdgeNumerator:1,houseEdgeDenominator:37,settlement:'Exact integer stake units multiplied by 0, 2 or 36. No rounding loss at any positive integer stake.',allPositiveIntegerStakes:'For stake s, the sum of returns over 37 equally likely outcomes is exactly 36*s for every available choice.',boundsKind:'Exact exhaustive bounds. Sampling confidence intervals are not used for the analytical RTP.'},results};
}
export async function qualifyRoulette(policy){
  const evidence=rouletteQualificationEvidence(policy);
  const {prepareGame,verifyGameRound}=await import('../../server/games/core.ts');
  const {DEMO_BETS}=await import('../../src/shared/demoWallet.ts');
  assert.deepEqual(DEMO_BETS.map(amount=>amount*100),policy.stakes,'Qualify every allowed wallet stake');
  let serverReplayChecks=0;
  const replay=[];
  for(const row of evidence.results){
    const game=prepareGame('royal-roulette',1,inputFor(row.choice));const hash=createHash('sha256');
    for(let n=0;n<37;n++){
      let calls=0;const round=game.play(BigInt(row.stakeUnits),max=>{assert.equal(max,37);calls++;return n;});
      assert.equal(calls,1);assert(verifyGameRound(round));assert.equal(round.multiplier,multiplier(row.choice,n));
      assert.equal(round.payoutUnits,String(BigInt(row.stakeUnits)*BigInt(multiplier(row.choice,n))));
      hash.update(JSON.stringify([n,round.multiplier,round.payoutUnits])+'\n');serverReplayChecks++;
    }
    assert.equal(hash.digest('hex'),row.sha256);
    // Smallest integer unit and a stake beyond Number's exact range independently test linear settlement.
    for(const stake of [1n,9007199254740993123456789n])for(let n=0;n<37;n++){
      const round=game.play(stake,()=>n);assert(verifyGameRound(round));assert.equal(round.payoutUnits,String(stake*BigInt(multiplier(row.choice,n))));serverReplayChecks++;
    }
    const streams=[];
    for(const seed of policy.seeds){
      let state=(seed+policy.choices.indexOf(row.choice)*1000003)>>>0;
      const hash=createHash('sha256');
      for(let i=0;i<policy.serverReplayRoundsPerSeed;i++){
        let observed;
        const round=game.play(BigInt(row.stakeUnits),max=>{state^=state<<13;state^=state>>>17;state^=state<<5;observed=(state>>>0)%max;return observed;});
        assert(verifyGameRound(round));assert.equal(round.multiplier,multiplier(row.choice,observed));
        hash.update(JSON.stringify(round)+'\n');serverReplayChecks++;
      }
      streams.push({seed,rounds:policy.serverReplayRoundsPerSeed,sha256:hash.digest('hex')});
    }
    replay.push({choice:row.choice,stakeUnits:row.stakeUnits,exhaustiveOutcomes:37,integerBoundaryChecks:74,streams});
  }
  return{...evidence,serverReplayChecks,serverReplay:replay};
}
export function validateRouletteProof(policy,proof){
  const expected=rouletteQualificationEvidence(policy);
  assert.equal(proof.method,expected.method);assert.deepEqual(proof.analysis,expected.analysis);assert.deepEqual(proof.results,expected.results);
  assert.equal(proof.serverReplay.length,expected.results.length);
  let count=0;const seen=new Set();
  for(const row of proof.serverReplay){
    const key=row.choice+':'+row.stakeUnits;assert(!seen.has(key));seen.add(key);
    assert(expected.results.some(r=>r.choice===row.choice&&r.stakeUnits===row.stakeUnits));
    assert.equal(row.exhaustiveOutcomes,37);assert.equal(row.integerBoundaryChecks,74);
    assert.deepEqual(row.streams.map(stream=>stream.seed),policy.seeds);
    for(const stream of row.streams){assert.equal(stream.rounds,64);assert.match(stream.sha256,/^[a-f0-9]{64}$/);count+=stream.rounds;}
    count+=row.exhaustiveOutcomes+row.integerBoundaryChecks;
  }
  assert.equal(proof.serverReplayChecks,count);return true;
}
