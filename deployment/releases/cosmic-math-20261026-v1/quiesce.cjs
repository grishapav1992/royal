// One PostgreSQL session retains the exact financial lock until explicit verified release.
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const {StringDecoder} = require('node:string_decoder');

const DEFAULTS = Object.freeze({drainMs:180000, leaseMs:600000, heartbeatMs:2000,
  pollMs:1000, queryMs:5000, closeMs:5000, writeMs:5000});
const LIMITS = Object.freeze({lineBytes:256, queuedCommands:16, nonces:1024});
const SQL = Object.freeze({
  lock:"SELECT pg_advisory_xact_lock(hashtextextended('royal_game',0))",
  active:"SELECT (SELECT count(*) FROM royal_game.combat_matches WHERE state='active') + (SELECT count(*) FROM royal_game.virtual_pvp_holds WHERE state='held') AS active",
  identity:`SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id,
    EXISTS (SELECT 1 FROM pg_locks l
      WHERE l.locktype='advisory' AND l.pid=pg_backend_pid()
        AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND l.classid::bigint=((hashtextextended('royal_game',0) >> 32) & 4294967295::bigint)
        AND l.objid::bigint=(hashtextextended('royal_game',0) & 4294967295::bigint)
        AND l.objsubid=1 AND l.mode='ExclusiveLock' AND l.granted) AS financial_lock_held`
});

function configuration(env=process.env, read=fs.readFileSync) {
  const secret = name => env[name + '_FILE'] ? read(env[name + '_FILE'],'utf8').trim() : env[name];
  const url = secret('DATABASE_URL');
  const config = url ? {connectionString:url} : {host:env.PGHOST, port:Number(env.PGPORT || 5432),
    database:env.PGDATABASE, user:env.PGUSER, password:secret('PGPASSWORD')};
  config.ssl = env.PGSSLMODE === 'verify-full' ? {rejectUnauthorized:true,
    ...(env.PGSSLROOTCERT ? {ca:read(env.PGSSLROOTCERT,'utf8')} : {})} : false;
  return Object.assign(config,{application_name:'royal/security-release-gate', connectionTimeoutMillis:5000,
    statement_timeout:5000, query_timeout:5000, lock_timeout:5000, idle_in_transaction_session_timeout:30000});
}

function fault() { return new Error('Release financial gate failed'); }
function requireValue(condition) { if (!condition) throw fault(); }

function parseCommand(line) {
  requireValue(Buffer.byteLength(line,'utf8') <= LIMITS.lineBytes);
  const opFirst = /^\s*\{\s*"op"\s*:\s*"(?:confirm|release)"\s*,\s*"nonce"\s*:\s*"[a-f0-9]{32}"\s*\}\s*$/;
  const nonceFirst = /^\s*\{\s*"nonce"\s*:\s*"[a-f0-9]{32}"\s*,\s*"op"\s*:\s*"(?:confirm|release)"\s*\}\s*$/;
  requireValue(opFirst.test(line) || nonceFirst.test(line));
  return JSON.parse(line);
}

async function runGate({client, input=process.stdin, output=process.stdout,
  errorOutput=process.stderr, timings={}, now=()=>performance.now()}={}) {
  const time = {...DEFAULTS,...timings};
  requireValue(client && input && output && Object.values(time).every(value=>Number.isInteger(value)&&value>0));
  let fatal=null, phase='connecting', closing=false, connected=false, inTransaction=false;
  let pendingQuery=null, wake=null, sleepTimer=null, hardTimer=null, released=false, seq=0;
  let leaseDeadline=Infinity, nextHeartbeat=Infinity, identity=null, partial='';
  const queue=[], nonces=new Set(), decoder=new StringDecoder('utf8');
  const drainDeadline=now()+time.drainMs;
  const notify=()=>{if(wake){const resume=wake;wake=null;resume();}};
  const fail=()=>{fatal ||= fault();notify();};
  const check=()=>{if(fatal)throw fatal;if(now()>=leaseDeadline)throw fault();};
  const onClientError=()=>{if(!closing)fail();};
  const onClientEnd=()=>{if(!closing)fail();};
  const onInputEnd=()=>{if(!released)fail();};
  const onInputError=()=>fail();
  const onOutputError=()=>fail();
  let releaseQueued=false;
  const onData=chunk=>{
    if(released || fatal)return;
    try {
      requireValue(phase==='held');
      const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      requireValue(Buffer.byteLength(partial,'utf8')+bytes.length <= LIMITS.lineBytes*(LIMITS.queuedCommands+1));
      partial+=decoder.write(bytes);
      let newline;
      while((newline=partial.indexOf('\n'))!==-1){
        const line=partial.slice(0,newline);partial=partial.slice(newline+1);
        requireValue(!releaseQueued && queue.length<LIMITS.queuedCommands && nonces.size<LIMITS.nonces);
        const command=parseCommand(line);
        requireValue(!nonces.has(command.nonce));nonces.add(command.nonce);
        if(command.op==='release')releaseQueued=true;
        queue.push(command);
      }
      requireValue(Buffer.byteLength(partial,'utf8')<=LIMITS.lineBytes);
      notify();
    } catch {fail();}
  };
  client.on('error',onClientError);client.on('end',onClientEnd);
  input.on('data',onData);input.on('end',onInputEnd);input.on('error',onInputError);output.on('error',onOutputError);
  if(input.readableEnded || input.destroyed)fail();

  async function bounded(operation, milliseconds) {
    let timer;
    try {return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fault()),milliseconds);})]);}
    finally {clearTimeout(timer);}
  }
  async function query(text, cleanup=false) {
    if(!cleanup)check();
    requireValue(!pendingQuery || pendingQuery.settled);
    const tracked={settled:false};pendingQuery=tracked;
    const operation=Promise.resolve().then(()=>client.query({text,query_timeout:time.queryMs}));
    operation.then(()=>{tracked.settled=true;},()=>{tracked.settled=true;});
    const value=await bounded(()=>operation,time.queryMs);
    if(!cleanup)check();
    return value;
  }
  async function writeLine(stream, value) {
    await bounded(()=>new Promise((resolve,reject)=>{
      stream.write(JSON.stringify(value)+'\n',error=>error?reject(fault()):resolve());
    }),time.writeMs);
  }
  async function heldEvent(event, nonce) {
    check();
    await writeLine(output,{format:1,event,financialLockHeld:true,backendPid:identity.backendPid,
      transactionId:identity.transactionId,seq:++seq,leaseMs:time.leaseMs,...(nonce?{nonce}:{})});
    check();
  }
  async function verifyIdentity() {
    const result=await query(SQL.identity);
    requireValue(result.rows?.length===1);
    const row=result.rows[0];
    requireValue(Number.isInteger(row.backend_pid) && row.backend_pid>0
      && typeof row.transaction_id==='string' && /^[1-9][0-9]*$/.test(row.transaction_id)
      && row.financial_lock_held===true);
    const actual={backendPid:row.backend_pid,transactionId:row.transaction_id};
    if(identity)requireValue(actual.backendPid===identity.backendPid && actual.transactionId===identity.transactionId);
    else identity=actual;
  }
  async function sleep(milliseconds) {
    check();
    await new Promise(resolve=>{wake=resolve;sleepTimer=setTimeout(notify,Math.max(1,Math.ceil(milliseconds)));});
    clearTimeout(sleepTimer);sleepTimer=null;wake=null;check();
  }
  async function closeSession() {
    closing=true;
    try {await bounded(()=>client.end(),time.closeMs);return true;}
    catch {
      // Closing this connection rolls back an unfinished transaction without another SQL request.
      client.connection?.stream?.destroy();client.unref?.();return false;
    }
  }

  let success=false, closed=false;
  try {
    check();await bounded(()=>client.connect(),time.queryMs);connected=true;check();phase='draining';
    while(true){
      requireValue(now()<drainDeadline);
      await query('BEGIN');inTransaction=true;
      await query(SQL.lock);
      const result=await query(SQL.active);
      requireValue(result.rows?.length===1 && /^[0-9]+$/.test(String(result.rows[0].active)));
      if(BigInt(result.rows[0].active)===0n){requireValue(now()<drainDeadline);break;}
      await query('ROLLBACK');inTransaction=false;
      await writeLine(output,{format:1,event:'waiting'});
      requireValue(now()<drainDeadline);
      await sleep(Math.min(time.pollMs,drainDeadline-now()));
    }
    await verifyIdentity();
    requireValue(now()<drainDeadline);
    phase='held';leaseDeadline=now()+time.leaseMs;nextHeartbeat=now()+time.heartbeatMs;
    hardTimer=setTimeout(fail,time.leaseMs);
    await heldEvent('quiet');
    while(true){
      check();
      if(queue.length){
        const command=queue.shift();
        await verifyIdentity();check();
        if(command.op==='confirm'){await heldEvent('confirmed',command.nonce);continue;}
        phase='releasing';
        const result=await query('COMMIT');inTransaction=false;
        requireValue(result.command==='COMMIT');check();
        await writeLine(output,{format:1,event:'released',nonce:command.nonce,committed:true,
          backendPid:identity.backendPid,transactionId:identity.transactionId});
        check();released=true;success=true;break;
      }
      if(now()>=nextHeartbeat){
        await verifyIdentity();await heldEvent('heartbeat');nextHeartbeat=now()+time.heartbeatMs;continue;
      }
      await sleep(Math.min(nextHeartbeat-now(),leaseDeadline-now()));
    }
  } catch {fail();}
  finally {
    clearTimeout(hardTimer);clearTimeout(sleepTimer);wake=null;
    if(!success && connected && inTransaction && (!pendingQuery || pendingQuery.settled)){
      try {await query('ROLLBACK',true);inTransaction=false;}catch {}
    }
    closed=await closeSession();
    if(!closed)success=false;
    if(!success){
      try {await writeLine(output,{format:1,event:'error',code:'GATE_FAILED'});}catch {}
      try {await bounded(()=>new Promise(resolve=>errorOutput.write('Release financial gate failed\n',()=>resolve())),time.writeMs);}catch {}
    }
    input.removeListener('data',onData);input.removeListener('end',onInputEnd);input.removeListener('error',onInputError);input.pause?.();
    output.removeListener('error',onOutputError);
    if(closed){client.removeListener('error',onClientError);client.removeListener('end',onClientEnd);}
  }
  return success && !fatal && closed ? 0 : 1;
}

module.exports={runGate,configuration,parseCommand,DEFAULTS,LIMITS,SQL};
if(!module.parent){
  (async()=>{
    try {
      const {Client}=require('pg');
      process.exitCode=await runGate({client:new Client(configuration())});
    } catch {
      process.stdout.write(JSON.stringify({format:1,event:'error',code:'GATE_FAILED'})+'\n');
      process.stderr.write('Release financial gate failed\n');process.exitCode=1;
    }
    process.stdin.pause();process.stdin.unref?.();
  })();
}
