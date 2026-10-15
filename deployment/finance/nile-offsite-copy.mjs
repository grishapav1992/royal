import { randomBytes, createHash } from 'node:crypto';
import { open,readFile,readdir,rename,rm } from 'node:fs/promises';
import path from 'node:path';
import { decryptBackup,encryptBackup } from './offsite-crypto.mjs';

export const nileSnapshotPattern=/^nile-credit-\d{8}T\d{9}Z-[a-f0-9]{8}\.(?:sqlite|pg\.json)$/;
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0)) : item);
async function metadata(file) {try{return JSON.parse(await readFile(file,'utf8'));}catch{return {};}}
async function save(file,value) {
  const temporary=file+'.'+randomBytes(6).toString('hex')+'.partial';
  try {
    const handle=await open(temporary,'wx',0o600);
    try {await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}
    await rename(temporary,file);
  } finally {await rm(temporary,{force:true});}
}
export async function ensureNileOffsiteCopy(latest,directory,key,pinnedConfig,download,verify,pool) {
  const meta=latest.metadata;
  if (latest.directory!=='/opt/royal-nile-test-data/backups'||!meta||!nileSnapshotPattern.test(meta.file)
    ||!/^[a-f0-9]{64}$/.test(meta.sha256)||!Number.isFinite(Date.parse(meta.createdAt))
    ||pinnedConfig?.network!=='nile'||pinnedConfig?.asset!=='USDT_NILE_TEST'||pinnedConfig?.scale!==6
    ||(meta.checks?.poolSha256??null)!==(pool?createHash('sha256').update(JSON.stringify(pool)).digest('hex'):null)
    ||canonical(meta.config)!==canonical(pinnedConfig)||meta.checks?.ok!==true
    ||meta.checks?.network!=='nile'||meta.checks?.asset!=='USDT_NILE_TEST'||meta.checks?.testOnly!==true) throw new Error('nile_backup_metadata_invalid');
  const encrypted=path.join(directory,meta.file+'.aes256gcm'),metaFile=path.join(directory,meta.file+'.json');
  const existing=await metadata(metaFile),temporary=path.join(directory,meta.file+'.'+randomBytes(6).toString('hex')+'.partial');
  const encryptedTemporary=temporary+'.aes256gcm',restored=temporary+'.restore';
  let repair=false;
  const audit=async()=>{
    const checks=await verify(restored,meta.sha256);
    if (canonical(checks)!==canonical(meta.checks)) throw new Error('nile_restored_data_mismatch');
    return checks;
  };
  try {
    if (existing.sha256===meta.sha256&&existing.encrypted_verified===true) {
      try {
        await decryptBackup(encrypted,restored,key,meta.sha256);
        const stored={...existing,...meta,verified_checks:await audit(),verified_at:new Date().toISOString(),
          encrypted_verified:true,encryption:'AES-256-GCM'};
        await save(metaFile,stored);return stored;
      } catch {repair=true;}
      finally {await rm(restored,{force:true});}
    }
    await download(temporary);
    await encryptBackup(temporary,encryptedTemporary,key,meta.sha256);
    await decryptBackup(encryptedTemporary,restored,key,meta.sha256);
    const checks=await audit();
    await rename(encryptedTemporary,encrypted);
    const now=new Date().toISOString();
    const stored={...meta,copied_at:now,verified_at:now,encrypted_verified:true,encryption:'AES-256-GCM',verified_checks:checks,
      ...(repair?{repaired_at:now}:{})};
    await save(metaFile,stored);
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.json')||!nileSnapshotPattern.test(file.slice(0,-5))||file===path.basename(metaFile)) continue;
      const old=await metadata(path.join(directory,file));
      if (old.encrypted_verified===true&&Date.parse(old.copied_at)<Date.now()-30*86400000) {
        await rm(path.join(directory,file.slice(0,-5)+'.aes256gcm'),{force:true});await rm(path.join(directory,file));
      }
    }
    return stored;
  } finally {for (const file of [temporary,encryptedTemporary,restored]) await rm(file,{force:true});}
}
