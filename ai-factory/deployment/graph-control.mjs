import { Store } from '/app/lib/store.mjs';
import { config } from '/app/lib/config.mjs';
const store = new Store({connectionString:config().databaseUrl});
try {
  await store.init();
  const action=process.argv[2]||'status';
  if(action==='pause') {
    const settings=await store.getSettings();
    await store.pool.query(`INSERT INTO ${store.table}.settings(key,value) VALUES('_graph_maintenance',$1::jsonb) ON CONFLICT(key) DO NOTHING`,[JSON.stringify({paused:settings.paused})]);
    await store.updateSettings({paused:true});
  } else if(action==='resume') {
    const previous=(await store.pool.query(`SELECT value FROM ${store.table}.settings WHERE key='_graph_maintenance'`)).rows[0]?.value;
    if(previous) {await store.updateSettings({paused:previous.paused});await store.pool.query(`DELETE FROM ${store.table}.settings WHERE key='_graph_maintenance'`);}
  }
  const [settings,runtime,active]=await Promise.all([store.getSettings(),store.getRuntime(),store.pool.query(`SELECT count(*)::integer AS count FROM ${store.table}.jobs WHERE status='running'`)]);
  process.stdout.write(JSON.stringify({paused:settings.paused,auto_develop:settings.auto_develop,auto_release:settings.auto_release,authenticated:runtime.authenticated,worker_status:runtime.worker_status,active_jobs:active.rows[0].count}));
} finally {await store.close();}
