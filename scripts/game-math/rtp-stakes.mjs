import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeForestHeart} from './forest-heart-model.mjs';
export const STAKE_PRECISION_METHOD='full-round-unbiased-cent-policy-v1';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const textHash=value=>hash(value.toString('utf8').replace(/\r\n/g,'\n'));
const stakes=[10,20,50,100,200,500,1000,2000,5000];
const referenceCache=new Map();
const readJson=file=>JSON.parse(readFileSync(resolve(root,file),'utf8'));
const ratio=value=>{const [whole,fraction='']=String(value).split('.');assert(/^\d+$/.test(whole)&&/^\d{0,4}$/.test(fraction));return [BigInt(whole+fraction),10n**BigInt(fraction.length)];};
const choose=(n,k)=>{let value=1n;for(let i=1;i<=k;i++)value=value*BigInt(n-i+1)/BigInt(i);return value;};
const refs={
 'studio-cosmic-escape':'docs/game-math/qualifications/cosmic-v3.json',
 'studio-caribbean-treasures':'docs/game-math/qualifications/caribbean-treasures-v1.json',
 'studio-flooded-temple':'docs/game-math/qualifications/flooded-temple-v2.json',
 'studio-afterglow':'docs/game-math/qualifications/girlhub-progress-v4.json',
 'studio-dracona':'docs/game-math/qualifications/dracona-v3.json',
 'studio-neopolis':'docs/game-math/qualifications/neopolis-v4.json',
};
export const referencePath=id=>refs[id];
function reference(id){const path=refs[id];assert(path,'Missing reference model');const bytes=readFileSync(resolve(root,path)),digest=hash(bytes);if(referenceCache.get(id)?.digest===digest)return referenceCache.get(id);const record={path,digest,proof:JSON.parse(bytes)};referenceCache.set(id,record);return record;}
export function precisionLaw(){return {
 method:'Independent uniform final ticket; exact BigInt rational accumulation and integer settlement',
 identity:'For exact reward n/d, let q=floor(n/d), r=n mod d and uniform U in {0,...,d-1}. Pay q+1 if U<r, otherwise q. The sum over all tickets is q*d+r=n.',
 stopping:'The ticket is drawn only after the final player choice and every free continuation. No future rounding ticket is exposed to adaptive choices.',
 preservation:'Every intermediate discarded fraction is restored before the final ticket. For a fixed consumed path the expected credit equals its capped exact reward, and the actual credit never falls below the original sum of floors.',
 caps:'Nonnegative rewards couple every denomination to the same latent capped paid round. Stopping a presentation after its floor reaches the cap does not change that round reward.',
 compatibility:'Only starts pinned to stakePolicyVersion=1 use this receipt. Accepted historical rounds and UUID replays retain their original rules and committed credit.',
 confidence:'Exact analytical bounds and statistical intervals are labelled separately. A statistical estimate is not an exact RTP. Conditional estimates are per case, not simultaneous confidence guarantees.',
};}
export function sampleStatistics(streams,z){
 const n=streams.reduce((sum,row)=>sum+row.paidRounds,0),reward=streams.reduce((sum,row)=>sum+row.reward,0),squares=streams.reduce((sum,row)=>sum+row.rewardSquared,0);
 assert(n>1);const rtp=reward/n,half=z*Math.sqrt(n*Math.max(0,squares-2*rtp*reward+rtp*rtp*n)/(n-1))/n;
 return {paidRounds:n,reward,rewardSquared:squares,rtp,interval95:[rtp-half,rtp+half],halfWidth:half};
}
function checkSample(policy,record,choice){
 assert.equal(record.game,policy.samplerGame);assert.equal(record.choice,choice);assert([1,2].includes(record.look));
 assert.equal(policy.confidenceZ,2.241402727604947);assert.deepEqual(policy.qualificationLooks,[1000000,25000000]);
 assert.deepEqual(record.streams.map(s=>s.seed),policy.seeds);assert.equal(record.streams.length,2);
 for(const stream of record.streams){assert.equal(stream.game,policy.samplerGame);assert.equal(stream.choice,choice);assert.equal(stream.paidRounds,policy.qualificationLooks[record.look-1]);
  assert(stream.sourceHashes&&Object.keys(stream.sourceHashes).length>=10,'Fresh sampler source binding is required');
  for(const [file,digest]of Object.entries(stream.sourceHashes))assert.equal(textHash(readFileSync(resolve(root,file))),digest,'Sampled mathematical source changed: '+file);
 }
 const stats=sampleStatistics(record.streams,policy.confidenceZ);assert.deepEqual(record.statistics,stats);
 assert(stats.paidRounds>=policy.minPaidRounds&&stats.halfWidth>0&&stats.halfWidth<=policy.maxHalfWidth95);
 assert(Math.abs(stats.rtp-policy.target)<=policy.tolerance&&stats.interval95[1]<=policy.maxUpper95,'Complete-round RTP budget failed: '+choice);
 assert.equal(record.passed,true);return stats;
}
function checkEstimate(p,row){
 assert([row.rtp,...row.interval95].every(Number.isFinite));const half=(row.interval95[1]-row.interval95[0])/2;
 assert(Math.abs(row.rtp-p.target)<=p.tolerance&&half>0&&half<=.01&&row.interval95[1]<.98,'Reference conditional precision budget failed');
}
function models(game,p,evidence){
 const rows=[],push=(choice,fields)=>{for(const stakeUnits of stakes)rows.push({choice,stakeUnits,...fields});};
 if(p.kind==='series'){
  for(const stake of stakes){let paths=0;let maximumDenominator=0n;
   const visit=(depth,n,d)=>{if(depth){paths++;const numerator=BigInt(stake)*99n*100n**BigInt(depth),denominator=100n*n;
     assert.equal(numerator*n*100n,denominator*d*BigInt(stake)*99n);if(denominator>maximumDenominator)maximumDenominator=denominator;}
    if(depth<5)for(const chance of [75n,60n,45n])visit(depth+1,n*chance,d*100n);
   };visit(0,1n,1n);assert.equal(paths,363);
   rows.push({choice:p.choices[0],stakeUnits:stake,kind:'exact',rtp:.99,rtpBounds:[.99,.99],successfulRiskPaths:paths,maximumTicketDenominator:String(maximumDenominator),adaptiveStopping:'Backward induction over all five stopping points; every continuing risk has the same conditional exact return.'});
  }return rows;
 }
 if(p.kind==='flags'){for(const mode of p.choices)push(mode,{kind:'exact',countries:mode==='classic'?12:mode==='expanded'?24:48,rtp:.96,rtpBounds:[.96,.96],choices:'Every country in the mode has equal probability.'});return rows;}
 if(p.kind==='roulette'){push(p.choices[0],{kind:'exact',outcomes:37,paidChoices:41,rtp:36/37,rtpBounds:[36/37,36/37]});return rows;}
 if(p.kind==='crash'){
  const epsilon=200/2**48,lower=.99*100/101-epsilon;
  push(p.choices[0],{kind:'exact-outward-bounds',rtp:null,rtpBounds:[lower,.99+epsilon],entropyOutcomes:String(2n**48n),cashoutHundredths:[100,9999],automaticCap:100,reason:'The original 48-bit Crash law is preserved. Every server time is bounded by its displayed hundredth and the next one; final integer-cent settlement adds no stake-dependent loss.'});return rows;
 }
 if(p.kind==='forest'){
  const analysis=analyzeForestHeart();for(const choice of p.choices){const strategy=analysis.strategies.find(r=>r.choice===choice);assert(strategy);const rtp=strategy.rtp.decimal;assert(Math.abs(rtp-p.targetsByChoice[choice])<1e-14);push(choice,{kind:'exact',rtp,rtpBounds:[rtp,rtp],fraction:strategy.rtp});}return rows;
 }
 if(p.kind==='plinko'){
  assert(evidence.tables);for(const choice of p.choices){const [n]=choice.split(':'),count=Number(n),table=evidence.tables[choice];assert.equal(table.length,count+1);assert.equal(hash(JSON.stringify(table)),p.tableHashes[choice]);let num=0n,den=1n;
   for(let k=0;k<=count;k++){const [a,b]=ratio(table[k]),weight=choose(count,k);num=num*b+a*weight*den;den*=b;const g=(x,y)=>y?g(y,x%y):x;const factor=g(num,den);num/=factor;den/=factor;}
   den*=2n**BigInt(count);const rtp=Number(num)/Number(den);assert(Math.abs(rtp-p.targetsByChoice[choice])<1e-12);
   push(choice,{kind:'exact',rtp,rtpBounds:[rtp,rtp],fraction:{numerator:String(num),denominator:String(den)},paths:String(2n**BigInt(count))});
  }return rows;
 }
 if(p.kind==='sampled-slots'){
  assert(evidence.samples);for(const choice of p.choices){const stats=checkSample(p,evidence.samples.find(r=>r.choice===choice),choice);push(choice,{kind:'statistical-estimate',...stats,estimator:'Complete paid-round expectation, with final ticket integrated out exactly (Rao-Blackwell estimator). Independent qualification streams, including every free continuation and the cap.'});}return rows;
 }
 const ref=reference(game);assert.equal(evidence.reference?.path,ref.path);assert.equal(evidence.reference?.sha256,ref.digest);
 if(p.kind==='cosmic'){
  for(const choice of p.choices){const r=ref.proof.results.find(row=>row.choice===choice);assert(r);assert(r.rtpBounds[0]>=p.target-p.tolerance&&r.rtpBounds[1]<=p.target+p.tolerance);push(choice,{kind:'deterministic-model-bounds',rtp:null,rtpBounds:r.rtpBounds,reason:'The reference exact beam/echo/energy model and cap bounds apply to the same nonnegative latent round at every stake.'});}return rows;
 }
 if(p.kind==='caribbean'){
  for(const choice of p.choices){const match=/^lines-(1|5|10|20)-(normal|buy)-(raid|flagship)$/.exec(choice);assert(match);const lines=Number(match[1]);let rtp;
   if(match[2]==='normal')rtp=ref.proof.results.find(r=>r.choice===choice).rtp.value;
   else {const spin=ref.proof.analysis.spinMeans[lines][match[3]].value,count=match[3]==='raid'?14:6,cost={1:25574653,5:19673213,10:17499269,20:17803460}[lines];rtp=spin*count/(cost/1000000);}
   assert(Math.abs(rtp-p.target)<=p.tolerance);push(choice,{kind:'exact',rtp,rtpBounds:[rtp,rtp],price:'Normal stake is total across all selected lines. Bought-bonus expected payout includes the exact charged-price/ideal-price ratio before final cent settlement.'});
  }return rows;
 }
 if(p.kind==='neopolis'){
  const states=ref.proof.precisionStateResults;assert.equal(states?.length,48,'Regenerate Neopolis with exact conditional reward moments');
  for(const hero of p.choices){const selected=states.filter(r=>r.choice===hero);assert.equal(selected.length,16);for(const r of selected)checkEstimate(p,r);
   push(hero,{kind:'conditional-statistical-estimates',rtp:null,rtpEstimateRange:[Math.min(...selected.map(r=>r.rtp)),Math.max(...selected.map(r=>r.rtp))],interval95Envelope:[Math.min(...selected.map(r=>r.interval95[0])),Math.max(...selected.map(r=>r.interval95[1]))],publicStates:16,adaptiveStakes:'For any paid decision, exact conditional return is denomination-independent. Positive cost weights form a convex mixture of these conditional expectations; no future ticket is available before the decision.'});
  }return rows;
 }
 const row=p.kind==='dracona'?ref.proof.precisionResult:ref.proof.results[0];assert(row,'Regenerate reference exact-reward moments');checkEstimate(p,row);
 for(const choice of p.choices)push(choice,{kind:'statistical-estimate',rtp:row.rtp,interval95:row.interval95,paidRounds:row.paidRounds,estimator:p.kind==='temple'?'Independent complete cascade-round point model, scaled exactly and settled without cent loss.':'Complete paid-round exact-reward moments, including all bonus state and caps.'});return rows;
}
export function validateStakeProof(game,inputs,proof){
 const p=inputs.policy;assert.equal(p.method,STAKE_PRECISION_METHOD);assert.equal(p.stakePolicyVersion,1);assert.deepEqual(p.stakes,stakes);assert.equal(new Set([...p.seeds,...p.calibrationSeeds]).size,4);
 assert.equal(proof.schemaVersion,1);assert.equal(proof.gameId,game);assert.equal(proof.rulesVersion,p.rulesVersion);assert.equal(proof.progressVersion,p.progressVersion);assert.equal(proof.method,STAKE_PRECISION_METHOD);
 assert.equal(proof.policySha256,inputs.policySha256);assert.deepEqual(proof.sourceHashes,inputs.sourceHashes);assert.deepEqual(proof.precisionLaw,precisionLaw());assert.deepEqual(proof.results,models(game,p,proof.evidence));
 assert.equal(proof.replay.coverage.length,p.choices.length*stakes.length);let checks=0;
 for(const choice of p.choices)for(const stake of stakes){const r=proof.replay.coverage.find(r=>r.choice===choice&&r.stakeUnits===stake);assert(r);assert.equal(r.paidRounds,p.seeds.length*p.serverReplayRoundsPerSeed);assert(r.spins>=r.paidRounds);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert(r.minimumExtraUnits>=0);checks+=r.paidRounds;}
 assert.equal(proof.serverReplayChecks,checks);assert(proof.walletEvidence?.passed&&proof.walletEvidence.gameId===game,'Fresh common-wallet precision evidence is required');assert.match(proof.walletEvidence.sha256,/^[a-f0-9]{64}$/);assert.equal(proof.walletEvidence.cases,p.choices.length*stakes.length);assert.equal(proof.walletEvidence.replayAndRestartCases,proof.walletEvidence.cases);assert(proof.walletEvidence.oneDebitAndCredit&&proof.walletEvidence.clientVerified&&proof.walletEvidence.native?.passed&&proof.walletEvidence.native.journalBalanced);return true;
}
export async function qualifyStakes(game,inputs,options={},progress=()=>{}){
 const p=inputs.policy,evidence={};
 if(p.kind==='plinko'){const {getPlinkoMultipliers}=await import('../../src/shared/originalGames.ts');evidence.tables=Object.fromEntries(p.choices.map(c=>{const [rows,risk]=c.split(':');return[c,getPlinkoMultipliers(Number(rows),risk)];}));}
 if(p.kind==='sampled-slots'){const directory=resolve(root,options.sampleDirectory??'../formal-samples');evidence.samples=p.choices.map(choice=>JSON.parse(readFileSync(resolve(directory,p.samplerGame+'-'+choice+'.json'),'utf8')));}
 if(refs[game]){const ref=reference(game);evidence.reference={path:ref.path,sha256:ref.digest};}
 const results=models(game,p,evidence),{runtimeRound}=await import('./stake-runtime.mjs');
 const coverage=[];let checks=0;
 for(const choice of p.choices)for(const stakeUnits of stakes){const digest=createHash('sha256');let spins=0,minimumExtraUnits=Infinity,maximumExtraUnits=0;
  for(const seed of p.seeds)for(let i=0;i<p.serverReplayRoundsPerSeed;i++){
   const r=runtimeRound(game,choice,String(stakeUnits),(seed+i*7919)>>>0);assert(BigInt(r.base)<=r.exact.numerator/r.exact.denominator);const extra=Number(BigInt(r.precision.creditedUnits)-BigInt(r.base));assert(extra>=0);minimumExtraUnits=Math.min(minimumExtraUnits,extra);maximumExtraUnits=Math.max(maximumExtraUnits,extra);spins+=r.spins;checks++;digest.update(JSON.stringify([seed,i,r.base,r.precision,r.tape])+'\n');
  }
  coverage.push({choice,stakeUnits,paidRounds:p.seeds.length*p.serverReplayRoundsPerSeed,spins,minimumExtraUnits,maximumExtraUnits,sha256:digest.digest('hex')});
 }
 progress({phase:'complete-round-precision-replay',game,checks});
 const {qualifyStakeWallet}=await import('./stakes-wallet.ts');const walletEvidence=await qualifyStakeWallet(game,p);
 return {method:STAKE_PRECISION_METHOD,precisionLaw:precisionLaw(),results,evidence,replay:{coverage},serverReplayChecks:checks,walletEvidence};
}
