import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { cosmicQualificationEvidence, COSMIC_QUALIFICATION_METHOD, COSMIC_QUALIFICATION_MODEL } from './rtp-cosmic.mjs';
import { caribbeanQualificationEvidence, CARIBBEAN_QUALIFICATION_METHOD, CARIBBEAN_REVIEWED_SOURCES } from './rtp-caribbean.mjs';
import { JACKIE_METHOD, jackieEvidence } from './rtp-jackie.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
// Git checkouts use CRLF on Windows and LF in Linux CI. Hash canonical text.
export const sourceDigest = value => digest(value.toString('utf8').replace(/\r\n/g,'\n'));
export async function changedLegacyProfiles(root,hashes,profiles) {
  const changed=new Set();
  for(const [file,hash] of Object.entries(hashes)) {
    if(sourceDigest(await readFile(resolve(root,file)))===hash)continue;
    const covering=Object.entries(profiles).filter(([,p])=>p.sources.includes(file));
    assert(covering.length,'Unqualified legacy mathematics changed: '+file+'. Register affected games and qualify the new rules.');
    for(const [id] of covering)changed.add(id);
  }
  return changed;
}
export async function rtpInputs(root, gameId) {
  const registry = JSON.parse(await readFile(resolve(root, 'scripts/game-math/rtp-policy.json'), 'utf8'));
  const policy = registry.profiles[gameId];
  assert(policy, 'No RTP qualification policy for ' + gameId);
  const sourceHashes = Object.fromEntries(await Promise.all([...policy.sources, policy.qualificationSource ?? 'scripts/game-math/rtp-simulation.mjs'].map(async file =>
    [file, sourceDigest(await readFile(resolve(root, file)))])));
  return { policy, sourceHashes, policySha256: digest(JSON.stringify(policy)) };
}
export function validateRtpProof(gameId, inputs, proof) {
  const { policy: p } = inputs;
  assert.equal(proof.schemaVersion, 1); assert.equal(proof.gameId, gameId);
  assert.equal(proof.rulesVersion, p.rulesVersion); assert.equal(proof.progressVersion, p.progressVersion);
  if (gameId==='studio-neopolis' && p.rulesVersion>=4) assert.equal(p.method,'neopolis-variable-stake-conditional-v4','Variable stakes require conditional qualification');
  assert.equal(proof.policySha256, inputs.policySha256, 'RTP policy changed: rerun qualification');
  assert.deepEqual(proof.sourceHashes, inputs.sourceHashes, 'RTP source changed: rerun qualification');
  if (p.method===JACKIE_METHOD) {
    assert.equal(gameId,'original-jackie-chan');
    const expected=jackieEvidence(p);
    assert.equal(proof.method,expected.method);assert.deepEqual(proof.analysis,expected.analysis);assert.deepEqual(proof.results,expected.results);
    assert.deepEqual(proof.serverReplay.seeds,p.seeds);assert.equal(new Set(p.seeds).size,2);
    assert.equal(proof.serverReplayChecks,46188);assert.match(proof.serverReplay.sha256,/^[a-f0-9]{64}$/);
    return true;
  }
  if(p.method===CARIBBEAN_QUALIFICATION_METHOD) {
    assert.equal(gameId,'studio-caribbean-treasures');
    assert.deepEqual(Object.fromEntries(Object.keys(CARIBBEAN_REVIEWED_SOURCES).map(file=>[file,inputs.sourceHashes[file]])),CARIBBEAN_REVIEWED_SOURCES,
      'Caribbean mathematical source changed: review the complete-round model');
    return validateCaribbeanProof(p,proof);
  }
  if(p.method==='exhaustive-pvp-journal')return validatePvpProof(gameId,p,proof);
  if(p.method==='exhaustive-virtual-pvp-pot')return validateVirtualPvpProof(gameId,p,proof);
  if(p.method===COSMIC_QUALIFICATION_METHOD){
    const reviewed=Object.fromEntries(Object.keys(COSMIC_QUALIFICATION_MODEL.reviewedSourceSha256).map(file=>[file,inputs.sourceHashes[file]]));
    assert.deepEqual(reviewed,COSMIC_QUALIFICATION_MODEL.reviewedSourceSha256,'Cosmic mathematical source changed: independently review the analytical model');
    return validateCosmicProof(gameId,p,proof);
  }
  assert(p.target > 0 && p.target < 1 && p.maxUpper95 < 1 && p.tolerance <= .02);
  assert(Number.isFinite(p.confidenceZ ?? 1.96) && (p.confidenceZ ?? 1.96)>=1.96, 'Confidence intervals cannot be weakened');
  assert.equal(proof.results.length, p.stakes.length * p.choices.length, 'Every stake and choice must be qualified');
  const keys = new Set();
  for (const row of proof.results) {
    assert(p.choices.includes(row.choice) && p.stakes.includes(row.stakeUnits));
    const key = row.choice + ':' + row.stakeUnits; assert(!keys.has(key)); keys.add(key);
    assert([row.samples,row.paidRounds,row.reward,row.cost,row.rewardSquared,row.rewardCost,row.costSquared,row.rtp,...row.interval95].every(Number.isFinite));
    assert(row.samples > 1 && row.paidRounds >= p.minPaidRounds && row.cycles >= p.minCycles);
    assert.equal(row.cost, row.paidRounds);
    const mean = row.reward / row.cost;
    const residual = Math.max(0, row.rewardSquared - 2 * mean * row.rewardCost + mean * mean * row.costSquared);
    const half = (p.confidenceZ ?? 1.96) * Math.sqrt(row.samples * residual / (row.samples - 1)) / row.cost;
    assert(Math.abs(row.rtp - mean) < 1e-10 && Math.abs(row.interval95[0] - mean + half) < 1e-9 && Math.abs(row.interval95[1] - mean - half) < 1e-9, 'Invalid statistical evidence');
    assert(half > 0 && half <= p.maxHalfWidth95, 'RTP estimate is too imprecise');
    assert(Math.abs(mean - p.target) <= p.tolerance && mean + half <= p.maxUpper95, 'RTP is outside the approved budget: ' + key);
  }
  assert.equal(proof.streams.length, p.choices.length * p.seeds.length);
  for (const [index, choice] of p.choices.entries()) for (const seed of p.seeds) {
    const expected = gameId === 'studio-neopolis' ? seed + index * 1000003 : seed;
    assert(proof.streams.some(stream => stream.choice === choice && stream.seed === expected));
  }
  assert(proof.serverReplayChecks >= p.stakes.length * p.choices.length * 64, 'Server replay cross-check is missing');
  if (p.method === 'neopolis-variable-stake-conditional-v4') validateNeopolisVariableStakeProof(p, proof);
  return true;
}
function validateNeopolisVariableStakeProof(p, proof) {
  assert.equal(proof.method, p.method);
  assert.equal(p.rulesVersion, 4); assert.equal(p.progressVersion, 4);
  assert.equal(p.confidenceZ,2.241402727604947); assert.equal(p.qualificationLooks,2);
  assert.equal(p.qualificationCyclesPerSeed,30000); assert(p.minCycles>=60000);
  assert.deepEqual(p.choices, ['granite','impulse','prism']);
  assert.deepEqual(p.stakes, [1000,2000,5000,10000,20000,50000]);
  assert.deepEqual(p.stakePolicies, ['fixed','raise-when-ready','lower-when-ready','alternate-extremes','cycle-stakes']);
  assert.equal(p.conditionalTarget, p.target);
  assert(p.conditionalTolerance > 0 && p.conditionalTolerance <= .01);
  assert(p.conditionalMaxUpper95 <= p.maxUpper95 && p.conditionalMaxHalfWidth95 <= p.maxHalfWidth95);
  assert(p.conditionalRoundsPerSeed >= 500000 && p.conditionalReadyRoundsPerSeed >= 4000000);
  assert.equal(new Set([...p.seeds,...p.conditionalSeeds,...p.calibrationSeeds]).size, p.seeds.length+p.conditionalSeeds.length+p.calibrationSeeds.length, 'Calibration and qualification seeds must be independent');
  function statistical(row) {
    assert([row.samples,row.paidRounds,row.reward,row.cost,row.rewardSquared,row.rewardCost,row.costSquared,row.rtp,...row.interval95].every(Number.isFinite));
    assert(row.samples > 1 && row.cost > 0 && row.paidRounds >= row.samples);
    const mean = row.reward / row.cost;
    const residual = Math.max(0, row.rewardSquared - 2 * mean * row.rewardCost + mean * mean * row.costSquared);
    const half = (p.confidenceZ ?? 1.96) * Math.sqrt(row.samples * residual / (row.samples - 1)) / row.cost;
    assert(Math.abs(row.rtp-mean)<1e-10 && Math.abs(row.interval95[0]-mean+half)<1e-9 && Math.abs(row.interval95[1]-mean-half)<1e-9, 'Invalid variable-stake statistical evidence');
    assert(half>0 && half<=p.conditionalMaxHalfWidth95, 'Conditional estimate is too imprecise');
    assert(Math.abs(mean-p.conditionalTarget)<=p.conditionalTolerance && mean+half<=p.conditionalMaxUpper95, 'Conditional or variable-stake RTP is outside the approved budget');
  }
  assert.equal(proof.stateResults.length, p.choices.length*16*p.stakes.length, 'Every public team state and stake must be qualified');
  const keys = new Set();
  for (const row of proof.stateResults) {
    assert(p.choices.includes(row.choice) && p.stakes.includes(row.stakeUnits));
    assert(Number.isInteger(row.state) && row.state>=0 && row.state<16);
    const key = row.choice+':'+row.state+':'+row.stakeUnits; assert(!keys.has(key)); keys.add(key);
    const charges = [3,3,3], others = [0,1,2].filter(i=>i!==p.choices.indexOf(row.choice));
    charges[others[0]]=Math.floor(row.state/4); charges[others[1]]=row.state%4;
    assert.deepEqual(row.charges,charges);
    const count=(row.state===15?p.conditionalReadyRoundsPerSeed:p.conditionalRoundsPerSeed)*p.conditionalSeeds.length;
    assert.equal(row.samples,count); assert.equal(row.paidRounds,count); assert.equal(row.cost,count); statistical(row);
  }
  assert.equal(proof.conditionalStreams.length,p.choices.length*16*p.conditionalSeeds.length);
  for (const [i,hero] of p.choices.entries()) for (let state=0;state<16;state++) for (const seed of p.conditionalSeeds) {
    assert(proof.conditionalStreams.some(row=>row.hero===hero&&row.state===state&&row.seed===seed+i*1000003+state*7919&&row.paidRounds===(state===15?p.conditionalReadyRoundsPerSeed:p.conditionalRoundsPerSeed)));
  }
  assert.equal(proof.stakePolicyResults.length,p.choices.length*(p.stakePolicies.length-1)*p.stakes.length,'Adaptive stake policies must be qualified');
  const weightedKeys=new Set();
  for (const row of proof.stakePolicyResults) {
    assert(p.choices.includes(row.choice)&&p.stakes.includes(row.stakeUnits)&&p.stakePolicies.includes(row.stakePolicy)&&row.stakePolicy!=='fixed');
    const key=row.choice+':'+row.stakePolicy+':'+row.stakeUnits; assert(!weightedKeys.has(key));weightedKeys.add(key);
    assert(row.cycles>=p.minCycles&&row.samples===row.cycles&&row.paidRounds>=p.minPaidRounds);
    assert(row.cost>=row.paidRounds&&row.cost<=row.paidRounds*p.stakes.at(-1)/p.stakes[0]); statistical(row);
  }
  assert(proof.serverReplayChecks>=p.choices.length*16*p.stakes.length*64,'Every conditional state needs a real server replay');
}
function validateCaribbeanProof(p,proof){
  const expected=caribbeanQualificationEvidence(p);
  assert.equal(proof.method,expected.method);
  assert.deepEqual(proof.analysis,expected.analysis,'Invalid Caribbean analytical derivation');
  assert.deepEqual(proof.results,expected.results,'Every Caribbean line selection, mode and stake must match the exact complete-round expectation');
  assert(proof.serverReplay&&Array.isArray(proof.serverReplay.coverage));
  assert.deepEqual(proof.serverReplay.seeds,p.seeds);
  assert.equal(proof.serverReplay.coverage.length,p.choices.length*p.stakes.length);
  let total=0;const seen=new Set();
  for(const row of proof.serverReplay.coverage){
    assert(p.choices.includes(row.choice)&&p.stakes.includes(row.stakeUnits));
    const key=row.choice+':'+row.stakeUnits;assert(!seen.has(key));seen.add(key);
    assert.equal(row.paidRounds,p.seeds.length*p.serverReplayRoundsPerSeed);
    const result=expected.results.find(result=>result.choice===row.choice&&result.stakeUnits===row.stakeUnits);
    assert(Number.isSafeInteger(row.spins)&&row.spins>=row.paidRounds&&row.spins<=row.paidRounds*result.maximumSpins);
    if(row.choice.includes('-buy-'))assert.equal(row.spins,row.paidRounds*result.maximumSpins);
    assert(typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256));
    total+=row.paidRounds;
  }
  assert.equal(proof.serverReplayChecks,total);
  assert(Number.isSafeInteger(proof.serverReplay.cannons)&&proof.serverReplay.cannons>0);
  assert(Number.isSafeInteger(proof.serverReplay.naturalEntries)&&proof.serverReplay.naturalEntries>=p.seeds.length*4*p.stakes.length*2);
  return true;
}
function validateCosmicProof(gameId,p,proof){
  assert.equal(gameId,'studio-cosmic-escape');
  const expected=cosmicQualificationEvidence(p);
  assert.equal(proof.method,expected.method);
  assert.deepEqual(proof.analysis,expected.analysis,'Invalid Cosmic analytical derivation');
  assert.deepEqual(proof.results,expected.results,'Every Cosmic mode and stake must match the recomputed complete-round bounds');
  assert.equal(proof.scorerReplayChecks,59049,'Cosmic line scorer cross-check is missing');
  assert(proof.serverReplay&&Array.isArray(proof.serverReplay.coverage));
  assert.deepEqual(proof.serverReplay.seeds,p.seeds);
  assert.equal(proof.serverReplay.coverage.length,p.stakes.length*p.choices.length);
  const minimum=p.seeds.length*p.serverReplayRoundsPerSeed;
  let total=0;
  const keys=new Set();
  for(const row of proof.serverReplay.coverage){
    assert(p.choices.includes(row.choice)&&p.stakes.includes(row.stakeUnits));
    const key=row.choice+':'+row.stakeUnits;assert(!keys.has(key));keys.add(key);
    assert.equal(row.paidRounds,minimum,'Cosmic server replay coverage is incomplete');
    assert(Number.isSafeInteger(row.spins)&&row.spins>=row.paidRounds);
    assert(typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256));
    total+=row.paidRounds;
  }
  assert.equal(proof.serverReplayChecks,total);
  assert.equal(proof.serverReplay.serverReplayChecks,total);
  assert(total>=p.stakes.length*p.choices.length*64);
  const counters=proof.serverReplay.counters;
  assert(counters&&counters.echoes>0&&counters.energyEvents>0&&counters.beams>0);
  for(const spins of [10,12,15])assert(counters.naturalAwards?.[spins]>=p.stakes.length*p.seeds.length,'Cosmic natural bonus branches are incomplete');
  return true;
}
function validateVirtualPvpProof(gameId,p,proof){
  assert(['hockey','pool','chess','durak','transfer-durak','crazy-eights'].includes(gameId));
  assert.equal(p.target,.95);assert.equal(p.refundReturn,1);assert.equal(p.commissionBasisPoints,500);
  assert.deepEqual(p.stakeRange,{min:1000000,max:500000000,step:100000});
  assert.deepEqual(p.choices,['left-win','right-win','draw','cancel','disconnect-left','disconnect-right','expired','server']);
  assert.equal(proof.method,p.method);assert.equal(proof.results.length,p.choices.length);
  let replayChecks=0;
  for(const [index,choice]of p.choices.entries()){
    const hash=createHash('sha256');let cases=0,potTotal=0n,feeTotal=0n,returnTotal=0n;
    for(let stake=p.stakeRange.min;stake<=p.stakeRange.max;stake+=p.stakeRange.step){
      const pot=BigInt(stake)*2n,decisive=choice.includes('win')||choice.startsWith('disconnect');
      const fee=decisive?pot*500n/10000n:0n,winner=choice==='right-win'||choice==='disconnect-right'?1:0;
      const credits=decisive?[0,1].map(i=>i===winner?String(pot-fee):'0'):[String(stake),String(stake)];
      hash.update(JSON.stringify([stake,credits,String(fee)])+'\n');cases++;potTotal+=pot;feeTotal+=fee;returnTotal+=pot-fee;
    }
    assert.deepEqual(proof.results[index],{choice,cases,potUnits:String(potTotal),feeUnits:String(feeTotal),returnedUnits:String(returnTotal),sha256:hash.digest('hex')});
    replayChecks+=cases*3;
  }
  assert.equal(proof.serverReplayChecks,replayChecks);
  return true;
}
function validatePvpProof(gameId,p,proof){
  assert.equal(gameId,'mortal-kombat');assert.equal(proof.method,p.method);
  assert.equal(p.target,.95);assert.equal(p.refundReturn,1);assert.equal(p.commissionBasisPoints,500);
  assert.deepEqual(p.stakes,[1000000,2000000,5000000,10000000,50000000,100000000]);
  assert.deepEqual(p.choices,['left-win','right-win','draw','cancel','disconnect-left','disconnect-right','expired','server']);
  assert.equal(proof.results.length,p.stakes.length*p.choices.length);
  const keys=new Set();
  for(const row of proof.results){
    assert(p.stakes.includes(row.stakeUnits)&&p.choices.includes(row.choice));
    const key=row.choice+':'+row.stakeUnits;assert(!keys.has(key));keys.add(key);
    const stake=BigInt(row.stakeUnits),pot=stake*2n,decisive=row.choice.includes('win')||row.choice.startsWith('disconnect');
    const fee=decisive?pot*BigInt(p.commissionBasisPoints)/10000n:0n;
    const winner=row.choice==='right-win'||row.choice==='disconnect-right'?1:0;
    assert.equal(row.potUnits,String(pot));assert.equal(row.feeUnits,String(fee));
    assert.deepEqual(row.playerUnits,decisive?[0,1].map(i=>i===winner?String(pot-fee):'0'):[String(stake),String(stake)]);
    assert.equal(row.returnedUnits,String(pot-fee));assert.equal(row.returnRatio,decisive?p.target:p.refundReturn);
  }
  assert.equal(proof.serverReplayChecks,proof.results.length*3);
  return true;
}
export async function checkGameRtp(root, catalog, selected = catalog.map(game => game.gameId)) {
  const registry = JSON.parse(await readFile(resolve(root, 'scripts/game-math/rtp-policy.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(resolve(root, 'scripts/game-math/rtp-legacy-baseline.json'), 'utf8'));
  assert.equal(digest(JSON.stringify(baseline.games)), '71deee54464329fbc5a76c9c964797caad78620ff8d206bc4bf9105de760a160', 'The frozen legacy list cannot absorb new unqualified games');
  assert.equal(digest(JSON.stringify(baseline.sourceHashes)), '5f9993f8027063d149ba433a00ccf930827a42d4438ec9cfabc9207e184dfdf8', 'The frozen math baseline cannot be rewritten to bypass qualification');
  const changedProfiles=await changedLegacyProfiles(root,baseline.sourceHashes,registry.profiles);
  for (const gameId of ['studio-neopolis','studio-dracona']) assert(registry.profiles[gameId], 'A required RTP profile was removed: ' + gameId);
  for (const game of catalog) {
    const exemption = registry.nonWagered[game.gameId];
    assert(registry.profiles[game.gameId] || baseline.games.includes(game.gameId) || typeof exemption === 'string' && exemption.trim().length >= 20,
      'New module has no RTP qualification or documented non-wagered classification: ' + game.gameId);
  }
  let verified = 0;
  for (const gameId of new Set([...selected,...changedProfiles])) {
    if (!registry.profiles[gameId]) continue;
    const inputs = await rtpInputs(root, gameId), contract = catalog.find(game => game.gameId === gameId);
    assert(contract && contract.rulesVersion === inputs.policy.rulesVersion && contract.progressVersion === inputs.policy.progressVersion);
    const proof = JSON.parse(await readFile(resolve(root, inputs.policy.proof), 'utf8').catch(() => { throw Error('Missing RTP qualification for ' + gameId + '; run npm run qualify:rtp -- --game ' + gameId + ' --write-proof'); }));
    validateRtpProof(gameId, inputs, proof); verified++;
  }
  return { verified, legacyNotQualified: baseline.games.length };
}
