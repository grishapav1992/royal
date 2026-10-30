const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const base=require('../cat-purr-hall-only-20261030-v1/quiesce.cjs');
const helper=require('./quiesce.cjs');

class Client extends EventEmitter{
  constructor({combat=0,pvp=0,skin=0,studio=0,flight=0,crash=0,native=0,ready=true,busy=false,fence=true}={}){
    super();this.states={combat_matches:combat,virtual_pvp_holds:pvp,skin_purchases:skin,skin_jobs:studio,
      demo_casino_sessions:native,demo_mines_sessions:native,demo_flight_sessions:flight};this.crash=crash;
    this.ready=ready;this.busy=busy;this.fence=fence;this.seen=[];
  }
  async connect(){}
  async end(){this.closed=true;}
  async query(value){
    const text=typeof value==='string'?value:value.text;this.seen.push(text);
    if(text===helper.ACTIVE_SQL){
      let active=Object.entries(this.states).reduce((sum,[name,count])=>sum+(name!=='demo_casino_sessions'&&text.includes(name)?count:0),0);
      if(text.includes('demo_casino_sessions'))active+=this.crash+(text.includes("game_id IN ('github-crash')")?0:this.states.demo_casino_sessions);
      for(const name of ['combat_matches','virtual_pvp_holds','skin_purchases','skin_jobs','demo_flight_sessions'])this.states[name]=0;
      this.crash=0;
      return{rows:[{active:String(active)}]};
    }
    if(text===helper.DDL_SQL)return{rows:[{ready:this.ready}]};
    if(text===helper.FENCE_SQL&&this.busy){this.busy=false;throw Object.assign(Error('busy'),{code:'55P03'});}
    if(text===helper.FENCE_IDENTITY_SQL)return{rows:[{held:this.fence}]};
    if(text===base.SQL.identity)return{rows:[{backend_pid:12,transaction_id:'42',financial_lock_held:true}]};
    return{command:text,rows:[]};
  }
}
async function run(options){
  const client=new Client(options),input=new PassThrough(),output=new PassThrough(),errorOutput=new PassThrough(),events=[];
  let buffer='';output.on('data',chunk=>{
    buffer+=chunk;let end;
    while((end=buffer.indexOf('\n'))>=0){
      const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);events.push(event);
      if(event.event==='quiet')input.write(JSON.stringify({op:'release',nonce:'a'.repeat(32)})+'\n');
    }
  });
  const result=await base.runGate({client:helper.decorateClient(client,base),input,output,errorOutput,
    timings:{drainMs:1000,leaseMs:2000,heartbeatMs:20,pollMs:5,queryMs:100,closeMs:100,writeMs:100}});
  return{client,events,result};
}

test('persisted native sessions survive the verified table fence and explicit lease release',async()=>{
  const r=await run({native:1});assert.equal(r.result,0);assert(r.client.closed);
  assert(!r.events.some(e=>e.event==='waiting'));assert(r.events.some(e=>e.event==='quiet'));assert(r.events.some(e=>e.event==='released'));
  assert(r.client.seen.indexOf(helper.DDL_SQL)<r.client.seen.indexOf(helper.FENCE_SQL));
  assert(r.client.seen.indexOf(helper.FENCE_SQL)<r.client.seen.indexOf(base.SQL.identity));
  for(const name of ['demo_casino_sessions','demo_mines_sessions']){
    if(name==='demo_mines_sessions')assert(!helper.ACTIVE_SQL.includes(name));
    assert(helper.FENCE_SQL.includes(name));assert.equal(r.client.states[name],1);
  }
  assert(helper.ACTIVE_SQL.includes("game_id IN ('github-crash')"));assert(helper.ACTIVE_SQL.includes('demo_flight_sessions'));
  for(const name of ['virtual_pvp_holds','combat_matches','skin_purchases'])assert(helper.ACTIVE_SQL.includes(name));
  assert.equal(helper.TABLES.length,15);
  assert(helper.FENCE_SQL.includes('accounts'));assert(helper.FENCE_SQL.endsWith('IN SHARE MODE NOWAIT'));
});
test('Flight, Crash, combat, PvP holds and reserved skins each wait for their obligation to finish',async()=>{
  for(const obligation of ['flight','crash','combat','pvp','skin','studio']){
    const r=await run({[obligation]:1,native:1});assert.equal(r.result,0);
    assert(r.events.some(e=>e.event==='waiting'),obligation+' must drain');assert(r.events.some(e=>e.event==='quiet'));
    assert(r.client.seen.includes('ROLLBACK'));
  }
});
test('a competing account transaction rolls the fence attempt back and waits instead of bypassing it',async()=>{
  const r=await run({busy:true});assert.equal(r.result,0);assert(r.events.some(e=>e.event==='waiting'));
  assert(r.client.seen.filter(v=>v==='ROLLBACK').length>=1);assert.equal(r.client.seen.filter(v=>v===helper.FENCE_SQL).length,2);
});
test('missing additive schema privileges abort before the quiet signal',async()=>{
  const r=await run({ready:false});assert.equal(r.result,1);assert(!r.events.some(e=>e.event==='quiet'));
  assert(!r.client.seen.includes(helper.FENCE_SQL));assert(r.client.closed);
});
test('missing table locks invalidate the otherwise valid financial lease identity',async()=>{
  const r=await run({fence:false});assert.equal(r.result,1);assert(!r.events.some(e=>e.event==='quiet'));
  assert(!r.client.seen.includes('COMMIT'));assert(r.client.seen.includes('ROLLBACK'));
});
