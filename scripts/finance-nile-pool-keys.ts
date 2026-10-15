// Offline only. The server receives public addresses, never these private keys.
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { validateNileDepositPool } from '../server/finance/nile-deposit-pool';

if(process.env.NILE_TEST_MODE!=='testnet-only'||process.env.NILE_TEST_NETWORK!=='nile')throw Error('test_scope_required');
const height=Number(process.argv[2]),target=process.argv[3],prefix=process.argv[4],count=Number(process.argv[5]??16);
if(!Number.isSafeInteger(height)||height<2||!target||!/^\d{8}_[a-f0-9]{6}$/.test(prefix??'')||!Number.isInteger(count)||count<1||count>32)throw Error('invalid_pool_arguments');
const addresses=[];
for(let i=1;i<=count;i++){
  const userId='nile_customer_'+prefix+'_'+i.toString().padStart(3,'0');
  const result=spawnSync(process.execPath,['--import','tsx','scripts/finance-nile-keys.ts',userId],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(result.status!==0)throw Error('offline_pool_key_failed');
  const {address,publicKey}=JSON.parse(result.stdout);addresses.push({userId,address,publicKey});
}
const pool=validateNileDepositPool({version:1,network:'nile',asset:'USDT_NILE_TEST',startHeight:height,addresses},[],2);
const backupKey=readFileSync(join(homedir(),'.config/royal-finance-backup/key'));
if(backupKey.length!==32)throw Error('invalid_backup_key');
const backupDirectory=join(homedir(),'.local/share/royal-nile-test-keys/encrypted-backups');mkdirSync(backupDirectory,{recursive:true,mode:0o700});
if(lstatSync(backupDirectory).isSymbolicLink()||(lstatSync(backupDirectory).mode&0o077)!==0)throw Error('unsafe_key_backup_directory');
const magic=Buffer.from('ROYAL-FINANCE-BACKUP-v1\n');
for(const userId of [...addresses.map(a=>a.userId),'nile_deposit_001','nile_deposit_002']){
  const file=join(homedir(),'.local/share/royal-nile-test-keys',userId+'.nile.json');if(!existsSync(file))continue;
  const info=lstatSync(file);if(info.isSymbolicLink()||(info.mode&0o077)!==0)throw Error('unsafe_key_file');
  const plain=readFileSync(file),sha=createHash('sha256').update(plain).digest('hex'),destination=join(backupDirectory,userId+'.'+sha+'.aes256gcm');
  if(!existsSync(destination)){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',backupKey,iv);cipher.setAAD(magic);
    writeFileSync(destination,Buffer.concat([magic,iv,cipher.update(plain),cipher.final(),cipher.getAuthTag()]),{flag:'wx',mode:0o600});
  }
  const encrypted=readFileSync(destination);if(!encrypted.subarray(0,magic.length).equals(magic))throw Error('invalid_key_backup_header');const decipher=createDecipheriv('aes-256-gcm',backupKey,encrypted.subarray(magic.length,magic.length+12));decipher.setAAD(magic);decipher.setAuthTag(encrypted.subarray(-16));
  if(!Buffer.concat([decipher.update(encrypted.subarray(magic.length+12,-16)),decipher.final()]).equals(plain))throw Error('key_backup_verification_failed');
}
writeFileSync(target,JSON.stringify(pool)+'\n',{flag:'wx',mode:0o600});chmodSync(target,0o600);
console.log(JSON.stringify({ok:true,network:'nile',testOnly:true,capacity:count,poolSha256:createHash('sha256').update(JSON.stringify(pool)).digest('hex'),privateKeysExported:false,keyBackupsVerified:true}));
