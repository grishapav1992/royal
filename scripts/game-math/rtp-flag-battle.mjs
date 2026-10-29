import assert from 'node:assert/strict';
import { startFlagBattle } from '../../server/games/flagBattle.ts';
import { FLAG_BETS, FLAG_MODES, flagCountries, flagPayout, validFlagView } from '../../src/shared/flagBattle.ts';

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
  assert.equal(p.method,'uniform-flag-battle-v2'); assert.equal(p.rulesVersion,2);
  assert.deepEqual(p.stakes,FLAG_BETS.map(Number));
  const modes=[{id:'legacy',count:12},...FLAG_MODES];
  assert.deepEqual(FLAG_MODES.map(m=>[m.id,m.count]),[['classic',12],['expanded',24],['world',48]]);
  assert.deepEqual(p.choices,modes.flatMap(m=>flagCountries(m.id==='legacy'?'classic':m.id).map(c=>m.id+':'+c.id)));
  assert.equal(p.target,.96); assert.equal(p.qualificationRoundsPerSeed,8000000); assert.equal(p.serverReplayRunsPerWinner,16);
  assert.deepEqual(p.seeds,[74117,910493]);
  const results=[],streams=[],modeAnalysis=[]; let serverReplayChecks=0;
  for(const [modeIndex,mode]of modes.entries()){
    const id=mode.id==='legacy'?'classic':mode.id, countries=flagCountries(id),wins=Array(mode.count).fill(0);
    // Common random numbers compare unpaid country choices on the same uniform winner stream.
    // This independent model never calls the server permutation to generate the estimate.
    for(const seed of p.seeds){
      const draw=rng(seed+modeIndex*1000003),counts=Array(mode.count).fill(0);
      for(let n=0;n<p.qualificationRoundsPerSeed;n++)counts[draw(mode.count)]++;
      for(let i=0;i<counts.length;i++){wins[i]+=counts[i];streams.push({choice:mode.id+':'+countries[i].id,seed,streamSeed:seed+modeIndex*1000003,paidRounds:p.qualificationRoundsPerSeed,wins:counts[i]});}
    }
    for(const [index,country]of countries.entries())for(const stake of p.stakes){
      const choice=mode.id+':'+country.id,payout=BigInt(stake)*BigInt(mode.count)*24n/25n;
      assert.equal(flagPayout(String(stake),id),String(payout));
      assert.equal(payout*25n,BigInt(stake)*BigInt(mode.count)*24n,'Allowed stakes settle exactly');
      for(let winner=0;winner<mode.count;winner++)for(let run=0;run<p.serverReplayRunsPerWinner;run++){
        const random=rng(p.seeds[run%2]+run*1009);let first=true;
        const flags=mode.id==='legacy'?{country:country.id}:{country:country.id,mode:id};
        const view=startFlagBattle({flags},String(stake),max=>{if(first){first=false;assert.equal(max,mode.count);return winner;}return random(max);});
        assert(validFlagView(view));assert.equal(view.order.at(-1),countries[winner].id);assert.equal(view.country,country.id);
        assert.equal(view.version,mode.id==='legacy'?1:2);if(view.version===2)assert.equal(view.mode,id);serverReplayChecks++;
      }
      const samples=p.seeds.length*p.qualificationRoundsPerSeed,ratio=Number(payout)/stake,reward=wins[index]*ratio,rewardSquared=wins[index]*ratio*ratio,rtp=reward/samples;
      const residual=Math.max(0,rewardSquared-2*rtp*reward+rtp*rtp*samples),half=1.96*Math.sqrt(samples*residual/(samples-1))/samples;
      results.push({choice,stakeUnits:stake,samples,paidRounds:samples,cycles:0,cost:samples,reward,rewardSquared,rewardCost:reward,costSquared:samples,rtp,interval95:[rtp-half,rtp+half],analyticalRtp:.96});
    }
    modeAnalysis.push({mode:mode.id,probability:'1/'+mode.count,returnMultiplier:(mode.count*24)+'/25',exactRtp:'24/25'});
  }
  return {method:p.method,serverReplayChecks,streams,results,analysis:{modes:modeAnalysis,settlement:'Integer cents. All six stakes divide exactly. No bonus, continuation, cashout or adaptive paid choice exists.',interpretation:'Analytical RTP is exact. Confidence intervals describe independent seeded sampling estimates. Country choices use common random numbers; seed streams are independent and mode streams are separately seeded.'}};
}
