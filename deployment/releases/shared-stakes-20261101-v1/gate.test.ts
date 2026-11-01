import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),folder=resolve('deployment/releases/shared-stakes-20261101-v1');
process.env.ROYAL_STAKE_GATE_SCHEMA='royal_game';
process.env.ROYAL_STAKE_GATE_BASE=resolve('deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs');
const {TABLES}=require('./quiesce.cjs');
test('two financial gates fence host writes and Native ledger transactions until explicit release',async()=>{
 const db=new Client();await db.connect();
 try{
  for(const schema of ['royal_game','royal_nile_play']){
   await db.query('CREATE SCHEMA '+schema);
   const tables=new Set([...TABLES,'demo_afterglow_stake_rounds','pvp_matches']);
   for(const table of tables)await db.query('CREATE TABLE '+schema+'.'+table+'(state text,status text,game_id text,payload text,result text)');
  }
  const check="const{Client}=require('pg');(async()=>{const c=new Client();await c.connect();await c.query(\"SET lock_timeout='100ms'\");let blocked=false;try{await c.query(\"INSERT INTO royal_game.demo_operations(state) VALUES('test')\")}catch(e){if(e.code!=='55P03')throw e;blocked=true}if(!blocked)throw Error('Host wallet was not fenced');const r=await c.query(\"SELECT pg_try_advisory_xact_lock(hashtextextended('royal_nile_play',0)) AS acquired\");if(r.rows[0].acquired)throw Error('Native ledger was not fenced');await c.end()})().catch(e=>{console.error(e.message);process.exitCode=1})";
  const script=[
   'import sys,tempfile,time,importlib.util','from pathlib import Path',
   'sys.path.insert(0,'+JSON.stringify(resolve('deployment/releases/cat-purr-hall-only-20261030-v1'))+')',
   'sys.path.insert(0,'+JSON.stringify(folder)+')',
   "spec=importlib.util.spec_from_file_location('recovery',"+JSON.stringify(folder+'/forward-recovery.py')+")",
   'recovery=importlib.util.module_from_spec(spec);spec.loader.exec_module(recovery);DualGate=recovery.SupervisedGate',
   'base='+JSON.stringify(['env','ROYAL_STAKE_GATE_BASE='+resolve('deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs'),'NODE_PATH='+resolve('node_modules')]),
   "with tempfile.TemporaryDirectory(prefix='royal-stake-gates-') as temporary:",
   " logs=str(Path(temporary).resolve())",
   " a=DualGate(base+['ROYAL_STAKE_GATE_SCHEMA=royal_game','node',"+JSON.stringify(folder+'/quiesce.cjs')+"],Path.cwd(),Path(logs)/'host.log',min_free_bytes=1)",
   " b=DualGate(base+['ROYAL_STAKE_GATE_SCHEMA=royal_nile_play','node',"+JSON.stringify(folder+'/quiesce.cjs')+"],Path.cwd(),Path(logs)/'native.log',min_free_bytes=1)",
   ' a.peer=b;b.peer=a',' try:','  a.acquire();b.acquire();a.confirm();b.confirm()',
   '  with recovery.LeaseMonitor(a,b):','   time.sleep(12)',
   '   a.run('+JSON.stringify(['node','-e',check])+')','   b.release();a.release()',' finally:b.close();a.close()'
  ].join('\n');
  const child=spawn('python3',['-c',script],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const code=await new Promise((ok,bad)=>{child.once('error',bad);child.once('exit',ok);});assert.equal(code,0,output);
  await db.query("INSERT INTO royal_game.demo_operations(state) VALUES('released')");
  assert.equal((await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended('royal_nile_play',0)) AS acquired")).rows[0].acquired,true);
 }finally{for(const s of ['royal_game','royal_nile_play'])await db.query('DROP SCHEMA IF EXISTS '+s+' CASCADE');await db.end();}
});
