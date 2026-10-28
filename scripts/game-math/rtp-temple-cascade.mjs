import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import data from '../../src/shared/floodedTempleCascadeData.json' with {type:'json'};
import {CASCADE_METHOD,cascadeRandom,independentCascadeRound} from './rtp-temple-cascade-model.mjs';
export {CASCADE_METHOD};
const digest=()=>createHash('sha256');
const rowFor=(stream,stake)=>({choice:'normal',stakeUnits:stake,samples:stream.paidRounds,paidRounds:stream.paidRounds,cost:stream.paidRounds,reward:stream.reward,rewardSquared:stream.rewardSquared,rtp:stream.rtp,interval95:stream.interval95});
function interval(n,sum,squares){const mean=sum/n,half=1.96*Math.sqrt((squares-sum*sum/n)/(n-1)/n);return {rtp:mean,interval95:[mean-half,mean+half]};}
function statistical(p,row){
  assert([row.paidRounds,row.reward,row.rewardSquared,row.rtp,...row.interval95].every(Number.isFinite));
  const expected=interval(row.paidRounds,row.reward,row.rewardSquared);assert.deepEqual({rtp:row.rtp,interval95:row.interval95},expected,'Invalid cascade statistical evidence');
  const half=(row.interval95[1]-row.interval95[0])/2;
  assert(half>0&&half<=p.maxHalfWidth95,'Cascade estimate is too imprecise');
  assert(row.interval95[0]>=p.target-p.tolerance&&row.interval95[1]<=p.target+p.tolerance,'Cascade confidence interval outside target tolerance');
}
function replayDraw(seed,stake,round){
  const random=cascadeRandom((seed+stake+round*7919)>>>0),prefix=[];
  if(round===0){
    for(let c=0;c<5;c++)for(let r=2;r>=0;r--){const symbol=c<3&&r===1?8:(c*3+r)%7;prefix.push(data.baseReels[c].slice(0,symbol).reduce((a,b)=>a+b,0));}
  }else if(round===1)prefix.push(...Array(15).fill(0));
  return maximum=>prefix.length?prefix.shift():random(maximum);
}
export function expectedCascadeCoverage(p){
  return p.stakes.map(stake=>{
    const hash=digest();let falls=0,freeSpins=0;
    for(const seed of p.seeds){
      for(let i=0;i<p.serverReplayRoundsPerSeed;i++){
        const random=replayDraw(seed,stake,i);
        const trace=[],s=independentCascadeRound(random,trace);falls+=s.falls;freeSpins+=s.played;
        hash.update(JSON.stringify([seed,i,String(s.points*(stake/20)),trace])+'\n');
      }
    }
    return {stakeUnits:stake,paidRounds:p.seeds.length*p.serverReplayRoundsPerSeed,forcedBonusRounds:p.seeds.length,forcedCapRounds:p.seeds.length,falls,freeSpins,sha256:hash.digest('hex')};
  });
}
export function validateCascadeProof(p,proof){
  assert.equal(p.method,CASCADE_METHOD);assert.equal(p.rulesVersion,2);assert.equal(p.progressVersion,2);
  assert.equal(p.target,.96);assert(p.tolerance<=.0025);assert(p.maxHalfWidth95<=.001);assert.equal(p.confidenceZ,1.96);
  assert(p.qualificationRoundsPerSeed>=5000000);assert.deepEqual(p.stakes,[1000,2000,5000,10000,20000,50000]);assert.deepEqual(p.choices,['normal']);
  assert.equal(new Set([...p.seeds,...p.calibrationSeeds]).size,p.seeds.length+p.calibrationSeeds.length);assert(p.seeds.length>=2);
  assert.equal(proof.method,CASCADE_METHOD);assert.equal(proof.streams.length,p.seeds.length);
  let n=0,reward=0,squares=0;
  for(const seed of p.seeds){
    const stream=proof.streams.find(s=>s.seed===seed);assert(stream);assert.equal(stream.paidRounds,p.qualificationRoundsPerSeed);statistical(p,stream);
    assert(Number.isSafeInteger(stream.falls)&&stream.falls>=stream.paidRounds&&stream.freeSpins>0&&stream.bonusRounds>0&&stream.capped>0);
    assert(stream.positive<=stream.paidRounds&&stream.aboveStake<=stream.positive);n+=stream.paidRounds;reward+=stream.reward;squares+=stream.rewardSquared;
  }
  const aggregate={paidRounds:n,reward,rewardSquared:squares,...interval(n,reward,squares)};statistical(p,aggregate);
  assert.deepEqual(proof.results,p.stakes.map(stake=>rowFor(aggregate,stake)),'Every stake must use the complete-round homogeneous integer model');
  assert.deepEqual(proof.serverReplay.coverage,expectedCascadeCoverage(p));
  assert.equal(proof.serverReplayChecks,p.stakes.length*p.seeds.length*p.serverReplayRoundsPerSeed);
  assert.deepEqual(proof.analysis,{lineStakeDivisor:20,payoutPointCap:10000,maximumPayoutX:500,integerScalingForAllStakes:true,distinctPaidRounds:n,stakeRowsShareHomogeneousPaths:true,estimator:'independent-row-major-complete-round',exactRtp:false});
  return true;
}
async function serverReplay(p){
  const built=await build({entryPoints:[fileURLToPath(new URL('../../server/games/floodedTempleCascade.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
  const {startTempleCascade,moveTempleCascade}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
  const coverage=[];
  for(const stake of p.stakes){
    const hash=digest();let falls=0,freeSpins=0;
    for(const seed of p.seeds){
      for(let i=0;i<p.serverReplayRoundsPerSeed;i++){
        const source=replayDraw(seed,stake,i),model=replayDraw(seed,stake,i);
        const expected=[],score=independentCascadeRound(model,expected),actual=[];
        let round=startTempleCascade({temple:{mode:'cascades'}},String(stake),source);
        while(true){
          for(const {wins,bonusLines,...frame}of round.view.frames)actual.push(frame);
          if(round.ended)break;assert.equal(round.credit,0);round=moveTempleCascade(round.view,String(stake),round.view.revision,'temple-cascade',source);
        }
        assert.deepEqual(actual,expected);assert.equal(round.credit,score.points*(stake/20));falls+=score.falls;freeSpins+=score.played;
        hash.update(JSON.stringify([seed,i,String(round.credit),actual])+'\n');
      }
    }
    coverage.push({stakeUnits:stake,paidRounds:p.seeds.length*p.serverReplayRoundsPerSeed,forcedBonusRounds:p.seeds.length,forcedCapRounds:p.seeds.length,falls,freeSpins,sha256:hash.digest('hex')});
  }
  assert.deepEqual(coverage,expectedCascadeCoverage(p));return {coverage};
}
export async function qualifyTempleCascade(p,onProgress){
  const replay=await serverReplay(p);onProgress?.({phase:'cascade-server-replay',checks:p.stakes.length*p.seeds.length*p.serverReplayRoundsPerSeed});
  const streams=await Promise.all(p.seeds.map(seed=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./rtp-temple-cascade-worker.mjs',import.meta.url),{workerData:{seed,rounds:p.qualificationRoundsPerSeed},execArgv:process.execArgv.filter(v=>!v.startsWith('--input-type'))});
    let complete=false;worker.on('message',v=>{if(v.progress)onProgress?.(v.progress);if(v.result){complete=true;resolve(v.result);}});worker.on('error',reject);worker.on('exit',code=>{if(code!==0||!complete)reject(Error('Cascade qualification worker stopped: '+code));});
  })));
  const n=streams.reduce((s,r)=>s+r.paidRounds,0),reward=streams.reduce((s,r)=>s+r.reward,0),squares=streams.reduce((s,r)=>s+r.rewardSquared,0),combined={paidRounds:n,reward,rewardSquared:squares,...interval(n,reward,squares)};
  return {method:CASCADE_METHOD,analysis:{lineStakeDivisor:20,payoutPointCap:10000,maximumPayoutX:500,integerScalingForAllStakes:true,distinctPaidRounds:n,stakeRowsShareHomogeneousPaths:true,estimator:'independent-row-major-complete-round',exactRtp:false},results:p.stakes.map(stake=>rowFor(combined,stake)),streams,serverReplay:replay,serverReplayChecks:p.stakes.length*p.seeds.length*p.serverReplayRoundsPerSeed};
}
