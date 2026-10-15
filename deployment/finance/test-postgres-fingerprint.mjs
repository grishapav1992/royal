import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

async function copyClient(){
 const c=new pg.Client({...JSON.parse(process.argv[3]),database:process.argv[4]});
 try{
  await c.connect();const q=new pg.Query(readFileSync(0,'utf8'));
  q.handleCopyData=(message,connection)=>{if(!process.stdout.write(Buffer.from(message.chunk))){connection.stream.pause();process.stdout.once('drain',()=>connection.stream.resume());}};
  q.on('row',row=>{const v=Object.values(row)[0];process.stdout.write((typeof v==='object'?JSON.stringify(v):String(v))+'\n');});
  await new Promise((resolve,reject)=>{q.on('end',resolve);q.on('error',reject);c.query(q);});await c.end();
 }catch(error){console.error(error.code||'fixture_query_failed');await c.end().catch(()=>{});process.exitCode=1;}
}

async function main(){
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const directory=await mkdtemp(join(tmpdir(),'royal-fingerprint-test-'));
 const password='local-fixture-only-password';
 const server=new EmbeddedPostgres({databaseDir:join(directory,'pg'),port,user:'postgres',password,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 const config={host:'127.0.0.1',port,user:'postgres',password};const pools=[];let started=false;
 try{
  await server.initialise();await server.start();started=true;
  const admin=new pg.Pool({...config,database:'postgres'});pools.push(admin);
  for(const name of ['royal_fingerprint_source','royal_fingerprint_copy'])await admin.query('CREATE DATABASE '+name);
  for(const name of ['royal_fingerprint_source','royal_fingerprint_copy']){
   const p=new pg.Pool({...config,database:name});pools.push(p);
   await p.query([
    'CREATE SCHEMA royal_game;',
    'CREATE TABLE royal_game._royal_migrations(name text PRIMARY KEY,checksum text NOT NULL);',
    "INSERT INTO royal_game._royal_migrations VALUES('fixture','sha-fixture');",
    'CREATE TABLE royal_game.sample(id bigint PRIMARY KEY,value text NOT NULL);',
    'INSERT INTO royal_game.sample SELECT g,repeat(md5(g::text),64) FROM generate_series(1,6000) g;',
    'CREATE TABLE royal_game.empty_table(id bigint PRIMARY KEY,note text);'
   ].join('\n'));
  }
  const result=spawnSync(process.env.ROYAL_TEST_PYTHON??'python3',[fileURLToPath(new URL('./test-postgres-fingerprint.py',import.meta.url)),process.execPath,fileURLToPath(import.meta.url),JSON.stringify(config)],{encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());
 }finally{for(const p of pools)await p.end();if(started)await server.stop();await rm(directory,{recursive:true,force:true});}
}
if(process.argv[2]==='--copy-client')await copyClient();else await main();
