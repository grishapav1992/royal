// Isolated protocol and scheduling tests. No PostgreSQL, Docker or production calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {runGate,configuration,parseCommand,DEFAULTS,LIMITS,SQL}=require('./quiesce.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const nonce=value=>value.toString(16).padStart(32,'0');
const command=(op,value)=>JSON.stringify({op,nonce:nonce(value)})+'\n';

class FakeClient extends EventEmitter {
  constructor(options={}){super();this.options=options;this.calls=[];this.connected=0;this.ended=0;this.verifications=0;this.transaction=0;this.inTransaction=false;this.inFlight=0;this.maxInFlight=0;this.backendPid=1234;this.closed=false;this.rejectedPending=null;this.connection={stream:{destroy:()=>this.forceClose()}};}
  async connect(){this.calls.push('connect');this.connected++;if(this.options.connectError)throw Error('private credentials must not escape');if(this.options.connectDelay)await delay(this.options.connectDelay);}
  async query(config){
    assert.equal(typeof config,'object');assert(config.query_timeout>0&&config.query_timeout<=5000);
    const text=config.text;this.calls.push(text);this.inFlight++;this.maxInFlight=Math.max(this.maxInFlight,this.inFlight);
    try{
      assert.equal(this.inFlight,1,'Client queries overlap');
      if(this.closed)throw Error('private disconnected server detail');
      if(this.options.query)await this.options.query(text,this);
      if(this.options.hang===text)await new Promise((resolve,reject)=>{this.rejectedPending=reject;});
      if(this.options.queryDelay)await delay(this.options.queryDelay);
      if(text==='BEGIN'){this.inTransaction=true;this.transaction++;return {command:'BEGIN'};}
      if(text==='ROLLBACK'){this.inTransaction=false;return {command:'ROLLBACK'};}
      if(text==='COMMIT'){this.inTransaction=false;return {command:this.options.commitTag||'COMMIT'};}
      if(text===SQL.lock)return {rows:[{}]};
      if(text===SQL.active){const values=this.options.active||['0'];return {rows:[{active:values.length>1?values.shift():values[0]}]};}
      assert.equal(text,SQL.identity);this.verifications++;
      const row={backend_pid:this.backendPid,transaction_id:String(this.transaction),financial_lock_held:this.inTransaction};
      Object.assign(row,this.options.identity?.(this.verifications,this)||{});
      return {rows:[row]};
    }finally{this.inFlight--;}
  }
  forceClose(){this.closed=true;this.inTransaction=false;if(this.rejectedPending){this.rejectedPending(Error('connection closed'));this.rejectedPending=null;}}
  async end(){this.calls.push('end');this.ended++;this.forceClose();this.emit('end');}
}

function fixture(options={},timings={}){
  const client=new FakeClient(options),input=new PassThrough(),events=[],errors=[];
  const output=new Writable({write(chunk,encoding,callback){events.push(JSON.parse(chunk.toString()));callback();}});
  const errorOutput=new Writable({write(chunk,encoding,callback){errors.push(chunk.toString());callback();}});
  const promise=runGate({client,input,output,errorOutput,timings:{drainMs:500,leaseMs:2000,heartbeatMs:100,pollMs:5,queryMs:100,closeMs:100,writeMs:100,...timings}});
  const until=async predicate=>{const deadline=Date.now()+2000;while(!predicate()){assert(Date.now()<deadline,'Expected protocol event did not arrive');await delay(1);}};
  const quiet=()=>until(()=>events.some(row=>row.event==='quiet'));
  const stop=async()=>{input.end();return promise;};
  return {client,input,output,errorOutput,events,errors,promise,until,quiet,stop};
}
const held=events=>events.filter(row=>['quiet','heartbeat','confirmed'].includes(row.event));
function failed(f){assert(f.events.some(row=>row.event==='error'&&row.code==='GATE_FAILED'));assert(!f.events.some(row=>row.event==='released'));assert(!f.client.calls.includes('COMMIT'));assert.equal(f.client.maxInFlight,1);assert.equal(f.client.connected,1);assert.equal(f.client.ended,1);}

// Production values are fixed at the entrypoint, while direct unit calls use short timers.
test('production configuration pins one-session timeouts and ignores lease environment overrides',()=>{
  assert.deepEqual(DEFAULTS,{drainMs:180000,leaseMs:600000,heartbeatMs:2000,pollMs:1000,queryMs:5000,closeMs:5000,writeMs:5000});
  assert(Object.isFrozen(DEFAULTS));
  const config=configuration({DATABASE_URL_FILE:'/private/test-secret',PGSSLMODE:'verify-full',PGSSLROOTCERT:'/private/test-ca',ROYAL_GATE_LEASE_MS:'1'},path=>path.includes('secret')?'  postgresql://private/test  ':'certificate');
  assert.equal(config.connectionString,'postgresql://private/test');assert.deepEqual(config.ssl,{rejectUnauthorized:true,ca:'certificate'});
  assert.equal(config.application_name,'royal/security-release-gate');
  for(const key of ['connectionTimeoutMillis','statement_timeout','query_timeout','lock_timeout'])assert.equal(config[key],5000);
  assert.equal(config.idle_in_transaction_session_timeout,30000);assert(!('leaseMs'in config));
});

test('identity SQL verifies the exact bigint advisory key, backend and database',()=>{
  for(const fragment of ["hashtextextended('royal_game',0)",'pg_backend_pid()','txid_current()::text','pg_locks',"l.locktype='advisory'",'l.pid=pg_backend_pid()','current_database()','l.classid::bigint','l.objid::bigint','4294967295::bigint','l.objsubid=1',"l.mode='ExclusiveLock'",'l.granted'])assert(SQL.identity.includes(fragment),fragment);
  assert(!SQL.identity.includes('pg_try_advisory'));
});

test('strict parser permits either key order and rejects ambiguous records',()=>{
  assert.deepEqual(parseCommand(' { "nonce": "'+nonce(1)+'", "op": "confirm" }\r'),{nonce:nonce(1),op:'confirm'});
  for(const line of ['', 'release','{}','[]','{"op":"unknown","nonce":"'+nonce(1)+'"}', '{"op":"confirm","nonce":"short"}', '{"op":"confirm","nonce":"'+nonce(1)+'","extra":true}', '{"op":"confirm","op":"release","nonce":"'+nonce(1)+'"}'])assert.throws(()=>parseCommand(line));
});

test('quiet, fresh confirm and explicit release retain one backend and transaction',async()=>{
  const f=fixture();await f.quiet();
  f.input.write(command('confirm',1));await f.until(()=>f.events.some(row=>row.event==='confirmed'));
  assert.equal(f.client.verifications,2);
  f.input.write(command('release',2));assert.equal(await f.promise,0);
  assert.deepEqual(f.events.map(row=>row.event),['quiet','confirmed','released']);
  assert.deepEqual(held(f.events).map(row=>row.seq),[1,2]);
  for(const event of held(f.events)){assert.equal(event.backendPid,1234);assert.equal(event.transactionId,'1');assert.equal(event.financialLockHeld,true);assert.equal(event.leaseMs,2000);}
  assert.deepEqual(f.events.at(-1),{format:1,event:'released',nonce:nonce(2),committed:true,backendPid:1234,transactionId:'1'});
  assert.equal(f.events[1].nonce,nonce(1));assert.equal(f.client.verifications,3);
  assert.equal(f.client.calls.filter(row=>row==='BEGIN').length,1);assert.equal(f.client.maxInFlight,1);
  assert.equal(f.client.connected,1);assert.equal(f.client.ended,1);
  assert(f.client.calls.indexOf('COMMIT')>f.client.calls.lastIndexOf(SQL.identity));
});

test('drain rolls back each active attempt and retains the final transaction only',async()=>{
  const f=fixture({active:['2','1','0']});await f.quiet();
  assert.equal(f.events.filter(row=>row.event==='waiting').length,2);
  assert.equal(f.client.calls.filter(row=>row==='BEGIN').length,3);
  assert.equal(f.client.calls.filter(row=>row==='ROLLBACK').length,2);
  assert.equal(f.events.find(row=>row.event==='quiet').transactionId,'3');
  f.input.write(command('release',1));assert.equal(await f.promise,0);assert.equal(f.client.connected,1);
});

test('heartbeat always performs another serial exact-lock verification',async()=>{
  const f=fixture({}, {heartbeatMs:8});await f.quiet();await f.until(()=>f.events.some(row=>row.event==='heartbeat'));
  assert(f.client.verifications>=2);const values=held(f.events);assert(values.every((row,index)=>row.seq===index+1));
  f.input.write(command('release',1));assert.equal(await f.promise,0);assert.equal(f.client.maxInFlight,1);
});

for(const [name,changed]of [['backend PID',{backend_pid:9999}],['transaction identity',{transaction_id:'999'}],['exact advisory lock',{financial_lock_held:false}]]){
  test('lost '+name+' rejects heartbeat without reacquiring or reconnecting',async()=>{
    const f=fixture({identity:index=>index>=2?changed:{}},{heartbeatMs:5});assert.equal(await f.promise,1);failed(f);
    assert(f.client.calls.includes('ROLLBACK'));assert.equal(f.client.calls.filter(row=>row==='BEGIN').length,1);assert.equal(f.events.filter(row=>row.event==='heartbeat').length,0);
  });
}

test('transaction IDs remain decimal strings above the JavaScript safe integer range',async()=>{
  const f=fixture({identity:()=>({transaction_id:'18446744073709551614'})});await f.quiet();f.input.write(command('release',1));assert.equal(await f.promise,0);assert.equal(f.events.at(-1).transactionId,'18446744073709551614');
});

for(const [name,row]of [['PID type',{backend_pid:'1234'}],['PID range',{backend_pid:0}],['transaction type',{transaction_id:1}],['transaction format',{transaction_id:'1e3'}],['lock type',{financial_lock_held:'true'}]]){
  test('invalid SQL '+name+' cannot emit quiet',async()=>{
    const f=fixture({identity:()=>row});assert.equal(await f.promise,1);failed(f);assert(!f.events.some(row=>row.event==='quiet'));
  });
}

test('final release performs fresh verification and refuses a lost lock before COMMIT',async()=>{
  const f=fixture({identity:index=>index===2?{financial_lock_held:false}:{}});await f.quiet();f.input.write(command('release',1));assert.equal(await f.promise,1);failed(f);assert(f.client.calls.includes('ROLLBACK'));
});

test('a COMMIT returning ROLLBACK cannot produce committed acknowledgement',async()=>{
  const f=fixture({commitTag:'ROLLBACK'});await f.quiet();f.input.write(command('release',1));assert.equal(await f.promise,1);assert(!f.events.some(row=>row.event==='released'));assert(f.events.some(row=>row.event==='error'));
});

test('EOF while held causes rollback and nonzero exit',async()=>{
  const f=fixture();await f.quiet();assert.equal(await f.stop(),1);failed(f);assert(f.client.calls.includes('ROLLBACK'));
});

test('EOF after release input is not implicit success before acknowledgement',async()=>{
  const f=fixture({queryDelay:2});await f.quiet();f.input.end(command('release',1));assert.equal(await f.promise,1);failed(f);
});

for(const [name,line]of [['plain text','release\n'],['empty line','\n'],['unknown operation','{"op":"other","nonce":"'+nonce(1)+'"}\n'],['duplicate keys','{"op":"confirm","op":"release","nonce":"'+nonce(1)+'"}\n'],['long line','x'.repeat(LIMITS.lineBytes+1)+'\n']]){
  test('invalid '+name+' rolls back without success',async()=>{
    const f=fixture();await f.quiet();f.input.write(line);assert.equal(await f.promise,1);failed(f);
  });
}

test('incomplete JSON followed by EOF fails closed',async()=>{
  const f=fixture();await f.quiet();f.input.end('{"op":"confirm"');assert.equal(await f.promise,1);failed(f);
});

test('confirm nonces cannot be replayed or reused as release nonces',async()=>{
  for(const op of ['confirm','release']){
    const f=fixture();await f.quiet();f.input.write(command('confirm',1));await f.until(()=>f.events.some(row=>row.event==='confirmed'));f.input.write(command(op,1));assert.equal(await f.promise,1);failed(f);assert.equal(f.events.filter(row=>row.event==='confirmed').length,1);
  }
});

test('two releases in one input batch cannot commit',async()=>{
  const f=fixture();await f.quiet();f.input.write(command('release',1)+command('release',2));assert.equal(await f.promise,1);failed(f);
});

test('commands after queued release and excessive backlog fail closed',async()=>{
  for(const value of [command('release',1)+command('confirm',2),Array.from({length:LIMITS.queuedCommands+1},(_,index)=>command('confirm',index+1)).join('')]){
    const f=fixture();await f.quiet();f.input.write(value);assert.equal(await f.promise,1);failed(f);
  }
});

test('queued confirms take priority over the next heartbeat without overlapping SQL',async()=>{
  let heartbeatStarted;
  const started=new Promise(resolve=>{heartbeatStarted=resolve;});
  const f=fixture({query:async(text,client)=>{if(text===SQL.identity&&client.verifications===1){heartbeatStarted();await delay(20);}}},{heartbeatMs:5});
  await f.quiet();await started;f.input.write(command('confirm',1)+command('confirm',2));
  await f.until(()=>f.events.filter(row=>row.event==='confirmed').length===2);
  const sequence=f.events.map(row=>row.event);const first=sequence.indexOf('confirmed');assert.equal(sequence[first+1],'confirmed');
  f.input.write(command('release',3));assert.equal(await f.promise,0);assert.equal(f.client.maxInFlight,1);
});

test('asynchronous PostgreSQL error is generic and does not reconnect',async()=>{
  const f=fixture();await f.quiet();f.client.emit('error',Error('postgres://secret-password@example/private'));assert.equal(await f.promise,1);failed(f);assert(!JSON.stringify(f.events).includes('secret-password'));assert(!f.errors.join('').includes('secret-password'));
});

test('unexpected PostgreSQL end event fails while held',async()=>{
  const f=fixture();await f.quiet();f.client.forceClose();f.client.emit('end');assert.equal(await f.promise,1);failed(f);
});

test('heartbeat SQL error causes rollback without emitting an unverified heartbeat',async()=>{
  const f=fixture({query:(text,client)=>{if(text===SQL.identity&&client.verifications===1)throw Error('private SQL details');}},{heartbeatMs:5});assert.equal(await f.promise,1);failed(f);assert(!f.events.some(row=>row.event==='heartbeat'));
});

test('hung SQL is bounded and closes the session without overlapping rollback queries',async()=>{
  const f=fixture({hang:SQL.identity},{queryMs:15});assert.equal(await f.promise,1);failed(f);assert.equal(f.client.calls.filter(row=>row==='ROLLBACK').length,0);assert.equal(f.client.closed,true);
});

test('hard lease expires despite healthy heartbeats and confirmation traffic',async()=>{
  const f=fixture({}, {leaseMs:45,heartbeatMs:5});await f.quiet();
  let value=1;const timer=setInterval(()=>f.input.write(command('confirm',value++)),4);
  try{assert.equal(await f.promise,1);}finally{clearInterval(timer);}
  failed(f);assert(f.events.some(row=>row.event==='heartbeat'||row.event==='confirmed'));assert(f.client.calls.includes('ROLLBACK'));
});

test('drain deadline never emits quiet or commits while funded operations remain',async()=>{
  const f=fixture({active:['1']},{drainMs:25,pollMs:4});assert.equal(await f.promise,1);failed(f);assert(f.events.some(row=>row.event==='waiting'));assert(!f.events.some(row=>row.event==='quiet'));
});

test('connect failure remains generic and never issues SQL',async()=>{
  const f=fixture({connectError:true});assert.equal(await f.promise,1);assert.deepEqual(f.client.calls,['connect','end']);assert(!f.errors.join('').includes('credentials'));assert.deepEqual(f.events,[{format:1,event:'error',code:'GATE_FAILED'}]);
});

test('input before quiet cannot preauthorize any later operation',async()=>{
  const f=fixture({connectDelay:5});f.input.write(command('confirm',1));assert.equal(await f.promise,1);
  assert(f.events.some(row=>row.event==='error'));assert(!f.events.some(row=>row.event==='quiet'||row.event==='released'));
  assert.equal(f.client.connected,1);assert.equal(f.client.ended,1);assert.equal(f.client.maxInFlight,0);assert(!f.client.calls.includes('BEGIN'));
});

test('a verification finishing after the hard lease cannot emit confirmed or commit',async()=>{
  const f=fixture({query:async(text,client)=>{if(text===SQL.identity&&client.verifications===1)await delay(30);}},{leaseMs:15,heartbeatMs:100});
  await f.quiet();f.input.write(command('confirm',1));assert.equal(await f.promise,1);failed(f);
  assert(!f.events.some(row=>row.event==='confirmed'));assert(f.client.calls.includes('ROLLBACK'));
});

test('node-e entry semantics execute fixed production defaults while imports remain inert',async()=>{
  const client=new FakeClient(),input=new PassThrough(),events=[],errors=[];
  let config;
  const output=new Writable({write(chunk,encoding,callback){const row=JSON.parse(chunk.toString());events.push(row);callback();if(row.event==='quiet')queueMicrotask(()=>input.write(command('release',1)));}});
  const errorOutput=new Writable({write(chunk,encoding,callback){errors.push(chunk.toString());callback();}});
  const processFixture={env:{ROYAL_GATE_LEASE_MS:'1',GATE_LEASE_MS:'1'},stdin:input,stdout:output,stderr:errorOutput,exitCode:undefined};
  const requireFixture=name=>name==='pg'?{Client:class{constructor(value){config=value;return client;}}}:require(name);
  const completion=vm.runInNewContext(readFileSync(new URL('./quiesce.cjs',import.meta.url),'utf8'),
    {require:requireFixture,module:{exports:{},parent:undefined},process:processFixture,Buffer,setTimeout,clearTimeout,queueMicrotask});
  await completion;
  assert.equal(processFixture.exitCode,0);assert.equal(events[0].event,'quiet');assert.equal(events[0].leaseMs,600000);
  assert.equal(events.at(-1).event,'released');assert.equal(config.query_timeout,5000);assert.equal(config.idle_in_transaction_session_timeout,30000);
  assert.equal(client.connected,1);assert.equal(client.calls.filter(row=>row==='BEGIN').length,1);assert.deepEqual(errors,[]);
});
