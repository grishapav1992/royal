import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {digest,regularPath} from './module-build-cache.mjs';

const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
function safe(name){assert(typeof name==='string'&&!name.includes('\\')&&!name.startsWith('/')&&!name.split('/').some(p=>!p||p==='.'||p==='..'),'Unsafe projection path');}
export function projectHostSource(row,bytes){
 assert.match(row.commit,/^[a-f0-9]{40}$/);safe(row.path);assert.match(row.sha256,/^[a-f0-9]{64}$/);
 let value=canonical(bytes);assert.equal(digest(value),row.baseSha256,'Projection origin differs');
 for(const patch of row.patches??[]){
  assert(typeof patch.from==='string'&&patch.from&&typeof patch.to==='string');
  const text=value.toString(),parts=text.split(patch.from);assert.equal(parts.length-1,1,'Projection patch must match exactly once');value=Buffer.from(parts.join(patch.to));
 }
 assert.equal(digest(value),row.sha256,'Projected source differs');return value;
}
export async function readHostProjection(root,name){
 const file=await regularPath(root,name),raw=await readFile(file),metadata=JSON.parse(raw);
 assert.equal(metadata.format,1);assert(metadata.files&&Object.keys(metadata.files).length);assert.match(metadata.productionCommit,/^[a-f0-9]{40}$/);
 const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,maxBuffer:32*1024**2,stdio:['ignore','pipe','ignore']});
 const committed=git('show','HEAD:'+name);assert.equal(digest(canonical(raw)),digest(committed),'Projection configuration is not the committed source');
 const cache=new Map(),commits=new Set(),inputs={},origins={};
 function read(input){
  safe(input);const row=metadata.files[input];assert(row,'Unreviewed projected host input: '+input);
  if(!cache.has(input)){
   if(!commits.has(row.commit)){git('merge-base','--is-ancestor',row.commit,'HEAD');commits.add(row.commit);}
   const bytes=projectHostSource(row,git('show',row.commit+':'+row.path));cache.set(input,bytes);inputs[input]=digest(bytes);origins[input]=row;
  }
  return cache.get(input);
 }
 return{read,metadata,inputs,origins,config:name,sha256:digest(raw)};
}
export async function buildProjectedHost(root,name){
 const reader=await readHostProjection(root,name);
 const plugin={name:'reviewed-production-host',enforce:'pre',
  load(id){const file=relative(root,id.split('?')[0]).replaceAll('\\','/');if(file.startsWith('../')||file.includes('node_modules/')||!/\.(?:ts|json|css)$/.test(file))return;return reader.read(file).toString();},
  transformIndexHtml:{order:'pre',handler(_html,context){const file=relative(root,context.filename).replaceAll('\\','/');return reader.read(file).toString();}}};
 const {build}=await import('vite');
 await build({root,configFile:false,plugins:[plugin],build:{rollupOptions:{input:{main:resolve(root,'index.html'),admin:resolve(root,'admin.html')}}}});
 assert(Object.keys(reader.inputs).length>0,'Empty projected host graph');
 return{config:name,sha256:reader.sha256,productionCommit:reader.metadata.productionCommit,inputs:reader.inputs,origins:reader.origins};
}
export async function verifyHostProjection(root,report){
 const reader=await readHostProjection(root,report.config);assert.equal(reader.sha256,report.sha256,'Projection configuration changed');
 assert.equal(reader.metadata.productionCommit,report.productionCommit);assert(Object.keys(report.inputs).length>0);
 for(const [file,hash] of Object.entries(report.inputs)){assert.equal(digest(reader.read(file)),hash,'Projection input changed: '+file);assert.deepEqual(reader.origins[file],report.origins[file]);}
 return reader;
}
