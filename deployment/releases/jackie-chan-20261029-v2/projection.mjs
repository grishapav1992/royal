import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const folder=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(folder,'../../..');
const meta=JSON.parse(fs.readFileSync(path.join(folder,'projection-origins.json'))),financial=JSON.parse(fs.readFileSync(path.join(folder,'financial-origins.json')));
const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
export const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(...a)=>cp.execFileSync(process.env.ROYAL_GIT_BINARY||'git',a,{cwd:root,stdio:['ignore','pipe','ignore']});
const blobs=new Map();
function blob(commit,file){const key=commit+':'+file;if(!blobs.has(key))blobs.set(key,canonical(git('show',key)));return blobs.get(key);}
const overrides=new Map(meta.rows.map(row=>[row.file,row])),financeOverrides=new Map(meta.financialOverrides.map(row=>[row.file,row]));
const fresh=new Set(meta.rows.filter(row=>row.new).map(row=>row.file));
export function projectedReader(before,kind='application'){
 const inputs={},contents={},origins={};
 function read(file){
  if(contents[file])return contents[file];
  let bytes,origin;
  const override=(kind==='finance'&&financeOverrides.get(file))||overrides.get(file),live=(kind==='finance'?before.financeSource:before.source)[file];
  if(override){
   if(!override.new)assert.equal(live?.lf,override.liveSha256,'Projection baseline changed: '+file);
   bytes=canonical(fs.readFileSync(path.resolve(root,override.source)));assert.equal(digest(bytes),override.sha256,'Projection changed: '+file);
   origin={source:override.source,liveSha256:override.liveSha256??null};
  }else if(file.startsWith('server-tests/')||file.startsWith('tests/fixtures/')||file==='scripts/database-test.ts'){
   if(file.startsWith('server-tests/')&&!file.includes('jackie')){bytes=blob(meta.production,file);origin={testOnly:true,commit:meta.production};}
   else if(file.includes('jackie')){bytes=blob(meta.testCommit,file);origin={testOnly:true,commit:meta.testCommit};}
   else{bytes=canonical(fs.readFileSync(path.resolve(root,file)));origin={testOnly:true};}
  }
  else if(kind==='finance'){
   const row=financial.files[file];assert(row,'Unreviewed finance input: '+file);
   bytes=blob(row.commit,row.path);if(row.flagAddition)bytes=Buffer.from("import {FLAG_GAME} from './flagBattle';\n"+bytes.toString().split('\n').map(line=>{if(/^export const (ARCADE_HOUSE_GAMES|ROYAL_PLATFORM_GAMES)\b/.test(line)){const i=line.lastIndexOf(']');return line.slice(0,i)+', FLAG_GAME'+line.slice(i);}return line;}).join('\n'));
   assert.equal(digest(bytes),row.sha256,file);assert.equal(live?.lf,row.sha256,'Finance input changed: '+file);origin=row;
  }else{
   assert(live,'Unreviewed application input: '+file);
   for(const commit of [meta.production,meta.previousProduction]){try{const candidate=blob(commit,file);if(digest(candidate)===live.lf){bytes=candidate;origin={commit,path:file};break;}}catch{}}
   assert(bytes,'Application baseline changed: '+file);
  }
  inputs[file]=digest(bytes);contents[file]=bytes;origins[file]=origin;return bytes;
 }
 return{read,inputs,contents,origins};
}
export function sourcePlugin(reader){
 return{name:'jackie-reviewed-source',setup(builder){
  builder.onResolve({filter:/.*/},args=>{
   if(args.kind!=='entry-point'&&args.namespace!=='jackie-source')return;
   if(args.kind!=='entry-point'&&!args.path.startsWith('.')&&!args.path.startsWith('/'))return;
   const raw=path.relative(root,path.resolve(args.resolveDir||root,args.path)).split('\\').join('/');assert(!raw.startsWith('../'));
   const file=[raw,raw+'.ts',raw+'.json',raw+'/index.ts'].find(file=>fresh.has(file)||overrides.has(file)||financial.files[file]||fs.existsSync(path.resolve(root,file))&&fs.statSync(path.resolve(root,file)).isFile());
   assert(file,'Unresolved projected input: '+raw);return{path:path.resolve(root,file),namespace:'jackie-source'};
  });
  builder.onLoad({filter:/.*/,namespace:'jackie-source'},args=>{const file=path.relative(root,args.path).split('\\').join('/');return{contents:reader.read(file).toString(),loader:file.endsWith('.json')?'json':'ts',resolveDir:path.dirname(args.path)};});
 }};
}
export async function buildProgram(before,kind='application',entryPoints){
 const reader=projectedReader(before,kind),result=await build({absWorkingDir:root,entryPoints:entryPoints??[kind==='finance'?'scripts/finance-nile-play.ts':'server/index.ts'],bundle:true,platform:'node',...(kind==='finance'?{external:['pg','pg-native']}:{packages:'external'}),format:'esm',write:false,metafile:true,plugins:[sourcePlugin(reader)]});
 const dependencyInputs={};for(const file of Object.keys(result.metafile.inputs))if(file.includes('node_modules/'))dependencyInputs[file]=digest(fs.readFileSync(path.resolve(root,file)));
 return{...result,inputs:reader.inputs,contents:reader.contents,origins:reader.origins,dependencyInputs};
}
export function viteProjection(before){
 const reader=projectedReader(before);
 return{name:'jackie-reviewed-host',enforce:'pre',load(id){const name=id.split('?')[0],file=path.relative(root,name).split('\\').join('/');if(file.startsWith('../')||file.includes('node_modules/')||!/\.(?:ts|json|css)$/.test(file))return;return reader.read(file).toString();},reader};
}

