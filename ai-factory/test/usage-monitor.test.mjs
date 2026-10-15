import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageMonitor, subscriptionUsage, requestUsageRefresh } from '../lib/usage-monitor.mjs';

function fixture() {
  const values = new Map();
  const store = { table:'test_factory', pool:{query:async(sql,args)=>{
    if(sql.startsWith('SELECT'))return{rows:values.has(args[0])?[{value:structuredClone(values.get(args[0]))}]:[]};
    values.set(args[0],JSON.parse(args[1]));return{rows:[]};
  }} };
  return {store,values};
}
const stamp=Date.parse('2026-10-10T09:00:00Z');
const sample=()=>({status:'ready',checked_at:new Date(stamp).toISOString(),limits:[{id:'codex',name:null,plan_type:null,
  windows:[{kind:'primary',used_percent:93,remaining_percent:7,window_minutes:10080,resets_at:'2026-10-14T09:00:00Z'}]}],account_usage:null,error:null});

test('limits start unknown and expire by sample age or reset without inventing new quota',async()=>{
  const {store,values}=fixture();
  assert.equal((await subscriptionUsage(store,stamp)).checked_at,null);
  values.set('_codex_usage',sample());
  assert.equal((await subscriptionUsage(store,stamp+1000)).stale,false);
  assert.equal((await subscriptionUsage(store,stamp+180001)).stale,true);
  const expired=sample();expired.limits[0].windows[0].resets_at=new Date(stamp+10000).toISOString();
  values.set('_codex_usage',expired);
  const result=await subscriptionUsage(store,stamp+10001);
  assert.equal(result.stale,true);assert.equal(result.limits[0].windows[0].remaining_percent,7);
});

test('read-only monitor caches reads, serializes concurrent polls, and retains last known limits on error',async()=>{
  const {store}=fixture();let now=stamp,reads=0,fail=false;
  const monitor=new UsageMonitor(store,{now:()=>now,readUsage:async()=>{reads++;if(fail)throw new Error('private secret');return sample();}});
  await Promise.all([monitor.poll({authenticated:true}),monitor.poll({authenticated:true})]);
  assert.equal(reads,1);now+=20000;await monitor.poll({authenticated:true});assert.equal(reads,1);
  fail=true;now+=60000;await monitor.poll({authenticated:true});
  const result=await subscriptionUsage(store,now);
  assert.equal(reads,2);assert.equal(result.status,'unavailable');assert.equal(result.stale,true);
  assert.equal(result.checked_at,new Date(stamp).toISOString());assert.equal(result.limits[0].windows[0].remaining_percent,7);
  assert.equal(JSON.stringify(result).includes('private secret'),false);
  await monitor.close();
});

test('manual refresh is bounded and sign-out removes the previous account sample',async()=>{
  const {store}=fixture();let now=stamp,reads=0;
  const monitor=new UsageMonitor(store,{now:()=>now,readUsage:async()=>{reads++;return sample();}});
  await monitor.poll({authenticated:true});
  assert.equal((await requestUsageRefresh(store,now)).requested,true);
  assert.equal((await requestUsageRefresh(store,now+1000)).requested,false);
  now+=20000;await monitor.poll({authenticated:true});assert.equal(reads,2);
  now+=1000;await monitor.poll({authenticated:false});
  const result=await subscriptionUsage(store,now);
  assert.equal(result.status,'unavailable');assert.deepEqual(result.limits,[]);assert.equal(result.checked_at,null);
  await monitor.close();
});

test('shutdown aborts the pending read and cannot publish a late successful sample',async()=>{
  const {store,values}=fixture();let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const monitor=new UsageMonitor(store,{now:()=>stamp,readUsage:({signal})=>new Promise(resolve=>{
    entered();signal.addEventListener('abort',()=>resolve(sample()),{once:true});
  })});
  const polling=monitor.poll({authenticated:true});await started;await monitor.close();await polling;
  assert.equal(values.has('_codex_usage'),false);
});
