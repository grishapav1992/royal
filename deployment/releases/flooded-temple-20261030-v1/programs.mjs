import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';
import {sourcePlugin} from '../jackie-chan-20261029-v2/projection.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const base='aed09286a21e315cb506b1befc754f5a7b4eecd2';
export const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
export const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','ignore'],maxBuffer:32*1024**2});
const previous=JSON.parse(readFileSync(resolve(root,'deployment/releases/flooded-temple-20261030-v1/production-origins.json')));
const tracked=git('ls-files','-z').toString().split('\0').filter(Boolean),cache=new Map();
const blob=(commit,path)=>{const key=commit+':'+path;if(!cache.has(key))cache.set(key,canonical(git('show',key)));return cache.get(key);};
export const templeInputs=new Set(['server/demoExpansion.ts','server/finance/nile-game-runtime.ts','src/shared/casinoExpansion.ts','src/shared/arcadeCatalog.ts','server/games/floodedTemple.ts','server/games/floodedTempleCascade.ts','src/shared/floodedTemple.ts','src/shared/floodedTempleMath.ts','src/shared/floodedTempleData.json','src/shared/floodedTempleCascade.ts','src/shared/floodedTempleCascadeMath.ts','src/shared/floodedTempleCascadeData.json']);

export function baselineReader(before,kind){
 assert.equal(before.sourceRevision,base);const live=kind==='finance'?before.financeSource:before.source,origins={};
 function read(file){
  const expected=live[file]?.lf;assert(expected,'Unreviewed '+kind+' baseline input: '+file);
  let bytes,row;
  try{const value=canonical(readFileSync(resolve(root,file)));if(sha(value)===expected){bytes=value;row={commit:git('rev-parse','HEAD').toString().trim(),path:file};}}catch{}
  const prior=previous.files[file];
  if(!bytes&&prior){const value=prior.projection?projectHostSource(prior.projection,blob(prior.projection.commit,prior.projection.path)):blob(prior.commit,prior.path);if(sha(value)===expected){bytes=value;row=prior;}}
  if(!bytes)for(const path of tracked.filter(p=>p.endsWith('/source/'+file)||p.endsWith('/finance-source/'+file))){const value=blob('HEAD',path);if(sha(value)===expected){bytes=value;row={commit:git('rev-parse','HEAD').toString().trim(),path};break;}}
  if(!bytes)for(const commit of git('log','origin/main','--format=%H','--',file).toString().trim().split('\n').filter(Boolean)){try{const value=blob(commit,file);if(sha(value)===expected){bytes=value;row={commit,path:file};break;}}catch{}}
  assert(bytes,'No exact Git origin for '+kind+' input: '+file);origins[file]={...row,sha256:expected};return bytes;
 }
 return {read,origins};
}

export async function buildProgram(before,{kind='finance',baseline=false,entries}={}){
 const original=baselineReader(before,kind),inputs={},contents={},testOnly={};
 const read=file=>{
  if(contents[file])return contents[file];let bytes;
  const test=file.startsWith('server-tests/')||file.endsWith('/legacy-finance.test.ts')||file==='scripts/database-test.ts';
  if(test){bytes=canonical(readFileSync(resolve(root,file)));testOnly[file]=sha(bytes);}
  else if(!baseline&&kind==='application')bytes=canonical(readFileSync(resolve(root,file)));
  else if(!baseline&&kind==='finance'&&file==='src/shared/arcadeCatalog.ts'){
   const old=original.read(file).toString();let count=0;
   bytes=Buffer.from(old.split('\n').map(line=>{if(!/^export const ROYAL_PLATFORM_GAMES\b/.test(line))return line;count++;assert(!line.includes('studio-flooded-temple'));const at=line.lastIndexOf(']');assert(at>0);return line.slice(0,at)+", 'studio-flooded-temple'"+line.slice(at);}).join('\n'));assert.equal(count,1);
  }else if(!baseline&&kind==='finance'&&templeInputs.has(file))bytes=canonical(readFileSync(resolve(root,file)));
  else bytes=original.read(file);
  inputs[file]=sha(bytes);contents[file]=bytes;return bytes;
 };
 const plugin=kind==='finance'?sourcePlugin({read}):{name:'temple-reviewed-program',setup(builder){builder.onLoad({filter:/\.(?:ts|json)$/},args=>{const file=relative(root,args.path).replaceAll('\\','/');if(file.startsWith('../')||file.includes('node_modules/'))return;return{contents:read(file).toString(),loader:file.endsWith('.json')?'json':'ts',resolveDir:dirname(args.path)};});}};
 const result=await build({absWorkingDir:root,entryPoints:entries??[kind==='finance'?'scripts/finance-nile-play.ts':'server/index.ts'],bundle:true,platform:'node',...(kind==='finance'?{external:['pg','pg-native']}:{packages:'external'}),format:'esm',write:false,metafile:true,plugins:[plugin]});
 return {...result,inputs,contents,origins:original.origins,testOnly};
}
export async function normalizedProgram(bytes){
 // esbuild's initializer property names retain the original Windows checkout path.
 // Normalize only that diagnostic property key, retaining its complete relative path.
 const code=Buffer.from(bytes).toString('utf8').replace(/("jackie-source:(?:\\.|[^"\\])*")\(\)\s*\{/g,(_match,key)=>{
  const path=JSON.parse(key).replaceAll('\\','/'),at=path.lastIndexOf('/royal/');assert(at>=0);
  const file=path.slice(at+7);assert(!file.startsWith('/')&&!file.split('/').includes('..'));
  return JSON.stringify('royal-source:'+file)+'() {';
 });
 return (await transform(code,{loader:'js',format:'esm',minify:true,legalComments:'none'})).code;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const before=JSON.parse(readFileSync(process.argv[2])),folder=resolve(root,'module-build/temple-production-096');mkdirSync(folder,{recursive:true});
 const report={base,programs:{}};
 for(const kind of ['application','finance']){
  const old=await buildProgram(before,{kind,baseline:true}),next=await buildProgram(before,{kind}),name=kind==='finance'?'play.js':'index.js';
  const live=readFileSync(resolve(root,'artifacts/work/temple-production-096/live-'+name));
  assert.equal(sha(live),kind==='finance'?before.financialProgram['play.js']:before.program['dist-server/index.js']);
  assert.equal(sha(await normalizedProgram(old.outputFiles[0].contents)),sha(await normalizedProgram(live)),'Exact original '+kind+' program could not be reproduced');
  writeFileSync(resolve(folder,name),next.outputFiles[0].contents);
  report.programs[kind]={sha256:sha(next.outputFiles[0].contents),baselineSha256:sha(live),baselineReproducedAfterCanonicalCompilation:true,inputs:next.inputs,origins:next.origins,baselineOrigins:old.origins};
 }
 writeFileSync(resolve(folder,'programs.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({base,applicationInputs:Object.keys(report.programs.application.inputs).length,financialInputs:Object.keys(report.programs.finance.inputs).length,baselineReproduced:true}));
}
