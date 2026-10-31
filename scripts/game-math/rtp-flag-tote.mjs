import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {toteReference,toteCases,toteStream,toteReferenceCountries,toteReferenceStakes} from './flag-tote-reference.mjs';
export const TOTE_METHOD='exact-parimutuel-flag-pool-v1';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function toteEvidence(p,settle=toteReference){
  assert.equal(p.method,TOTE_METHOD);assert.equal(p.rulesVersion,1);assert.equal(p.progressVersion,1);assert.equal(p.target,.95);assert.equal(p.refundReturn,1);assert.equal(p.commissionBasisPoints,500);
  assert.deepEqual(p.consolationWeights,[60,30,10]);assert.deepEqual(p.stakes,toteReferenceStakes);assert.equal(p.countries,48);assert.equal(p.minBackedCountries,3);assert.equal(p.minAccounts,2);
  assert.equal(p.maxBankUnits,1000000);assert.equal(p.maxAccountStakeUnits,50000);assert.equal(p.maxTickets,256);assert.deepEqual(p.choices,['winner-backed','winner-unbacked','insufficient-countries','insufficient-accounts']);assert.deepEqual(p.seeds,[731831,963161]);assert.equal(p.replaysPerSeed,256);
  const rows=new Map();let checks=0;
  for(const c of toteCases()){
    const actual=settle(c.tickets,c.order),expected=toteReference(c.tickets,c.order);assert.deepEqual(actual,expected);checks++;
    const key=c.choice+':'+c.stakeUnits;
    if(!rows.has(key))rows.set(key,{choice:c.choice,stakeUnits:c.stakeUnits,cases:0,pot:0n,fee:0n,returned:0n,hash:createHash('sha256')});
    const row=rows.get(key);row.cases++;row.pot+=BigInt(actual.potUnits);row.fee+=BigInt(actual.feeUnits);row.returned+=actual.payouts.reduce((n,p)=>n+BigInt(p.units),0n);row.hash.update(JSON.stringify(actual)+'\n');
  }
  const streams=p.seeds.map(seed=>{const hash=createHash('sha256');for(const c of toteStream(seed,p.replaysPerSeed)){const actual=settle(c.tickets,c.order);assert.deepEqual(actual,toteReference(c.tickets,c.order));hash.update(JSON.stringify(actual)+'\n');checks++;}return{seed,rounds:p.replaysPerSeed,sha256:hash.digest('hex')};});
  const results=[...rows.values()].map(r=>({choice:r.choice,stakeUnits:r.stakeUnits,cases:r.cases,potUnits:String(r.pot),feeUnits:String(r.fee),returnedUnits:String(r.returned),sha256:r.hash.digest('hex')}));
  return {method:TOTE_METHOD,analysis:{countries:48,countryFirstProbability:'1/48',aggregateCompletedReturn:'19/20',aggregateRefundReturn:'1',individualReturn:'Depends on stake distribution and finishing order; no fixed individual RTP is asserted.',conservation:'For any accepted bank B, B is divisible by 100. F=B/20 is exact. Hamilton allocations sum to B-F at both country and ticket levels. Hence sum(player credits)+F=B for every composition and permutation.',allocationBound:'A floor allocation leaves fewer cents than recipients. Largest distinct remainders receive one cent each; input order breaks ties. Every ticket credit is nonnegative and at most B. A fixed maximum-bank reservation therefore covers any award or refund.',outcomeBranches:'Backed first place: one country receives the net bank. Unbacked first place: the three nearest backed countries receive Hamilton weights 6:3:1. Fewer than three backed countries or two accounts: full refunds without drawing.',coverage:'All 48 countries, six allowed stakes, direct first place and every possible consolation finishing place 2 through 48, both refund branches; independent seeded multi-player compositions.',boundsKind:'Algebraic exact aggregate bounds, not a sampling confidence interval or a fixed player RTP.'},results,streams,serverReplayChecks:checks};
}
export async function qualifyFlagTote(p){
  const {settleFlagTote,TOTE_LIMITS,TOTE_STAKES}=await import('../../src/shared/flagTote.ts');
  const {FLAG_COUNTRIES}=await import('../../src/shared/flagBattle.ts');
  assert.deepEqual(FLAG_COUNTRIES.map(c=>c.id),toteReferenceCountries);assert.deepEqual(TOTE_STAKES.map(Number),p.stakes);assert.deepEqual(TOTE_LIMITS,{maxBank:p.maxBankUnits,maxAccount:p.maxAccountStakeUnits,maxTickets:p.maxTickets,minCountries:p.minBackedCountries,minAccounts:p.minAccounts});
  const evidence=toteEvidence(p,settleFlagTote);
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const run=spawnSync(process.execPath,['--import','tsx','scripts/database-test.ts','--import','tsx','--test','--test-reporter=tap','server-tests/flag-tote.test.ts','server-tests/flag-tote-http.test.ts'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000});
  assert.equal(run.status,0,'Real PostgreSQL wallet qualification failed: '+run.stdout+'\n'+run.stderr);assert.match(run.stdout,/# tests 9\b/);assert.match(run.stdout,/# fail 0\b/);
  return {...evidence,wallet:{tests:9,passed:9,failed:0,sha256:digest(run.stdout),scope:'Real common wallet: acceptance, fee, conservation, proportional return, rounding, refunds, ownership, replay, cutoff after lock, restart, capacity, invalid entropy rollback.'}};
}
export function validateToteProof(gameId,inputs,proof){
  assert.equal(gameId,'flag-tote');const expected=toteEvidence(inputs.policy);
  for(const field of ['method','analysis','results','streams','serverReplayChecks'])assert.deepEqual(proof[field],expected[field],'Invalid totalizator evidence: '+field);
  assert.equal(proof.wallet.tests,9);assert.equal(proof.wallet.passed,9);assert.equal(proof.wallet.failed,0);assert.match(proof.wallet.sha256,/^[a-f0-9]{64}$/);
  return true;
}
