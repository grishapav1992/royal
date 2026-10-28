import assert from 'node:assert/strict';
import { startFlagBattle } from '../../server/games/flagBattle.ts';
import { FLAG_BETS, FLAG_COUNTRIES, flagPayout, validFlagView } from '../../src/shared/flagBattle.ts';

function rng(seed) {
  let state = seed >>> 0;
  return max => {
    const limit = Math.floor(4294967296 / max) * max;
    let n;
    do { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; n = state >>> 0; } while (n >= limit);
    return n % max;
  };
}
export function qualifyFlagBattle(p) {
  assert.equal(p.method,'uniform-flag-battle-v1');
  assert.deepEqual(p.stakes,FLAG_BETS.map(Number));
  assert.deepEqual(p.choices,FLAG_COUNTRIES.map(c=>c.id));
  assert.equal(p.target,.96);assert.equal(p.qualificationRoundsPerSeed,2000000);
  assert.deepEqual(p.seeds,[74117,910493]);
  const results=[],streams=[];let serverReplayChecks=0;
  for(const [index,choice]of p.choices.entries()){
    let wins=0;
    for(const seed of p.seeds){
      const random=rng(seed);let count=0;
      // Independent uniform winner model; the server permutation is checked separately below.
      for(let n=0;n<p.qualificationRoundsPerSeed;n++)if(random(12)===index)count++;
      wins+=count;streams.push({choice,seed,paidRounds:p.qualificationRoundsPerSeed,wins:count});
    }
    for(const stake of p.stakes){
      const payout=BigInt(stake)*288n/25n;
      assert.equal(flagPayout(String(stake)),String(payout));
      assert.equal(payout*25n,BigInt(stake)*288n,'No settlement rounding loss at an allowed stake');
      // Each possible final country is forced through the actual production permutation.
      for(let winner=0;winner<12;winner++)for(let run=0;run<64;run++){
        const random=rng(p.seeds[run%2]+run*1009);let first=true;
        const view=startFlagBattle({flags:{country:choice}},String(stake),max=>{if(first){first=false;assert.equal(max,12);return winner;}return random(max);});
        assert(validFlagView(view));assert.equal(view.order[11],p.choices[winner]);
        assert.equal(view.country,choice);serverReplayChecks++;
      }
      const samples=p.seeds.length*p.qualificationRoundsPerSeed,ratio=Number(payout)/stake;
      const reward=wins*ratio,rewardSquared=wins*ratio*ratio,rtp=reward/samples;
      const residual=Math.max(0,rewardSquared-2*rtp*reward+rtp*rtp*samples);
      const half=1.96*Math.sqrt(samples*residual/(samples-1))/samples;
      results.push({choice,stakeUnits:stake,samples,paidRounds:samples,cycles:0,cost:samples,reward,rewardSquared,rewardCost:reward,costSquared:samples,rtp,interval95:[rtp-half,rtp+half],analyticalRtp:.96});
    }
  }
  return {method:p.method,serverReplayChecks,streams,results,analysis:{exactRtp:'24/25',probability:'1/12',returnMultiplier:'288/25',settlement:'Integer cents; all six stakes divide exactly. No bonus, continuation, cashout or adaptive choice exists.',interpretation:'Analytical expectation is exact. interval95 describes the independent seeded sampling estimate, not an uncertainty in the analytical result.'}};
}
