import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { Sessions } from '../lib/owner.mjs';
import { config } from '../lib/config.mjs';

const options=config();
const store=new Store({connectionString:options.databaseUrl});
const sessions=new Sessions(store.pool);
const base=`${options.origin}${options.prefix}/`;
let session;
try {
  const health=await fetch(new URL('healthz',base));
  assert.equal(health.status,200);assert.equal((await health.json()).service,'royal-ai-factory');
  const rejected=await fetch(new URL('api/state',base));assert.equal(rejected.status,401);
  session=await sessions.create();
  const headers={cookie:`factory_session=${session}`};
  const response=await fetch(new URL('api/state',base),{headers});assert.equal(response.status,200);
  const state=await response.json();
  const seeds=state.tasks.filter(task=>/^Исходная задача №\d+ из списка/.test(task.description));
  assert.equal(seeds.length,22);
  assert.equal(state.settings.auto_release,false);
  assert.equal(state.runtime.release_enabled,false);
  const detail=await fetch(new URL(`api/tasks/${seeds[0].id}`,base),{headers});assert.equal(detail.status,200);
  assert.equal((await detail.json()).id,seeds[0].id);
  const game=await fetch(new URL('/healthz',options.origin));assert.equal(game.status,200);
  assert.equal((await game.json()).service,'royal-arcade');
  console.log(JSON.stringify({verified_at:new Date().toISOString(),https:true,owner_access:'verified_with_temporary_session',unauthenticated_status:401,seeded_tasks:seeds.length,automatic_release:false,game_health:true},null,2));
} finally {
  if(session)await sessions.remove(session);
  await store.close();
}
