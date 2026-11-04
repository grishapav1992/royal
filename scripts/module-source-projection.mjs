import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build,version as esbuildVersion} from 'esbuild';
import {readHostProjection} from './build-host-projection.mjs';
import {digest,regularPath,dependencyPath} from './module-build-cache.mjs';

const keys=['apiVersion','rulesVersion','progressVersion'];
const same=(a,b)=>assert.deepEqual(a,b);
export function moduleSourceSha256({config,contract,esbuildVersion,builderSha256,sourceFiles,media,compilation}){
 assert(compilation?.format===1&&typeof compilation.projected==='boolean'&&/^[a-f0-9]{64}$/.test(compilation.helperSha256),'Missing compiler identity');
 for(const[name,hash]of Object.entries(compilation.configurations))same(sourceFiles[name],hash);
 return digest(JSON.stringify({config,contract,esbuildVersion,script:builderSha256,sourceFiles,media,compilation}));
}
/** Match reviewed production text bytes across Windows checkouts; never relax the digest. */
export function projectedMediaBytes(name,bytes,expected){
 if(digest(bytes)!==expected&&/\.(svg|json)$/.test(name))bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
 assert.equal(digest(bytes),expected,'Unreviewed projected module media: '+name);
 return bytes;
}
/** Installed dependency code has explicit byte hashes, separate from Git sources. */
export function projectedDependencyBytes(name,bytes,expected){
 assert(/^node_modules\/(?:@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+\/.+\.(?:js|mjs|cjs|json)$/.test(name)&&!name.split('/').some(part=>part==='.'||part==='..')&&!name.includes('\\'),'Unsafe projected dependency');
 assert.equal(digest(bytes),expected,'Unreviewed projected module dependency: '+name);
 return bytes;
}
export function projectedModuleContract(current,projected,contracts){
 assert(current&&projected&&current.slug===projected.slug&&current.gameId===projected.gameId,'Projected module identity differs');
 if(keys.every(key=>current[key]===projected[key]))return projected;
 const target=contracts?.[current.gameId];
 assert(target&&Object.keys(target).sort().join(',')===keys.slice().sort().join(','),'Explicit production module contract required');
 assert(current.apiVersion===projected.apiVersion&&current.rulesVersion===projected.rulesVersion,'Projected module rules differ');
 assert(Number.isInteger(projected.progressVersion)&&projected.progressVersion>0&&projected.progressVersion<=current.progressVersion,'Invalid compatible progress version');
 same(Object.fromEntries(keys.map(key=>[key,projected[key]])),target);
 return projected;
}
export async function moduleProjectionCatalog(reader){
 const code=await build({stdin:{contents:reader.read('src/modules/GameModuleCatalog.ts').toString('utf8'),loader:'ts'},bundle:true,write:false,metafile:true,format:'esm',platform:'node',logLevel:'silent'});
 assert(Object.keys(code.metafile.inputs).every(n=>n==='<stdin>'),'Projected module catalogue imports code');
 return (await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].contents).toString('base64'))).GAME_MODULES;
}
export async function verifyModuleProjection(root,report,slugs){
 const reader=await readHostProjection(root,report.config,{strictOrigins:true});
 same(report.sha256,reader.sha256);same(report.productionCommit,reader.metadata.productionCommit);
 same([...slugs].sort(),[...reader.metadata.moduleGames].sort());
 const catalog=await moduleProjectionCatalog(reader),builder=digest(await readFile(await regularPath(root,'scripts/build-game-module.mjs')));
 same(report.builderSha256,builder);
 reader.preload(Object.keys(report.inputs));
 for(const [name,hash]of Object.entries(report.inputs)){same(digest(reader.read(name)),hash);same(reader.origins[name],report.origins[name]);}
 for(const [name,hash]of Object.entries(report.assets)){same(digest(await readFile(await regularPath(root,name))),hash);same(reader.metadata.moduleAssets[name],hash);}
 for(const [name,hash]of Object.entries(report.dependencies??{}))projectedDependencyBytes(name,await readFile(await dependencyPath(root,name)),reader.metadata.moduleDependencies?.[name]===hash?hash:undefined);
 const expected={};
 for(const slug of slugs){
  const config=JSON.parse(reader.read(`games/${slug}/package.json`)),contract=catalog.find(game=>game.slug===slug),game=config.gameId;
  for(const key of ['gameId',...keys])same(config[key],contract[key]);
  const proof=JSON.parse(await readFile(await regularPath(root,`module-build/${slug}-proof.json`),'utf8'));
  const row=report.modules[game];assert(row,'Missing projected module proof');same(proof.sourceFiles,row.sourceFiles);
  for(const [name,hash]of Object.entries(row.sourceFiles))same(hash,name.startsWith('node_modules/')?report.dependencies?.[name]:report.inputs[name]);
  const pointer=JSON.parse(await readFile(await regularPath(root,`module-dist/${game}/active.json`),'utf8'));
  same(row.manifestPath,pointer.manifest.replace('/game-modules/','module-dist/'));
  const bytes=await readFile(await regularPath(root,row.manifestPath)),manifest=JSON.parse(bytes);
  same(row.manifestSha256,digest(bytes));same(pointer.sha256,digest(bytes));same(row.files,manifest.files);same(row.version,manifest.version);
  const media=Object.fromEntries(Object.entries(manifest.files).filter(([name])=>name.startsWith('media/')));
  const configurations=Object.fromEntries(['tsconfig.json',`games/${slug}/tsconfig.json`].map(name=>[name,digest(reader.read(name))]));
  const compilation={format:1,projected:true,configurations,helperSha256:digest(await readFile(await regularPath(root,'scripts/module-source-projection.mjs')))};same(proof.compilation,compilation);
  const sourceSha=moduleSourceSha256({config,contract,esbuildVersion,builderSha256:builder,sourceFiles:row.sourceFiles,media,compilation});
  same(manifest.sourceSha256,sourceSha);same(proof.sourceSha256,sourceSha);same(manifest.version,config.version+'-'+sourceSha.slice(0,12));
  expected[game]=row;
 }
 same(Object.keys(report.modules).sort(),Object.keys(expected).sort());
 return reader;
}
