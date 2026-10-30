import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WILD_NUDGE_DATA as R,WILD_NUDGE_STAKES,wildNudgeSpin,wildNudgeRound} from '../../src/shared/wildNudgeMath.ts';
import {referenceNudgeSpin} from './wild-nudge-reference.mjs';

/** Unbiased bounded tickets from independent deterministic SHA-256 streams, never production RNG. */
export function nudgeSeeded(seed){
  let counter=0,block=Buffer.alloc(0),offset=0;
  return maximum=>{
    assert(Number.isInteger(maximum)&&maximum>0&&maximum<=2**32);
    const limit=2**32-(2**32%maximum);let word;
    do{
      if(offset>=block.length){block=createHash('sha256').update('wild-nudge-qualification:'+seed+':'+counter++).digest();offset=0;}
      word=block.readUInt32LE(offset);offset+=4;
    }while(word>=limit);
    return word%maximum;
  };
}
export function replayWildNudgeModel(seeds,rounds){
  const coverage=[];let bonusRounds=0;
  for(const seed of seeds)for(const stakeUnits of WILD_NUDGE_STAKES){
    const random=nudgeSeeded(seed),digest=createHash('sha256');let spins=0,bonuses=0;
    for(let round=0;round<rounds;round++){
      const baseStops=R.reels.map(reel=>random(reel.length)),base=referenceNudgeSpin(baseStops,'base',R);
      const bonusStops=Array.from({length:base.awardedSpins},()=>R.reels.map(reel=>random(reel.length)));
      const actual=wildNudgeRound({stakeUnits,baseStops,bonusStops}),bonus=bonusStops.map(stops=>referenceNudgeSpin(stops,'bonus',R));
      assert.deepEqual(actual.base,base);assert.deepEqual(actual.bonus,bonus);
      const points=BigInt([base,...bonus].reduce((n,spin)=>n+spin.points,0));
      assert.equal(actual.payoutUnits,String(BigInt(stakeUnits)*points/100n));assert.equal(actual.costUnits,stakeUnits);
      digest.update(JSON.stringify({baseStops,bonusStops,payoutUnits:actual.payoutUnits})+'\n');
      spins+=1+bonus.length;bonuses+=Number(bonus.length>0);
    }
    bonusRounds+=bonuses;coverage.push({seed,stakeUnits,paidRounds:rounds,spins,bonusRounds:bonuses,sha256:digest.digest('hex')});
  }
  return {scope:'pure-model-reference-replay',server:false,wallet:false,coverage,checks:coverage.reduce((n,row)=>n+row.paidRounds,0),bonusRounds,
    coupling:'The same stream is reused across stakes to check integer scaling; coverage rows are not independent statistical samples.'};
}
function wilson(successes,n){
  const z=1.959963984540054,p=successes/n,denominator=1+z*z/n;
  const center=(p+z*z/(2*n))/denominator,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denominator;
  return [center-half,center+half];
}
export function characterizeWildNudge(seeds,roundsPerSeed){
  let count=0,total=0,squares=0,hit=0,profit=0,bonuses=0,zero=0,maximum=0;const histogram=new Map(),streams=[];
  for(const seed of seeds){
    const random=nudgeSeeded('characterization:'+seed),digest=createHash('sha256');let streamPoints=0,streamBonuses=0;
    for(let i=0;i<roundsPerSeed;i++){
      const base=wildNudgeSpin(R.reels.map(reel=>random(reel.length)),'base');let points=base.points;
      for(let spin=0;spin<base.awardedSpins;spin++)points+=wildNudgeSpin(R.reels.map(reel=>random(reel.length)),'bonus').points;
      count++;total+=points;squares+=points*points;hit+=Number(points>0);profit+=Number(points>100);zero+=Number(points===0);bonuses+=Number(base.awardedSpins>0);maximum=Math.max(maximum,points);
      histogram.set(points,(histogram.get(points)??0)+1);streamPoints+=points;streamBonuses+=Number(base.awardedSpins>0);digest.update(String(points)+',');
    }
    streams.push({seed,rounds:roundsPerSeed,payoutPoints:streamPoints,bonusRounds:streamBonuses,sha256:digest.digest('hex')});
  }
  assert(Number.isSafeInteger(total)&&Number.isSafeInteger(squares));
  const rtp=total/count/100,variance=(squares-total*total/count)/(count-1)/10000,half=1.959963984540054*Math.sqrt(variance/count);
  const bins=[...histogram].sort((a,b)=>a[0]-b[0]);
  const quantile=p=>{let mass=0;for(const [value,n]of bins){mass+=n;if(mass>=Math.ceil(count*p))return value/100;}throw Error('Missing quantile');};
  return {scope:'sampled-pure-model-characterization',releaseQualified:false,seeds,roundsPerSeed,paidRounds:count,streams,
    observedRtp:rtp,approximateNormalInterval95:[rtp-half,rtp+half],sampleStandardDeviationInStakes:Math.sqrt(variance),
    anyPayout:{count:hit,rate:hit/count,wilson95:wilson(hit,count)},netPositive:{count:profit,rate:profit/count,wilson95:wilson(profit,count)},
    zeroPayout:{count:zero,rate:zero/count,wilson95:wilson(zero,count)},bonusEntry:{count:bonuses,rate:bonuses/count,wilson95:wilson(bonuses,count)},
    payoutQuantilesInStakes:{p50:quantile(.5),p90:quantile(.9),p95:quantile(.95),p99:quantile(.99),p999:quantile(.999)},observedMaximumInStakes:maximum/100,
    interpretation:'Observed characterization of full paid rounds, not exact hit/profit probabilities or certification. The normal RTP interval may underrepresent rare tails. Exact RTP and maximum come from the finite model, independently of this sample. Any payout includes returns below stake; only payout above cost is net positive.'};
}
const root=new URL('../../',import.meta.url);
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const policy=JSON.parse(await readFile(new URL('scripts/game-math/rtp-policy.json',root),'utf8')).profiles['studio-wild-nudge'];
  const report={replay:replayWildNudgeModel(policy.seeds,policy.modelReplayRoundsPerSeed),characterization:characterizeWildNudge(policy.seeds,125000)};
  report.sourceSha256=createHash('sha256').update((await readFile(new URL('scripts/game-math/wild-nudge-characterize.mjs',root),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
  if(process.argv.includes('--write'))await writeFile(new URL('docs/concepts/wild-nudge/characterization.json',root),JSON.stringify(report,null,2)+'\n');
  if(process.argv.includes('--verify'))assert.deepEqual(JSON.parse(await readFile(new URL('docs/concepts/wild-nudge/characterization.json',root),'utf8')),report,'Stale characterization');
  console.log(JSON.stringify({replayChecks:report.replay.checks,...report.characterization},null,2));
}
