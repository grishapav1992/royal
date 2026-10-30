import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyzeWildNudge} from './wild-nudge-model.mjs';
import {referenceNudgeSpin,referenceNudgeReel} from './wild-nudge-reference.mjs';
export const NUDGE_RUNTIME_METHOD='exact-wild-nudge-runtime';
export const NUDGE_RUNTIME_REVIEWED_SOURCES={
  "src/shared/wildNudgeMath.ts": "5a4071c32c8da56b508695536aed7079a55b9b4730d00e96606c60545433fa74",
  "src/shared/wildNudgeData.json": "4cc0a4f71c052c276890d8446c1e21e4b3a8dce522f27ee42b7909c5263131d8",
  "src/shared/wildNudge.ts": "de36b83b823d2fd48f69bb2aa0c383a44ffbb80ec287e759dd1115db23775624",
  "server/games/wildNudge.ts": "7d66b6ba4c76045de00b34a780ce26103d4367f6f39143930ee8f0fe6f12aa9e",
  "scripts/game-math/wild-nudge-reference.mjs": "93c3e272abe11523ddd77985c9d733b76b06089a054aac5cf5a9ce4e762e7bb5",
  "scripts/game-math/wild-nudge-model.mjs": "da28188057c963500975637c3ebaaa763f31089445701049d85af0d1073e1ef8"
};
export const NUDGE_WALLET_EXPECTED=['capability-before-entropy','concurrent-paid-start','request-identity-and-ownership','saved-round-and-hidden-future','free-continuation-and-stale-revision','eight-free-spins-one-credit','lost-final-response','all-stakes-integer-journal','atomic-rollback-and-retry','invalid-input-before-entropy','reserve-before-randomness','common-wallet-regression'];
let cached;
export function nudgeRuntimeEvidence(policy){
 assert.equal(policy.method,NUDGE_RUNTIME_METHOD);assert.equal(policy.rulesVersion,1);assert.equal(policy.progressVersion,1);assert.equal(policy.target,.96);assert.equal(policy.tolerance,.002);
 assert.deepEqual(policy.stakes,[100,200,500,1000,2000,5000]);assert.deepEqual(policy.choices,['normal']);assert.deepEqual(policy.seeds,[2026103031,2026103047]);assert.equal(policy.serverReplayRoundsPerSeed,256);
 const analysis=cached??=analyzeWildNudge();assert(analysis.exactRtp.value>=.958&&analysis.exactRtp.value<=.962);
 return {method:NUDGE_RUNTIME_METHOD,scope:'server-engine-and-primary-common-wallet',exactRtp:true,analysis,results:policy.stakes.map(stakeUnits=>({choice:'normal',stakeUnits,rtp:analysis.exactRtp.value,rtpFraction:analysis.exactRtp.fraction,rtpBounds:[analysis.exactRtp.value,analysis.exactRtp.value],paidRounds:0,interpretation:'Exact finite expectation, not a Monte Carlo estimate'}))};
}
export function validateNudgeWalletEvidence(value){
 assert.equal(value.scope,'primary-common-virtual-usdt-wallet');assert.deepEqual(value.cases,NUDGE_WALLET_EXPECTED);assert.equal(value.futureBonusDrawsExposed,false);assert.equal(value.reserveMultiplier,8608);
 assert.equal(value.stakeRows.length,6);for(const [i,row]of value.stakeRows.entries()){assert.equal(row.stakeUnits,String([100,200,500,1000,2000,5000][i]));assert.equal(row.payoutUnits,String(BigInt(row.stakeUnits)*860790n/100n));assert.equal(row.betCount,1);assert.equal(row.creditCount,1);assert.equal(row.freeContinuations,8);}
 const {sha256,...content}=value;assert.equal(sha256,createHash('sha256').update(JSON.stringify(content)).digest('hex'));return true;
}
export function validateNudgeRuntimeProof(gameId,inputs,proof){
 assert.equal(gameId,'studio-wild-nudge');const evidence=nudgeRuntimeEvidence(inputs.policy);
 for(const [name,digest]of Object.entries(NUDGE_RUNTIME_REVIEWED_SOURCES))assert.equal(inputs.sourceHashes[name],digest,'Independently review changed Wild Nudge sources');
 for(const field of ['method','scope','exactRtp','analysis','results'])assert.deepEqual(proof[field],evidence[field]);
 const replay=proof.serverReplay;assert.equal(replay.reelCensusChecks,640);assert.equal(replay.coverage.length,6);assert.equal(replay.forcedMaximumRounds,6);assert.equal(replay.forcedBonusCountsChecked,3);
 assert.deepEqual(replay.seeds,inputs.policy.seeds);for(const [i,row]of replay.coverage.entries()){assert.equal(row.stakeUnits,inputs.policy.stakes[i]);assert.equal(row.paidRounds,512);assert(row.spins>=512);assert.match(row.sha256,/^[a-f0-9]{64}$/);}
 assert.equal(replay.checks,3072);assert.equal(proof.serverReplayChecks,3072);assert(replay.naturalBonusRounds>0);validateNudgeWalletEvidence(proof.walletEvidence);return true;
}
function seeded(seed){let counter=0;return max=>{const limit=2**32-(2**32%max);let word;do{word=createHash('sha256').update(seed+':'+counter++).digest().readUInt32LE(0);}while(word>=limit);return word%max;};}
async function serverReplay(p){
 const {startWildNudge,moveWildNudge}=await import('../../server/games/wildNudge.ts');
 const {WILD_NUDGE_DATA:R}=await import('../../src/shared/wildNudgeMath.ts');
 const {validWildNudgeView}=await import('../../src/shared/wildNudge.ts');
 const settings={wildNudge:{mode:'normal'}},coverage=[];let naturalBonusRounds=0;
 for(const mode of ['base','bonus'])for(let c=0;c<5;c++)for(let stop=0;stop<64;stop++){
  const stops=Array(5).fill(30);stops[c]=stop;let tickets=stops.slice();
  let round;if(mode==='base')round=startWildNudge(settings,'100',max=>{assert.equal(max,64);return tickets.shift();});
  else {const initial=[16,16,16,30,30];let n=0;round=startWildNudge(settings,'100',()=>initial[n++]);round=moveWildNudge(round.view,'100',1,'wild-nudge-spin',max=>{assert.equal(max,64);return tickets.shift();});}
  assert.equal(tickets.length,0);const frame=round.view.spins.at(-1);assert.deepEqual(frame,referenceNudgeSpin(stops,mode,R));assert.deepEqual(frame.reels[c],referenceNudgeReel(R.reels[c],stop,mode,R));
 }
 for(const stakeUnits of p.stakes){const hash=createHash('sha256');let spins=0;
  for(const seed of p.seeds){const draw=seeded('nudge-runtime:'+seed);
   for(let n=0;n<p.serverReplayRoundsPerSeed;n++){
    const trace=[],random=max=>{assert.equal(max,64);const ticket=draw(max);trace.push(ticket);return ticket;};
    let round=startWildNudge(settings,String(stakeUnits),random),referencePoints=0;let offset=0;
    while(true){assert(validWildNudgeView(JSON.parse(JSON.stringify(round.view))));const mode=offset?'bonus':'base';const expected=referenceNudgeSpin(trace.slice(offset*5,offset*5+5),mode,R);assert.deepEqual(round.view.spins[offset],expected);referencePoints+=expected.points;offset++;
     if(round.ended)break;assert.equal(round.creditUnits,'0');round=moveWildNudge(JSON.parse(JSON.stringify(round.view)),String(stakeUnits),round.view.revision,'wild-nudge-spin',random);
    }
    assert.equal(round.creditUnits,String(BigInt(stakeUnits)*BigInt(referencePoints)/100n));spins+=offset;naturalBonusRounds+=Number(offset>1);hash.update(JSON.stringify([seed,n,trace,round.creditUnits])+'\n');
   }
  }
  coverage.push({stakeUnits,paidRounds:512,spins,sha256:hash.digest('hex')});
 }
 for(const stake of p.stakes){let tickets=[2,45,2,16,14,...Array(40).fill(2)];let round=startWildNudge(settings,String(stake),()=>tickets.shift());while(!round.ended)round=moveWildNudge(round.view,String(stake),round.view.revision,'wild-nudge-spin',()=>tickets.shift());assert.equal(round.creditUnits,String(BigInt(stake)*860790n/100n));assert.equal(tickets.length,0);}
 for(const n of [3,4,5]){let c=0;const round=startWildNudge(settings,'100',()=>c++<n?16:30);assert.equal(round.view.remaining,8);}
 return {seeds:p.seeds,reelCensusChecks:640,coverage,checks:3072,naturalBonusRounds,forcedMaximumRounds:6,forcedBonusCountsChecked:3};
}
async function walletReplay(){
 const root=fileURLToPath(new URL('../../',import.meta.url));
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','scripts/database-test.ts','--import','tsx','scripts/game-math/wild-nudge-wallet.ts'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(Error('Wild Nudge wallet qualification failed: '+(error+output).slice(-6000)));try{const row=output.split(/\r?\n/).find(line=>line.startsWith('WILD_NUDGE_WALLET='));const evidence=JSON.parse(row.slice('WILD_NUDGE_WALLET='.length));validateNudgeWalletEvidence(evidence);resolve(evidence);}catch(e){reject(e);}});});
}
export async function qualifyWildNudge(p,progress){const evidence=nudgeRuntimeEvidence(p),replay=await serverReplay(p);progress?.({phase:'wild-nudge-server-replay',checks:replay.checks});const walletEvidence=await walletReplay();progress?.({phase:'wild-nudge-wallet',cases:walletEvidence.cases.length});return {...evidence,serverReplay:replay,serverReplayChecks:replay.checks,walletEvidence};}
