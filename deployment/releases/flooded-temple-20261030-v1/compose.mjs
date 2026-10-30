import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

// Reconcile this checkout with the verified running source, without a source-tree copy.
const base='aed09286a21e315cb506b1befc754f5a7b4eecd2';
const snapshot=JSON.parse(readFileSync(process.argv[2]));assert.equal(snapshot.sourceRevision,base);
const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{stdio:['ignore','pipe','ignore'],maxBuffer:32*1024**2});
const commit=git('rev-parse','HEAD').toString().trim(),tracked=git('ls-files','-z').toString().split('\0').filter(Boolean);
const prior=JSON.parse(readFileSync('deployment/releases/forest-heart-responsive-20261030-v1/host-projection.json'));
const rows={},contents=new Map();
for(const file of JSON.parse(readFileSync('artifacts/work/temple-production-096/restore-paths.json'))){
 assert(/^(src\/|server\/|games\/(?:girlhub|jackie-chan)\/)/.test(file));
 const expected=snapshot.source[file].lf;let value,row;
 const projected=prior.files[file];
 if(projected){const bytes=projectHostSource(projected,git('show',projected.commit+':'+projected.path));if(sha(bytes)===expected){value=bytes;row={projection:projected};}}
 if(!value)for(const path of [file,...tracked.filter(p=>p.endsWith('/source/'+file)||p.endsWith('/finance-source/'+file))]){
  try{const bytes=canonical(git('show',commit+':'+path));if(sha(bytes)===expected){value=bytes;row={commit,path};break;}}catch{}
 }
 if(!value)for(const revision of git('log','origin/main','--format=%H','--',file).toString().trim().split('\n').filter(Boolean)){
  try{const bytes=canonical(git('show',revision+':'+file));if(sha(bytes)===expected){value=bytes;row={commit:revision,path:file};break;}}catch{}
 }
 assert(value,'No verified Git origin for '+file);rows[file]={...row,sha256:expected};contents.set(file,value);
}
writeFileSync('deployment/releases/flooded-temple-20261030-v1/production-origins.json',JSON.stringify({format:1,base,developmentCommit:commit,files:rows},null,2)+'\n');
if(process.argv[3]==='--apply')for(const[file,bytes]of contents)writeFileSync(file,bytes);
console.log(JSON.stringify({base,files:contents.size,applied:process.argv[3]==='--apply'}));
