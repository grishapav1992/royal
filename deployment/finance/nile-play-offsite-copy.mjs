import {randomBytes,createHash} from 'node:crypto';
import {mkdir,lstat,open,readFile,rename,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {encryptBackup,decryptBackup} from './offsite-crypto.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const pattern=/^nile-play-\d{8}T\d{9}Z\.(?:sqlite|pg\.json)$/;
async function save(file,value){const partial=file+'.'+randomBytes(6).toString('hex')+'.partial';try{const handle=await open(partial,'wx',0o600);try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}await rename(partial,file);}finally{await rm(partial,{force:true});}}
export async function ensureNilePlayCopy(latest,directory,key,pin,download,verify,pool){
  const meta=latest.metadata;
  if(latest.directory!=='/opt/royal-nile-play-data/backups'||!meta||meta.version!==1||!pattern.test(meta.file)||!/^[a-f0-9]{64}$/.test(meta.sha256)
    ||!Number.isSafeInteger(meta.bytes)||meta.bytes<1||meta.bytes>268435456||!Number.isFinite(Date.parse(meta.createdAt))||Date.parse(meta.createdAt)>Date.now()+30000
    ||(meta.poolSha256??null)!==(pool?sha(JSON.stringify(pool)):null)|| (meta.audit?.poolSha256??null)!==(pool?sha(JSON.stringify(pool)):null)
    ||meta.configSha256!==sha(JSON.stringify(pin))||pin?.source?.network!=='nile'||pin?.source?.asset!=='USDT_NILE_TEST'
    ||meta.audit?.ok!==true||meta.audit?.network!=='nile'||meta.audit?.asset!=='USDT_NILE_TEST'||meta.audit?.testOnly!==true||meta.audit?.withdrawable!==false||meta.audit?.schemaVersion!==1)throw new Error('play_backup_metadata_invalid');
  await mkdir(directory,{recursive:true,mode:0o700});if((await lstat(directory)).isSymbolicLink())throw new Error('unsafe_play_backup_path');
  const target=path.join(directory,meta.file+'.aes256gcm'),temporary=target+'.'+randomBytes(6).toString('hex')+'.partial',plain=temporary+'.sqlite',restored=temporary+'.restore';
  try{
    let exists=false;try{const info=await lstat(target);if(!info.isFile()||info.isSymbolicLink())throw new Error('unsafe_play_backup_path');exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(exists)await decryptBackup(target,restored,key,meta.sha256);
    else{await download(plain);if((await lstat(plain)).size!==meta.bytes)throw new Error('play_backup_size_mismatch');await encryptBackup(plain,temporary,key,meta.sha256);await decryptBackup(temporary,restored,key,meta.sha256);}
    const audit=await verify(restored,meta.sha256);if(canonical(audit)!==canonical(meta.audit))throw new Error('play_restored_data_mismatch');
    if(!exists)await rename(temporary,target);
    const stored={...meta,encrypted_verified:true,encryption:'AES-256-GCM',verified_at:new Date().toISOString()};
    await save(path.join(directory,meta.file+'.json'),stored);await save(path.join(directory,'latest.json'),stored);
    for(const name of await readdir(directory))if(name.endsWith('.json')&&pattern.test(name.slice(0,-5))&&name!==meta.file+'.json'){
      const old=JSON.parse(await readFile(path.join(directory,name),'utf8'));if(old.encrypted_verified===true&&Date.parse(old.createdAt)<Date.now()-30*86400000){await rm(path.join(directory,name.slice(0,-5)+'.aes256gcm'),{force:true});await rm(path.join(directory,name));}
    }
    return stored;
  }finally{for(const file of [temporary,plain,restored])await rm(file,{force:true});}
}
