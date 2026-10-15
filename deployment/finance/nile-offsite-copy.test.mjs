import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes } from 'node:crypto';
import { mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureNileOffsiteCopy } from './nile-offsite-copy.mjs';

test('Nile copies require pinned addresses and a complete restore before publication, including every reuse',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nile-offsite-')),key=randomBytes(32),data=randomBytes(4096);
  const config={network:'nile',asset:'USDT_NILE_TEST',scale:6,addresses:[{userId:'alice',address:'pinned'}]};
  const checks={ok:true,network:'nile',asset:'USDT_NILE_TEST',testOnly:true,credits:1,balances:[{userId:'alice',availableUnits:'1'}]};
  const meta={file:'nile-credit-20261006T170000000Z-aaaaaaaa.sqlite',createdAt:new Date().toISOString(),
    sha256:createHash('sha256').update(data).digest('hex'),config,checks};
  const latest={directory:'/opt/royal-nile-test-data/backups',metadata:meta};let downloads=0,restores=0;
  const download=async file=>{downloads++;await writeFile(file,data,{mode:0o600});};
  const verify=async file=>{restores++;assert.deepEqual(await readFile(file),data);return checks;};
  const encrypted=path.join(directory,meta.file+'.aes256gcm');
  try {
    await ensureNileOffsiteCopy(latest,directory,key,config,download,verify);
    const metaFile=path.join(directory,meta.file+'.json');
    const altered=JSON.parse(await readFile(metaFile,'utf8'));altered.config={...config,addresses:[]};altered.checks={ok:false};
    await writeFile(metaFile,JSON.stringify(altered));
    const reused=await ensureNileOffsiteCopy(latest,directory,key,config,download,verify);
    assert.deepEqual(reused.config,config);assert.deepEqual(reused.checks,checks);
    assert.equal(downloads,1);assert.equal(restores,2);
    const corrupt=await readFile(encrypted);corrupt[corrupt.length-1]^=1;await writeFile(encrypted,corrupt);
    await assert.rejects(ensureNileOffsiteCopy(latest,directory,key,config,async()=>{throw new Error('server_unreachable');},verify));
    const repaired=await ensureNileOffsiteCopy(latest,directory,key,config,download,verify);assert.ok(repaired.repaired_at);
    assert.equal(downloads,2);assert.equal(restores,3);
    await assert.rejects(ensureNileOffsiteCopy(latest,directory,key,{...config,addresses:[]},download,verify),/nile_backup_metadata_invalid/);
    await assert.rejects(ensureNileOffsiteCopy({...latest,directory:'/etc'},directory,key,config,download,verify));
    assert.equal((await readdir(directory)).filter(file=>file.includes('.partial')).length,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('a valid cipher with a failed logical restore cannot replace or mark an existing copy verified',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nile-restore-')),key=randomBytes(32),data=randomBytes(1024);
  const config={network:'nile',asset:'USDT_NILE_TEST',scale:6},checks={ok:true,network:'nile',asset:'USDT_NILE_TEST',testOnly:true};
  const latest={directory:'/opt/royal-nile-test-data/backups',metadata:{file:'nile-credit-20261006T170000001Z-bbbbbbbb.sqlite',
    sha256:createHash('sha256').update(data).digest('hex'),createdAt:new Date().toISOString(),config,checks}};
  try {
    const download=async file=>writeFile(file,data);
    await assert.rejects(ensureNileOffsiteCopy(latest,directory,key,config,download,async()=>({...checks,ok:false})),/nile_restored_data_mismatch/);
    assert.equal((await readdir(directory)).length,0);
    await ensureNileOffsiteCopy(latest,directory,key,config,download,async()=>checks);
    const encrypted=await readFile(path.join(directory,latest.metadata.file+'.aes256gcm'));
    await assert.rejects(ensureNileOffsiteCopy(latest,directory,key,config,download,async()=>{throw new Error('corrupt_journal');}));
    assert.deepEqual(await readFile(path.join(directory,latest.metadata.file+'.aes256gcm')),encrypted);
    assert.equal((await readdir(directory)).filter(file=>file.includes('.partial')).length,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});
