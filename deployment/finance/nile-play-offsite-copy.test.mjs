import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureNilePlayCopy} from './nile-play-offsite-copy.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('play copies authenticate new and reused ciphertext, verify restored contents and reject a changed pin',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'play-copy-')),key=randomBytes(32),pin={version:1,source:{network:'nile',asset:'USDT_NILE_TEST'}};
  const bytes=Buffer.from('isolated test journal'),audit={ok:true,network:'nile',asset:'USDT_NILE_TEST',testOnly:true,withdrawable:false,schemaVersion:1,totalUnits:'1000000000'};
  const metadata={version:1,file:'nile-play-20261006T190000000Z.sqlite',createdAt:new Date().toISOString(),bytes:bytes.length,sha256:sha(bytes),configSha256:sha(JSON.stringify(pin)),audit};
  const latest={directory:'/opt/royal-nile-play-data/backups',metadata};let downloads=0,restores=0;
  const download=async file=>{downloads++;await writeFile(file,bytes);},verify=async file=>{restores++;assert.deepEqual(await readFile(file),bytes);return audit;};
  try{
    assert.equal((await ensureNilePlayCopy(latest,dir,key,pin,download,verify)).encrypted_verified,true);
    await ensureNilePlayCopy(latest,dir,key,pin,download,verify);assert.equal(downloads,1);assert.equal(restores,2);
    await assert.rejects(ensureNilePlayCopy(latest,dir,key,{...pin,version:2},download,verify),/play_backup_metadata_invalid/);
    await assert.rejects(ensureNilePlayCopy({...latest,metadata:{...metadata,file:'../secret.sqlite'}},dir,key,pin,download,verify));
    await assert.rejects(ensureNilePlayCopy(latest,dir,key,pin,download,async()=>({...audit,totalUnits:'1'})),/play_restored_data_mismatch/);
    const encrypted=join(dir,metadata.file+'.aes256gcm'),data=await readFile(encrypted);data[data.length-1]^=1;await writeFile(encrypted,data);
    await assert.rejects(ensureNilePlayCopy(latest,dir,key,pin,download,verify));assert.equal(downloads,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
