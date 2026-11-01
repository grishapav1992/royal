// Fence both wallet schemas while compatible programs and module pointers switch.
const schema=process.env.ROYAL_STAKE_GATE_SCHEMA;
if(!['royal_game','royal_nile_play'].includes(schema))throw Error('Invalid stake gate schema');
const base=require(process.env.ROYAL_STAKE_GATE_BASE||'./quiesce-base.cjs');
const TABLES=['accounts','demo_wallets','demo_operations','demo_ledger','demo_casino_sessions','demo_casino_requests','demo_mines_sessions','demo_mines_requests','demo_flight_sessions','demo_flight_requests','virtual_pvp_banks','virtual_pvp_holds','combat_matches','skin_purchases','skin_jobs','progression_settings','progression_policies','progression_rounds','progression_outbox','progression_players','progression_xp','progression_rewards','progression_milestones','progression_skin_rewards','progression_spin_uses','progression_skin_uses'];
const active=schema==='royal_nile_play'
 ? `SELECT ((SELECT count(*) FROM ${schema}.demo_flight_sessions WHERE state='active')+(SELECT count(*) FROM ${schema}.demo_casino_sessions WHERE state='active' AND game_id='github-crash')+(SELECT count(*) FROM ${schema}.pvp_matches WHERE status IN ('arriving','playing'))+(SELECT count(*) FROM ${schema}.skin_purchases WHERE state='reserved')) AS active`
 : `SELECT ((SELECT count(*) FROM ${schema}.demo_flight_sessions WHERE state='active')+(SELECT count(*) FROM ${schema}.demo_casino_sessions WHERE state='active' AND game_id='github-crash')+(SELECT count(*) FROM ${schema}.combat_matches WHERE state='active')+(SELECT count(*) FROM ${schema}.virtual_pvp_holds WHERE state='held')+(SELECT count(*) FROM ${schema}.skin_purchases WHERE state='reserved')+(SELECT count(*) FROM ${schema}.skin_jobs WHERE state IN ('reserving','generating','capturing','refunding'))) AS active`;
const adoption=`SELECT ((SELECT count(*) FROM ${schema}.demo_casino_sessions WHERE payload::jsonb->>'stakePolicyVersion'='1')+(SELECT count(*) FROM ${schema}.demo_operations WHERE result::jsonb->'gameRound'->'precision' IS NOT NULL))::text AS adopted`;
function decorate(client){const query=client.query.bind(client);return new Proxy(client,{get(target,key){if(key!=='query'){const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}return async(value,...args)=>{
 const text=typeof value==='string'?value:value.text,replace=sql=>typeof value==='string'?sql:{...value,text:sql};
 if(text===base.SQL.active){
  const result=await query(replace(active),...args);if(result.rows.length!==1||!/^\d+$/.test(String(result.rows[0].active)))throw Error('Invalid active stake state');
  if(String(result.rows[0].active)!=='0')return result;
  const ddl=await query(`SELECT has_schema_privilege(current_user,'${schema}','CREATE') AND (SELECT count(*)=2 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${schema}' AND c.relname IN ('demo_operations','demo_afterglow_stake_rounds') AND pg_has_role(current_user,c.relowner,'USAGE')) AS ready`);if(ddl.rows[0]?.ready!==true)throw Error('Stake migration owner privileges are unavailable');
  if(process.env.ROYAL_STAKE_GATE_ROLLBACK==='1'&&String((await query(adoption)).rows[0]?.adopted)!=='0')throw Error('Accepted shared-stake rounds require a compatible forward release');
  if(schema==='royal_game')try{await query('LOCK TABLE '+TABLES.map(n=>schema+'.'+n).join(',')+' IN SHARE MODE NOWAIT');}catch(error){if(error.code==='55P03')return{rows:[{active:'1'}]};throw error;}
  return query(replace(active),...args);
 }
 if(text===base.SQL.lock||text===base.SQL.identity)return query(replace(text.replaceAll('royal_game',schema)),...args);
 return query(value,...args);
 };}});}
module.exports={decorate,TABLES,active,adoption};
if(!module.parent)(async()=>{try{const{Client}=require('pg');process.exitCode=await base.runGate({client:decorate(new Client(base.configuration()))});}catch{process.stdout.write(JSON.stringify({format:1,event:'error',code:'STAKE_GATE_FAILED'})+'\n');process.exitCode=1;}process.stdin.pause();process.stdin.unref?.();})();
