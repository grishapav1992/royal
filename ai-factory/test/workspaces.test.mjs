import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { command, cleanEnv, Workspaces } from '../lib/workspaces.mjs';

test('project snapshot excludes credentials, symlinks and generated dependencies',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'factory-source-test-'));
  try{
    const source=join(directory,'source'),target=join(directory,'target');
    await mkdir(join(source,'server'),{recursive:true});await mkdir(target);
    await writeFile(join(source,'package.json'),'{}');
    await writeFile(join(source,'.env'),'PRIVATE_DATA');
    await writeFile(join(source,'server','app.ts'),'export const safe = true');
    await writeFile(join(source,'server','._app.test.ts'),'macOS metadata');
    await writeFile(join(source,'server','private-key.pem'),'PRIVATE_DATA');
    await symlink(join(source,'.env'),join(source,'server','linked.ts'));
    const manager=new Workspaces({source,directory:join(directory,'workspaces')});
    await manager.copySource(target);
    const manifest=JSON.parse(await readFile(join(target,'.factory-source.json'),'utf8'));
    assert.deepEqual(manifest.files.sort(),['package.json','server/app.ts']);
    assert.equal(await readFile(join(target,'server','app.ts'),'utf8'),'export const safe = true');
    assert.equal(Object.hasOwn(cleanEnv(),'OPENAI_API_KEY'),false);
    assert.equal(Object.hasOwn(cleanEnv(),'FACTORY_DATABASE_URL'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('command timeout stops a process that ignores SIGTERM',async()=>{
  const started=Date.now();
  const result=await command(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{timeoutMs:500});
  assert.equal(result.passed,false);assert.equal(result.timed_out,true);
  assert.ok(Date.now()-started<6000);
});

test('cancelled command never starts',async()=>{
  const controller=new AbortController();controller.abort(new Error('cancelled'));
  await assert.rejects(command(process.execPath,['-e','process.exit(0)'],{signal:controller.signal}),/cancelled/);
});

test('command preserves UTF-8 split across output chunks for exported patches',async()=>{
  const result=await command(process.execPath,['-e',"process.stdout.write(Buffer.from([0xd0]));setTimeout(()=>process.stdout.write(Buffer.from([0xaf,0x0a])),40)"]);
  assert.equal(result.passed,true);assert.equal(result.output,'Я\n');
});
