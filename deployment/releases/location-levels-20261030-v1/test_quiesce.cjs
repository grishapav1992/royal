const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const base=require('../cat-purr-hall-only-20261030-v1/quiesce.cjs');
const helper=require('./quiesce.cjs');

class Client extends EventEmitter{
  constructor({active=0,ready=true,busy=false,fence=true}={}){super();this.active=active;this.ready=ready;this.busy=busy;this.fence=fence;this.seen=[];}
  async connect(){}
  async end(){this.closed=true;}
  async query(value){
    const text=typeof value==='string'?value:value.text;this.seen.push(text);
    if(text===helper.ACTIVE_SQL){const active=this.active;this.active=0;return{rows:[{active:String(active)}]};}
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

test('native active rounds drain before a verified table fence and explicit lease release',async()=>{
  const r=await run({active:1});assert.equal(r.result,0);assert(r.client.closed);
  assert(r.events.some(e=>e.event==='waiting'));assert(r.events.some(e=>e.event==='quiet'));assert(r.events.some(e=>e.event==='released'));
  assert(r.client.seen.indexOf(helper.DDL_SQL)<r.client.seen.indexOf(helper.FENCE_SQL));
  assert(r.client.seen.indexOf(helper.FENCE_SQL)<r.client.seen.indexOf(base.SQL.identity));
  for(const name of ['demo_casino_sessions','demo_mines_sessions','demo_flight_sessions','virtual_pvp_holds','combat_matches','skin_purchases'])assert(helper.ACTIVE_SQL.includes(name));
  assert(helper.FENCE_SQL.includes('accounts'));assert(helper.FENCE_SQL.endsWith('IN SHARE MODE NOWAIT'));
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
