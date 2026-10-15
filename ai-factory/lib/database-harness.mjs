export const DATABASE_HARNESS = `import EmbeddedPostgres from 'embedded-postgres';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';

let directory,postgres,exitCode=1;
try {
  directory=await mkdtemp(join(tmpdir(),'royal-factory-pg-'));
  const reservation=createServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const password=randomBytes(32).toString('hex');
  postgres=new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password,persistent:true,authMethod:'scram-sha-256',
    postgresFlags:['-h','127.0.0.1','-c','unix_socket_directories=','-c','shared_buffers=32MB'],onLog:()=>{},onError:()=>{}});
  await postgres.initialise();await postgres.start();await postgres.createDatabase('royal_test');
  const env={...process.env,NODE_ENV:'test',DATABASE_URL:'',DATABASE_URL_FILE:'',PGHOST:'127.0.0.1',PGPORT:String(port),PGDATABASE:'royal_test',PGUSER:'postgres',PGPASSWORD:password,PGPASSWORD_FILE:'',PGSSLMODE:'disable',CODEX_SALE_API_KEY:''};
  const child=spawn(process.execPath,process.argv.slice(2),{stdio:'inherit',env});
  exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}catch(error){console.error('Temporary test database failed:',error?.code||error?.name||'startup_error');}
finally {
  if(postgres)try{await postgres.stop();}catch{exitCode=1;}
  if(directory)await rm(directory,{recursive:true,force:true});
}
// Embedded Postgres replaces beforeExit status. Preserve the actual check result.
process.exit(exitCode);
`;
