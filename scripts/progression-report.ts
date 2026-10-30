import { PostgresDatabase } from '../server/database';
import { ProgressionStore } from '../server/progression/store';
const db=new PostgresDatabase(process.env.GAME_DATABASE_SCHEMA??'royal_game',{existingSchema:true});
try{
  const store=new ProgressionStore(db,{readOnly:true});await store.ready;
  console.log(JSON.stringify({audit:await store.audit(),report:await store.report()},null,2));
  if(!(await store.audit()).ok)process.exitCode=1;
}finally{await db.close();}
