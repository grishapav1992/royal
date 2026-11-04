import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {manualStakeWorkers,runManualStakeTasks} from '../scripts/game-math/manual-stake-pool.mjs';
import {prepareManualStakeChecks,qualifyManualStakes,validateManualStakes,MANUAL_STAKE_RANGE} from '../scripts/game-math/manual-stakes.mjs';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fixture=`
export const validGameStake=units=>/^[0-9]+$/.test(units)&&Number(units)>=10&&Number(units)<=5000;
export const gameBetCents=stake=>Math.round(stake*100);
export const parseGameStake=value=>String(Math.round(Number(value.replace(',','.'))*100));
export function runtimeRound(game,choice,units,seed){
  const numerator=BigInt(units)*3n,denominator=2n,creditedUnits=String(numerator/denominator);
  return {exact:{numerator,denominator},precision:{creditedUnits},base:creditedUnits,spins:seed%7+1};
}`;
const policy={manualStakeRange:MANUAL_STAKE_RANGE,choices:['one','two','three','four','five'],seeds:[123,456]};
const tasks=policy.choices.map((_,index)=>({game:'fixture',policy,index}));

test('bounded workers preserve every exhaustive case, original seed and result order',async()=>{
  const runtimeModule=moduleUrl(fixture),progress=[];
  const serial=await runManualStakeTasks(tasks,{runtimeModule,workers:1});
  const parallel=await runManualStakeTasks(tasks,{runtimeModule,workers:3,onProgress:event=>progress.push(event)});
  assert.equal(parallel.workers,3);assert.deepEqual(parallel.results,serial.results);
  assert.equal(parallel.results.reduce((n,result)=>n+result.denominations,0),5*4991);
  assert.deepEqual(parallel.results.map(result=>result.choice),policy.choices);
  for(const status of ['started','passed'])assert.deepEqual(progress.filter(event=>event.status===status).map(event=>event.index).sort(),[0,1,2,3,4]);
  assert.equal((await runManualStakeTasks(tasks.slice(0,2),{runtimeModule,workers:16})).workers,2);
  assert.deepEqual(await runManualStakeTasks([],{runtimeModule,workers:4}),{results:[],workers:0});
});

test('a failed assertion at a non-preset cent rejects both execution paths',async()=>{
  const runtimeModule=moduleUrl(fixture.replace('const numerator=','if(units===\'1234\')throw Error(\'bad cent 1234\'); const numerator='));
  for(const workers of [1,3])await assert.rejects(runManualStakeTasks(tasks,{runtimeModule,workers}),/bad cent 1234/);
});

test('parser, exact reward, cent settlement and prior-award assertions remain mandatory in workers',async()=>{
  const mutations=[
    fixture.replace('parseGameStake=value=>',"parseGameStake=value=>value==='12,34'?'1235':"),
    fixture.replace('BigInt(units)*3n','BigInt(units)*3n+(units===\'1234\'?1n:0n)'),
    fixture.replace('String(numerator/denominator)',"String(numerator/denominator+(units==='1234'?2n:0n))"),
    fixture.replace('base:creditedUnits',"base:String(BigInt(creditedUnits)+(units==='1234'?1n:0n))"),
  ];
  for(const source of mutations)for(const workers of [1,2])await assert.rejects(runManualStakeTasks(tasks,{runtimeModule:moduleUrl(source),workers}),{code:'ERR_ASSERTION'});
  const priced=fixture.replace('return {exact:',"return {view:{costUnits:String(BigInt(units)*7n)},exact:");
  const pricedPolicy={...policy,choices:['lines-1-buy-raid','lines-20-buy-flagship']};
  const pricedTasks=pricedPolicy.choices.map((_,index)=>({game:'studio-caribbean-treasures',policy:pricedPolicy,index}));
  const serial=await runManualStakeTasks(pricedTasks,{runtimeModule:moduleUrl(priced),workers:1});
  assert.deepEqual((await runManualStakeTasks(pricedTasks,{runtimeModule:moduleUrl(priced),workers:2})).results,serial.results);
  const changedCost=priced.replace('BigInt(units)*7n',"BigInt(units)*7n+(units==='1234'?1n:0n)");
  await assert.rejects(runManualStakeTasks(pricedTasks,{runtimeModule:moduleUrl(changedCost),workers:2}),/Complete-round normalized reward/);
});

test('worker import failures, unexpected exits and duplicate initialization fail closed',async()=>{
  for(const [source,expected]of [
    ["throw Error('worker import failed');",/worker import failed/],
    ['process.exit(0);',/exited before completion/],
    ["import {parentPort} from 'node:worker_threads'; parentPort.postMessage({ready:true});"+fixture,/Duplicate worker initialization/],
  ])await assert.rejects(runManualStakeTasks(tasks,{runtimeModule:moduleUrl(source),workers:2}),expected);
  // Failed pools release their workers and cannot poison the next run.
  assert.equal((await runManualStakeTasks(tasks,{runtimeModule:moduleUrl(fixture),workers:2})).results.length,tasks.length);
});

test('invalid worker limits are errors rather than a skipped check',()=>{
  for(const value of [0,-1,17,1.5,'NaN'])assert.throws(()=>manualStakeWorkers(value),/integer from 1 to 16/);
  assert.equal(manualStakeWorkers(1),1);assert.equal(manualStakeWorkers(16),16);
});

test('fresh parallel real-server replays equal the original exhaustive evidence and reject altered coverage',async()=>{
  const registry=JSON.parse(await readFile(new URL('../scripts/game-math/rtp-policy.json',import.meta.url),'utf8'));
  const records=['github-crash','flag-battle'].map(game=>({game,policy:registry.stakePolicies[game]}));
  const serial=records.map(({game,policy})=>qualifyManualStakes(game,policy));
  const first=await prepareManualStakeChecks(records,{workers:2});
  assert.equal(first.policies,2);assert.equal(first.choices,4);assert.equal(first.checks,4*4991);
  for(const [index,{game,policy}]of records.entries()){
    const proof=JSON.parse(await readFile(new URL('../'+policy.proof,import.meta.url),'utf8')).manualStakes;
    assert.deepEqual(qualifyManualStakes(game,policy),serial[index]);assert(validateManualStakes(game,policy,proof));
    for(const mutate of [p=>p.cases.pop(),p=>p.checks--,p=>p.cases[0].denominations--,p=>p.cases[0].seed++,p=>p.cases[0].sha256='0'.repeat(64)]){
      const altered=structuredClone(proof);mutate(altered);assert.throws(()=>validateManualStakes(game,policy,altered));
    }
  }
  assert.equal((await prepareManualStakeChecks(records,{workers:2})).policies,2,'Each fresh gate invocation must repeat every cent');
  const changed=structuredClone(records[0]);changed.policy.seeds[1]++;
  await prepareManualStakeChecks([changed],{workers:2});
  assert.notDeepEqual(qualifyManualStakes(changed.game,changed.policy),serial[0],'A different seed must not reuse another input set');
});
