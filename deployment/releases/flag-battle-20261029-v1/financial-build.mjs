import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {addFlag} from './source-transform.mjs';
const helper=dirname(fileURLToPath(import.meta.url)),root=resolve(helper,'../../..');
const baseline=JSON.parse(readFileSync(resolve(helper,'financial-baseline.json')));
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root});
const digest=b=>createHash('sha256').update(b).digest('hex');
const canonical=b=>Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n'));
const tree=new Set(git('ls-tree','-r','--name-only',baseline.base).toString().trim().split('\n'));
const changed=new Set(['server/demoExpansion.ts','src/shared/casinoExpansion.ts','server/finance/nile-game-runtime.ts','src/shared/arcadeCatalog.ts']);
const fresh=new Set(['src/shared/flagBattle.ts','server/games/flagBattle.ts','server-tests/finance/flag-battle-native.test.ts']);
const cache=new Map();
function original(file){
 if(cache.has(file))return cache.get(file);
 const origin=file==='src/shared/arcadeCatalog.ts'?baseline.catalog:baseline.files[file]||{commit:baseline.base,path:file};
 const bytes=canonical(git('show',origin.commit+':'+(origin.path||file)));
 if(origin.sha256)assert.equal(digest(bytes),origin.sha256,file);
 const row={bytes,origin:{...origin,path:origin.path||file,sha256:digest(bytes)}};cache.set(file,row);return row;
}
function catalog(text){
 assert(!text.includes('FLAG_GAME'));
 let counts=0;
 const output="import {FLAG_GAME} from './flagBattle';\n"+text.split('\n').map(line=>{
  if(/^export const (ARCADE_HOUSE_GAMES|ROYAL_PLATFORM_GAMES)\b/.test(line)){const at=line.lastIndexOf(']');assert(at>line.indexOf('='));counts++;return line.slice(0,at)+', FLAG_GAME'+line.slice(at);}
  return line;
 }).join('\n');assert.equal(counts,2);return output;
}
/** Read retained Git blobs directly; no second source or dependency tree is created. */
export async function buildFinancial({before,entryPoints=['scripts/finance-nile-play.ts'],...options}){
 const financialInputs={},inputContents={},retainedOrigins={};
 function load(file){
  let bytes,origin;
  if(fresh.has(file)||file.startsWith('server-tests/')&&existsSync(resolve(root,file))){bytes=canonical(readFileSync(resolve(root,file)));origin={currentSource:true};}
  else{
   const old=original(file);bytes=old.bytes;origin=old.origin;
   if(!file.startsWith('server-tests/'))assert(before.financeSource[file]&&[before.financeSource[file].sha256,before.financeSource[file].lf].includes(digest(bytes)),'Retained financial input changed: '+file);
   if(changed.has(file)){bytes=Buffer.from(file==='src/shared/arcadeCatalog.ts'?catalog(bytes.toString()):addFlag(file,bytes.toString()));origin={...origin,flagAddition:true};}
  }
  financialInputs[file]=digest(bytes);inputContents[file]=bytes;retainedOrigins[file]=origin;return bytes;
 }
 const result=await build({absWorkingDir:root,entryPoints,bundle:true,platform:'node',external:['pg','pg-native'],format:'esm',outfile:'dist-server/nile-play.js',write:false,metafile:true,...options,
 plugins:[{name:'reviewed-financial-projection',setup(builder){
  builder.onResolve({filter:/.*/},args=>{
   if(args.kind!=='entry-point'&&args.namespace!=='financial-source')return;
   if(args.kind!=='entry-point'&&!args.path.startsWith('.')&&!args.path.startsWith('/'))return;
   const raw=relative(root,resolve(args.resolveDir||root,args.path)).split('\\').join('/');
   assert(!raw.startsWith('../')&&!raw.split('/').includes('..'),'Financial import escaped its source graph');
   const file=[raw,raw+'.ts',raw+'.json',raw+'/index.ts'].find(p=>tree.has(p)||fresh.has(p)||p.startsWith('server-tests/')&&existsSync(resolve(root,p)));
   assert(file,'Unresolved reviewed financial input: '+raw);return{path:resolve(root,file),namespace:'financial-source'};
  });
  builder.onLoad({filter:/.*/,namespace:'financial-source'},args=>{const file=relative(root,args.path).split('\\').join('/');return{contents:load(file).toString(),loader:file.endsWith('.json')?'json':'ts',resolveDir:dirname(args.path)};});
 }}]});
 return{...result,financialInputs,inputContents,retainedOrigins};
}
