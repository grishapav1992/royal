const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {Client}=require('pg');
const base=require('../cat-purr-hall-only-20261030-v1/quiesce.cjs');
const helper=require('./quiesce.cjs');

test('persisted native sessions remain while the PostgreSQL fence blocks an actual writer until lease release',{timeout:15000},async()=>{
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.PGDATABASE,'royal_test');assert.equal(process.env.PGHOST,'127.0.0.1');
  const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD};
  const admin=new Client(config),writer=new Client(config),gateClient=new Client(config);
  await admin.connect();await writer.connect();
  const stateTables=new Set(['demo_casino_sessions','demo_mines_sessions','demo_flight_sessions','combat_matches','virtual_pvp_holds','skin_purchases']);
  const input=new PassThrough(),output=new PassThrough(),errorOutput=new PassThrough();
  let gate,quiet=false,buffer='',resolveQuiet,rejectQuiet;
  const acquired=new Promise((resolve,reject)=>{resolveQuiet=resolve;rejectQuiet=reject;});
  output.on('data',chunk=>{
    buffer+=chunk;let index;
    while((index=buffer.indexOf('\n'))!==-1){const event=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);if(event.event==='quiet'){quiet=true;resolveQuiet();}}
  });
  try{
    await admin.query('CREATE SCHEMA royal_game');
    for(const name of helper.TABLES)await admin.query('CREATE TABLE royal_game.'+name+'('+ (name==='demo_casino_sessions'?'state TEXT,game_id TEXT':stateTables.has(name)?'state TEXT':'id TEXT')+')');
    await admin.query("INSERT INTO royal_game.demo_casino_sessions VALUES('active','github-tower')");
    await admin.query("INSERT INTO royal_game.demo_mines_sessions VALUES('active')");
    assert.equal(Number((await admin.query(helper.ACTIVE_SQL)).rows[0].active),0);
    for(const[name,state]of [['demo_flight_sessions','active'],['combat_matches','active'],['virtual_pvp_holds','held'],['skin_purchases','reserved']]){
      await admin.query('INSERT INTO royal_game.'+name+' VALUES($1)',[state]);
      assert.equal(Number((await admin.query(helper.ACTIVE_SQL)).rows[0].active),1,name+' must block publication');
      await admin.query('DELETE FROM royal_game.'+name);
    }
    await admin.query("INSERT INTO royal_game.demo_casino_sessions VALUES('active','github-crash')");
    assert.equal(Number((await admin.query(helper.ACTIVE_SQL)).rows[0].active),1,'Crash must block publication');
    await admin.query("DELETE FROM royal_game.demo_casino_sessions WHERE game_id='github-crash'");
    assert.equal((await admin.query(helper.DDL_SQL)).rows[0].ready,true);
    await admin.query('CREATE ROLE location_levels_no_ddl NOLOGIN');
    await admin.query('GRANT USAGE ON SCHEMA royal_game TO location_levels_no_ddl');
    await admin.query('SET ROLE location_levels_no_ddl');
    assert.equal((await admin.query(helper.DDL_SQL)).rows[0].ready,false);await admin.query('RESET ROLE');
    gate=base.runGate({client:helper.decorateClient(gateClient,base),input,output,errorOutput,
      timings:{drainMs:2000,leaseMs:5000,heartbeatMs:100,pollMs:10,queryMs:1000,closeMs:1000,writeMs:1000}});
    gate.then(code=>{if(!quiet)rejectQuiet(Error('Financial gate ended before acquiring the PostgreSQL fence: '+code));});
    await acquired;
    await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
    await writer.query("SELECT pg_advisory_xact_lock(hashtextextended('royal_game:key:account:fixture',0))");
    await assert.rejects(writer.query("INSERT INTO royal_game.demo_wallets VALUES('fixture')"),error=>error.code==='55P03');
    await writer.query('ROLLBACK');
    input.write(JSON.stringify({op:'release',nonce:'b'.repeat(32)})+'\n');assert.equal(await gate,0);
    await writer.query("INSERT INTO royal_game.demo_wallets VALUES('fixture')");
    assert.equal((await writer.query('SELECT count(*)::int AS n FROM royal_game.demo_wallets')).rows[0].n,1);
    for(const name of ['demo_casino_sessions','demo_mines_sessions'])assert.equal((await admin.query('SELECT count(*)::int AS n FROM royal_game.'+name+" WHERE state='active'")).rows[0].n,1);
  }finally{
    if(quiet&&gate){input.end();await gate.catch(()=>{});}
    await writer.end();await admin.query('RESET ROLE').catch(()=>{});
    await admin.query('DROP SCHEMA IF EXISTS royal_game CASCADE');await admin.query('DROP ROLE IF EXISTS location_levels_no_ddl');
    await admin.end();
  }
});
