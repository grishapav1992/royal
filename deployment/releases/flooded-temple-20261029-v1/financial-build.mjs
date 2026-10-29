import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const helper=dirname(fileURLToPath(import.meta.url)),root=resolve(helper,'../../..');
export const productionBase='b921d0537fed52336aaee5d97144bf36a9188107';
const previous='deployment/releases/caribbean-treasures-20261029-v2';
const registry=JSON.parse(readFileSync(resolve(root,previous,'financial-baseline.json'),'utf8'));
const retainedFiles={...registry.files,...JSON.parse(readFileSync(resolve(helper,'additional-financial-origins.json'),'utf8')).files};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root});
const allowed=new Set([
 'server/demoExpansion.ts','server/finance/nile-game-runtime.ts','src/shared/casinoExpansion.ts','src/shared/arcadeCatalog.ts',
 'server/games/floodedTemple.ts','server/games/floodedTempleCascade.ts',
 'src/shared/floodedTemple.ts','src/shared/floodedTempleMath.ts','src/shared/floodedTempleData.json',
 'src/shared/floodedTempleCascade.ts','src/shared/floodedTempleCascadeMath.ts','src/shared/floodedTempleCascadeData.json',
]);

/** Keep the published Nile inputs and add the Temple graph without copying a source tree. */
export async function buildFinancial({before,entryPoints=['scripts/finance-nile-play.ts'],includeTemple=true}){
 assert.equal(before.sourceRevision,productionBase,'Production base changed; review a new release');
 const retained=new Map(),used=new Set(),inputs={},origins={};
 for(const[file,row]of Object.entries(retainedFiles)){
  assert(!allowed.has(file));git('merge-base','--is-ancestor',row.commit,productionBase);
  const bytes=git('show',row.commit+':'+file);assert.equal(hash(bytes),row.sha256,file);
  assert([before.financeSource[file]?.sha256,before.financeSource[file]?.lf].includes(row.sha256),file);
  retained.set(file,bytes);
 }
 const oldCatalog=canonical(git('show',productionBase+':'+previous+'/financial-arcadeCatalog.ts'));
 assert([before.financeSource['src/shared/arcadeCatalog.ts']?.sha256,before.financeSource['src/shared/arcadeCatalog.ts']?.lf].includes(hash(oldCatalog)),'Published financial catalogue changed');
 const platform='export const ROYAL_PLATFORM_GAMES: readonly string[] = [...STUDIO_GAMES, ...ARCADE_CLASSIC_GAMES, FOREST_HEART_GAME, FLAG_GAME, CARIBBEAN_GAME];';
 assert.equal(oldCatalog.toString().split(platform).length,2,'Unexpected catalogue declaration');
 const projected=canonical(readFileSync(resolve(helper,'financial-arcadeCatalog.ts')));
 assert.equal(projected.toString(),oldCatalog.toString().replace(platform,platform.replace('CARIBBEAN_GAME]','CARIBBEAN_GAME, \'studio-flooded-temple\']')),'Projection must only append Temple');
 const result=await build({absWorkingDir:root,entryPoints,bundle:true,platform:'node',external:['pg','pg-native'],format:'esm',outfile:'module-build/temple-release/nile-play.js',write:false,metafile:true,
  plugins:[{name:'reviewed-temple-financial-inputs',setup(builder){
   builder.onLoad({filter:/\.(ts|json)$/},args=>{
    const file=relative(root,args.path).split('\\').join('/');if(file.startsWith('../')||file.includes('node_modules/'))return;
    const original=!includeTemple&&allowed.has(file)&&file!=='src/shared/arcadeCatalog.ts'?git('show',productionBase+':'+file):undefined;
    const bytes=canonical(file==='src/shared/arcadeCatalog.ts'?(includeTemple?projected:oldCatalog):original??retained.get(file)??readFileSync(args.path)),digest=hash(bytes);inputs[file]=digest;
    if(!includeTemple)assert(file.startsWith('server-tests/')||[before.financeSource[file]?.sha256,before.financeSource[file]?.lf].includes(digest),'Baseline financial input differs: '+file);
    if(retained.has(file)){origins[file]=retainedFiles[file];used.add(file);}
    else if(file==='src/shared/arcadeCatalog.ts')origins[file]={commit:productionBase,path:previous+'/financial-arcadeCatalog.ts',oldSha256:hash(oldCatalog),projectedSource:'deployment/releases/flooded-temple-20261029-v1/financial-arcadeCatalog.ts',sha256:digest};
    else if(!allowed.has(file)&&!file.startsWith('server-tests/')&&!(entryPoints.includes(file)&&file==='deployment/releases/flooded-temple-20261029-v1/legacy-finance.test.ts'))assert([before.financeSource[file]?.sha256,before.financeSource[file]?.lf].includes(digest),'Unreviewed financial input: '+file);
    return{contents:bytes.toString('utf8'),loader:file.endsWith('.json')?'json':'ts',resolveDir:dirname(args.path)};
   });
  }}],
 });
 if(entryPoints.length===1&&entryPoints[0]==='scripts/finance-nile-play.ts')assert.deepEqual([...used].sort(),Object.keys(retainedFiles).sort());
 return{...result,financialInputs:inputs,retainedOrigins:origins};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 assert.equal(process.argv.length,3,'Specify the read-only production snapshot');
 const before=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')),result=await buildFinancial({before});
 const folder=resolve(root,'module-build/temple-release');mkdirSync(folder,{recursive:true});writeFileSync(resolve(folder,'nile-play.js'),result.outputFiles[0].contents);
 const report={format:1,baseCommit:productionBase,programSha256:hash(result.outputFiles[0].contents),financialInputs:result.financialInputs,retainedOrigins:result.retainedOrigins};
 writeFileSync(resolve(folder,'financial-inputs.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({inputs:Object.keys(report.financialInputs).length,retained:Object.keys(report.retainedOrigins).length,programSha256:report.programSha256}));
}
