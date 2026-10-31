import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build,version as esbuildVersion} from 'esbuild';
import {readHostProjection} from './build-host-projection.mjs';
import {digest,regularPath} from './module-build-cache.mjs';

const keys=['apiVersion','rulesVersion','progressVersion'];
const same=(a,b)=>assert.deepEqual(a,b);
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
/** Read reviewed JSON media from Git without replacing concurrent working files. */
export async function projectedModuleAsset(root,name,reader){
 const file=await regularPath(root,name);
 const fromGit=reader.metadata.moduleAssetSources?.includes(name);
 if(fromGit)assert(/^public\/.+\.json$/.test(name)&&reader.metadata.files[name],'Only explicitly reviewed JSON media may be projected');
 const bytes=fromGit?reader.read(name):await readFile(file);
 same(digest(bytes),reader.metadata.moduleAssets?.[name]);return bytes;
}
export async function verifyModuleProjection(root,report,slugs){
 const reader=await readHostProjection(root,report.config,{strictOrigins:true});
 same(report.sha256,reader.sha256);same(report.productionCommit,reader.metadata.productionCommit);
 same([...slugs].sort(),[...reader.metadata.moduleGames].sort());
 const catalog=await moduleProjectionCatalog(reader),builder=digest(await readFile(await regularPath(root,'scripts/build-game-module.mjs')));
 same(report.builderSha256,builder);
 for(const [name,hash]of Object.entries(report.inputs)){same(digest(reader.read(name)),hash);same(reader.origins[name],report.origins[name]);}
 for(const [name,hash]of Object.entries(report.assets)){same(digest(await projectedModuleAsset(root,name,reader)),hash);same(reader.metadata.moduleAssets[name],hash);}
 const expected={};
 for(const slug of slugs){
  const config=JSON.parse(reader.read(`games/${slug}/package.json`)),contract=catalog.find(game=>game.slug===slug),game=config.gameId;
  for(const key of ['gameId',...keys])same(config[key],contract[key]);
  const proof=JSON.parse(await readFile(await regularPath(root,`module-build/${slug}-proof.json`),'utf8'));
  const row=report.modules[game];assert(row,'Missing projected module proof');same(proof.sourceFiles,row.sourceFiles);
  for(const [name,hash]of Object.entries(row.sourceFiles))same(hash,report.inputs[name]);
  const pointer=JSON.parse(await readFile(await regularPath(root,`module-dist/${game}/active.json`),'utf8'));
  same(row.manifestPath,pointer.manifest.replace('/game-modules/','module-dist/'));
  const bytes=await readFile(await regularPath(root,row.manifestPath)),manifest=JSON.parse(bytes);
  same(row.manifestSha256,digest(bytes));same(pointer.sha256,digest(bytes));same(row.files,manifest.files);same(row.version,manifest.version);
  const media=Object.fromEntries(Object.entries(manifest.files).filter(([name])=>name.startsWith('media/')));
  const sourceSha=digest(JSON.stringify({config,contract,esbuildVersion,script:builder,sourceFiles:row.sourceFiles,media}));
  same(manifest.sourceSha256,sourceSha);same(proof.sourceSha256,sourceSha);same(manifest.version,config.version+'-'+sourceSha.slice(0,12));
  expected[game]=row;
 }
 same(Object.keys(report.modules).sort(),Object.keys(expected).sort());
 return reader;
}
