import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {isBuiltin} from 'node:module';
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
export async function readHostProjection(root,name,{strictOrigins=false}={}){
 const file=await regularPath(root,name),raw=await readFile(file),metadata=JSON.parse(raw);
 assert.equal(metadata.format,1);assert(metadata.files&&Object.keys(metadata.files).length);assert.match(metadata.productionCommit,/^[a-f0-9]{40}$/);
 const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,maxBuffer:32*1024**2,stdio:['ignore','pipe','ignore']});
 const committed=git('show','HEAD:'+name);assert.equal(digest(canonical(raw)),digest(committed),'Projection configuration is not the committed source');
 const cache=new Map(),commits=new Set(),inputs={},origins={};
 function read(input){
  safe(input);const row=metadata.files[input];assert(row,'Unreviewed projected host input: '+input);
  if(!cache.has(input)){
   assert.match(row.commit,/^[a-f0-9]{40}$/);safe(row.path);
   if(!commits.has(row.commit)){git('merge-base','--is-ancestor',row.commit,'HEAD');commits.add(row.commit);}
   if(strictOrigins){
    assert(!row.path.split('/').some(p=>p.startsWith('.env')||['.git','node_modules','data','secrets','.ssh'].includes(p)),'Unsafe projection origin');
    const entry=git('ls-tree','-z',row.commit,'--',row.path).toString().split('\0').filter(Boolean);
    assert.equal(entry.length,1,'Projection origin is not a regular Git file');
    const match=entry[0].match(/^(100644|100755) blob [a-f0-9]{40}\t(.+)$/s);
    assert(match&&match[2]===row.path,'Projection origin is not a regular Git file');
   }
   const bytes=projectHostSource(row,git('show',row.commit+':'+row.path));cache.set(input,bytes);inputs[input]=digest(bytes);origins[input]=row;
  }
  return cache.get(input);
 }
 return{read,metadata,inputs,origins,config:name,sha256:digest(canonical(raw))};
}

const backendEntry='server/index.ts',backendOutput='dist-server/index.js';
const backendSource=file=>file==='package.json'||file==='tsconfig.json'||/^(?:server|src|scripts)\/.+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/.test(file);
const loader=file=>/\.(?:ts|mts|cts)$/.test(file)?'ts':file.endsWith('.tsx')?'tsx':file.endsWith('.json')?'json':file.endsWith('.jsx')?'jsx':'js';
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
function backendGraphSha(report){
 return digest(JSON.stringify(sorted({config:report.config,configSha256:report.sha256,productionCommit:report.productionCommit,
  entries:report.entries,inputs:report.inputs,origins:report.origins})));
}
const backendHeader=(configSha,graphSha)=>Buffer.from('// royal-backend-projection '+JSON.stringify({configSha256:configSha,graphSha256:graphSha})+'\n');

/** Build only the main backend from reviewed Git inputs, preserving other server outputs. */
export async function buildProjectedBackend(root,name){
 const reader=await readHostProjection(root,name,{strictOrigins:true});
 assert.deepEqual(reader.metadata.entries,[backendEntry],'Only the main backend entry may be projected');
 const tsconfig=JSON.parse(reader.read('tsconfig.json'));
 assert(!tsconfig.extends&&!tsconfig.references,'Indirect backend compiler configuration is not supported');
 await regularPath(root,'tsconfig.json');
 const checkedPackages=new Set();
 async function packageScope(folder){
  if(checkedPackages.has(folder))return;
  checkedPackages.add(folder);
  const file=(folder?folder+'/':'')+'package.json';
  let present=false;
  try{await regularPath(root,file);present=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!present){assert(!reader.metadata.files[file],'Reviewed package configuration is missing: '+file);return;}
  const actual=JSON.parse(await readFile(resolve(root,file),'utf8')),projected=JSON.parse(reader.read(file));
  // Test commands may differ, while every field used by resolution or dependencies must agree.
  for(const key of ['name','type','main','module','exports','imports','browser','sideEffects','dependencies','devDependencies','optionalDependencies','peerDependencies','overrides','engines']){
   assert.deepEqual(actual[key],projected[key],'Backend package configuration differs: '+file+':'+key);
  }
 }
 await packageScope('');
 const rootPackage=JSON.parse(reader.read('package.json'));
 const externalPackages=new Set(['dependencies','optionalDependencies','peerDependencies'].flatMap(key=>Object.keys(rootPackage[key]??{})));
 async function checkedInput(file){
  safe(file);assert(backendSource(file),'Unreviewed backend input kind: '+file);
  await regularPath(root,file);
  let folder=dirname(file);
  while(folder!=='.'){await packageScope(folder);folder=dirname(folder);}
  return reader.read(file);
 }
 const {build}=await import('esbuild');
 const plugin={name:'reviewed-production-backend',setup(builder){
  builder.onResolve({filter:/.*/},async args=>{
   if(args.pluginData?.reviewedBackendResolution)return;
   if(args.kind==='entry-point'){
    assert.equal(relative(root,resolve(args.resolveDir,args.path)).replaceAll('\\','/'),backendEntry,'Unexpected projected backend entry');
    await checkedInput(backendEntry);return{path:resolve(root,backendEntry)};
   }
   if(!args.path.startsWith('.')&&!args.path.startsWith('/')){
    const packageName=args.path.startsWith('@')?args.path.split('/').slice(0,2).join('/'):args.path.split('/')[0];
    assert(isBuiltin(args.path)||externalPackages.has(packageName),'Unreviewed backend external import: '+args.path);return;
   }
   const lexical=relative(root,resolve(args.resolveDir,args.path)).replaceAll('\\','/');safe(lexical);
   // Check before esbuild canonicalizes paths, so a symlink cannot disguise its origin.
   const substituted=/\.(?:js|jsx|mjs|cjs)$/.test(lexical)?['.ts','.tsx','.mts','.cts'].map(suffix=>lexical.replace(/\.[^.\/]+$/,suffix)):[];
   for(const candidate of [lexical,...substituted,...['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs','.json'].map(suffix=>lexical+suffix),...['index.ts','index.tsx','index.js','index.json'].map(suffix=>lexical+'/'+suffix)]){
    try{await regularPath(root,candidate);}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
   }
   const result=await builder.resolve(args.path,{resolveDir:args.resolveDir,importer:args.importer,kind:args.kind,pluginData:{reviewedBackendResolution:true}});
   if(result.errors.length)return{errors:result.errors};
   assert(!result.external,'A projected backend source cannot become external');
   await checkedInput(relative(root,result.path).replaceAll('\\','/'));
   return{path:result.path,namespace:result.namespace,suffix:result.suffix,sideEffects:result.sideEffects,warnings:result.warnings};
  });
  builder.onLoad({filter:/.*/,namespace:'file'},async args=>{
   const file=relative(root,args.path).replaceAll('\\','/');
   return{contents:await checkedInput(file),loader:loader(file),resolveDir:dirname(args.path)};
  });
 }};
 const result=await build({absWorkingDir:root,entryPoints:[backendEntry],bundle:true,platform:'node',packages:'external',format:'esm',
  outfile:backendOutput,write:false,metafile:true,tsconfigRaw:tsconfig,plugins:[plugin],logLevel:'silent'});
 assert.equal(result.outputFiles.length,1,'Unexpected projected backend outputs');
 assert.equal(relative(root,result.outputFiles[0].path).replaceAll('\\','/'),backendOutput,'Unexpected projected backend output');
 for(const file of Object.keys(result.metafile.inputs))assert(Object.hasOwn(reader.inputs,file),'Backend input evidence missing: '+file);
 try{await regularPath(root,'dist-server');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(resolve(root,'dist-server'),{recursive:true});
 try{await regularPath(root,backendOutput);}catch(error){if(error.code!=='ENOENT')throw error;}
 const report={config:name,sha256:reader.sha256,productionCommit:reader.metadata.productionCommit,entries:[backendEntry],
  inputs:reader.inputs,origins:reader.origins};
 report.graphSha256=backendGraphSha(report);
 const bytes=Buffer.concat([backendHeader(report.sha256,report.graphSha256),result.outputFiles[0].contents]);
 await writeFile(resolve(root,backendOutput),bytes);
 return{...report,output:{path:backendOutput,sha256:digest(bytes)}};
}

export async function verifyBackendProjection(root,report){
 const reader=await readHostProjection(root,report.config,{strictOrigins:true});
 assert.equal(reader.sha256,report.sha256,'Backend projection configuration changed');
 assert.equal(reader.metadata.productionCommit,report.productionCommit,'Backend projection baseline changed');
 assert.deepEqual(reader.metadata.entries,[backendEntry]);assert.deepEqual(report.entries,[backendEntry]);
 assert.deepEqual(Object.keys(report.inputs).sort(),Object.keys(report.origins).sort(),'Backend projection origin evidence differs');
 for(const file of ['package.json','tsconfig.json',backendEntry])assert(Object.hasOwn(report.inputs,file),'Required backend projection input missing: '+file);
 for(const [file,hash]of Object.entries(report.inputs)){
  assert(backendSource(file),'Unexpected backend projection input');await regularPath(root,file);
  assert.equal(digest(reader.read(file)),hash,'Backend projection input changed: '+file);assert.deepEqual(reader.origins[file],report.origins[file]);
 }
 assert.equal(backendGraphSha(report),report.graphSha256,'Backend projection graph evidence changed');
 assert.equal(report.output.path,backendOutput,'Unexpected backend projection output');
 const bytes=await readFile(await regularPath(root,backendOutput)),header=backendHeader(reader.sha256,report.graphSha256);
 assert(bytes.subarray(0,header.length).equals(header),'Backend projection output graph binding changed');
 assert.equal(digest(bytes),report.output.sha256,'Backend projection output changed');
 return reader;
}
export async function buildProjectedHost(root,name){
 const reader=await readHostProjection(root,name);
 const plugin={name:'reviewed-production-host',enforce:'pre',
  load(id){if(id.startsWith('\0'))return;const file=relative(root,id.split('?')[0]).replaceAll('\\','/');if(file.startsWith('../')||file.includes('node_modules/')||!/\.(?:ts|js|mjs|cjs|json|css)$/.test(file))return;return reader.read(file).toString();},
  transformIndexHtml:{order:'pre',handler(_html,context){const file=relative(root,context.filename).replaceAll('\\','/');return reader.read(file).toString();}}};
 const {build}=await import('vite');
 assert.deepEqual(reader.metadata.entries,['index.html'],'Only the reviewed hall entry may be projected');
 await build({root,configFile:false,publicDir:false,plugins:[plugin],build:{rollupOptions:{input:resolve(root,'index.html')}}});
 assert(Object.keys(reader.inputs).length>0,'Empty projected host graph');
 return{config:name,sha256:reader.sha256,productionCommit:reader.metadata.productionCommit,inputs:reader.inputs,origins:reader.origins};
}
export async function verifyHostProjection(root,report){
 const reader=await readHostProjection(root,report.config);assert.equal(reader.sha256,report.sha256,'Projection configuration changed');
 assert.equal(reader.metadata.productionCommit,report.productionCommit);assert(Object.keys(report.inputs).length>0);
 for(const [file,hash] of Object.entries(report.inputs)){assert.equal(digest(reader.read(file)),hash,'Projection input changed: '+file);assert.deepEqual(reader.origins[file],report.origins[file]);}
 return reader;
}
