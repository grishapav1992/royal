// Extend the reviewed lease protocol with a native-wallet fence and additive-DDL readiness.
const TABLES=Object.freeze(['accounts','demo_wallets','demo_operations','demo_ledger','demo_casino_sessions',
  'demo_casino_requests','demo_mines_sessions','demo_mines_requests','demo_flight_sessions','demo_flight_requests',
  'virtual_pvp_banks','virtual_pvp_holds','combat_matches','skin_purchases','skin_jobs']);
// Untimed native rounds resume under their retained engines. Timed manual-cashout games still drain.
const ACTIVE_SQL=`SELECT
  (SELECT count(*) FROM royal_game.demo_flight_sessions WHERE state='active')+
  (SELECT count(*) FROM royal_game.demo_casino_sessions WHERE state='active' AND game_id IN ('github-crash'))+
  (SELECT count(*) FROM royal_game.combat_matches WHERE state='active')+
  (SELECT count(*) FROM royal_game.virtual_pvp_holds WHERE state='held')+
  (SELECT count(*) FROM royal_game.skin_purchases WHERE state='reserved')+
  (SELECT count(*) FROM royal_game.skin_jobs WHERE state IN ('reserving','generating','capturing','refunding')) AS active`;
const DDL_SQL=`SELECT has_schema_privilege(current_user,'royal_game','USAGE')
  AND has_schema_privilege(current_user,'royal_game','CREATE')
  AND EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='royal_game' AND c.relname='demo_ledger' AND pg_has_role(current_user,c.relowner,'USAGE'))
  AND (SELECT count(*)=2 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='royal_game' AND c.relname IN ('skin_jobs','progression_settings') AND pg_has_role(current_user,c.relowner,'USAGE')) AS ready`;
const FENCE_SQL='LOCK TABLE '+TABLES.map(n=>'royal_game.'+n).join(',')+' IN SHARE MODE NOWAIT';
const FENCE_IDENTITY_SQL=`SELECT count(DISTINCT relation)=${TABLES.length} AS held FROM pg_locks
  WHERE pid=pg_backend_pid() AND locktype='relation' AND mode='ShareLock' AND granted
  AND relation IN (${TABLES.map(n=>"'royal_game."+n+"'::regclass").join(',')})`;

function decorateClient(client,base){
  const query=client.query.bind(client);
  const text=value=>typeof value==='string'?value:value.text;
  const replacement=(original,sql)=>typeof original==='string'?sql:{...original,text:sql};
  return new Proxy(client,{get(target,key){
    if(key!=='query'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
    return async(value,...args)=>{
      if(text(value)===base.SQL.active){
        const active=await query(replacement(value,ACTIVE_SQL),...args);
        if(active.rows?.length!==1||!/^\d+$/.test(String(active.rows[0].active)))throw Error('Invalid active money state');
        if(BigInt(active.rows[0].active)!==0n)return active;
        const ddl=await query(replacement(value,DDL_SQL),...args);
        if(ddl.rows?.length!==1||ddl.rows[0].ready!==true)throw Error('Application role cannot apply additive progression DDL');
        try{await query(replacement(value,FENCE_SQL),...args);}
        catch(error){
          // NOWAIT aborts this transaction. The base protocol immediately rolls it back and lets players finish.
          if(error?.code==='55P03')return{rows:[{active:'1'}]};
          throw error;
        }
        return query(replacement(value,ACTIVE_SQL),...args);
      }
      const result=await query(value,...args);
      if(text(value)===base.SQL.identity){
        const fence=await query(replacement(value,FENCE_IDENTITY_SQL),...args);
        if(fence.rows?.length!==1||fence.rows[0].held!==true){
          if(result.rows?.[0])result.rows[0].financial_lock_held=false;
        }
      }
      return result;
    };
  }});
}

module.exports={decorateClient,TABLES,ACTIVE_SQL,DDL_SQL,FENCE_SQL,FENCE_IDENTITY_SQL};
if(!module.parent){
  (async()=>{
    try{
      const base=globalThis.ROYAL_LOCATION_GATE_BASE||require('./quiesce-base.cjs');
      const {Client}=require('pg');
      process.exitCode=await base.runGate({client:decorateClient(new Client(base.configuration()),base)});
    }catch{
      process.stdout.write(JSON.stringify({format:1,event:'error',code:'GATE_FAILED'})+'\n');
      process.stderr.write('Release financial gate failed\n');process.exitCode=1;
    }
    process.stdin.pause();process.stdin.unref?.();
  })();
}
