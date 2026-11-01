import assert from'node:assert/strict';import{readFile,mkdir,writeFile}from'node:fs/promises';import{resolve,relative,dirname}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
import{build,version}from'esbuild';import{readHostProjection}from'../../../scripts/build-host-projection.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),allowed=new Set(['scripts/finance-nile-play.ts','scripts/finance-nile-play-proof.ts','server/finance/nile-game-runtime.ts']);
export async function nativeBuild(root,config,output,entries=[...allowed]){
 assert(entries.length&&entries.every(e=>allowed.has(e)));const reader=await readHostProjection(root,config,{strictOrigins:true});
 const packageJson=JSON.parse(reader.read('package.json')),actual=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
 for(const key of ['type','dependencies','devDependencies','overrides','engines'])assert.deepEqual(packageJson[key],actual[key],'Native package resolution changed');
 await mkdir(output,{recursive:true});const names={'scripts/finance-nile-play.ts':'play.js','scripts/finance-nile-play-proof.ts':'proof.js','server/finance/nile-game-runtime.ts':'runtime.mjs'},outputs={};
 for(const entry of entries){
  const result=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'node',format:'esm',packages:'external',tsconfigRaw:reader.read('tsconfig.json').toString(),plugins:[{name:'reviewed-native-sources',setup(b){b.onLoad({filter:/\.(?:ts|mts|cts|js|mjs|cjs|json)$/},args=>{
   const name=relative(root,args.path).replaceAll('\\','/');if(name.includes('node_modules/'))return;
   assert(/^(?:server|src|scripts)\//.test(name),'Unreviewed native source kind');return{contents:reader.read(name),loader:name.endsWith('.json')?'json':/\.([cm]?ts)$/.test(name)?'ts':'js',resolveDir:dirname(args.path)};
  });}}]});
  assert.equal(result.outputFiles.length,1);const bytes=result.outputFiles[0].contents,name=names[entry];await writeFile(resolve(output,name),bytes);outputs[name]={entry,sha256:hash(bytes),bytes:bytes.length};
 }
 const report={format:1,sourceCommit:execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),config,configSha256:reader.sha256,productionCommit:reader.metadata.productionCommit,esbuildVersion:version,inputs:reader.inputs,origins:reader.origins,outputs};
 await writeFile(resolve(output,'native-build.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export async function verifyNativeBuild(root,output){
 const report=JSON.parse(await readFile(resolve(output,'native-build.json'),'utf8')),reader=await readHostProjection(root,report.config,{strictOrigins:true});
 assert.equal(reader.sha256,report.configSha256);assert.equal(reader.metadata.productionCommit,report.productionCommit);assert.equal(report.esbuildVersion,version);
 for(const[n,h]of Object.entries(report.inputs)){assert.equal(hash(reader.read(n)),h);assert.deepEqual(reader.origins[n],report.origins[n]);}
 for(const[n,v]of Object.entries(report.outputs)){assert(allowed.has(v.entry));assert.equal(hash(await readFile(resolve(output,n))),v.sha256);}
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[mode,config,output]=process.argv.slice(2);assert(['build','verify'].includes(mode));
 const result=mode==='build'?await nativeBuild(process.cwd(),config,resolve(output)):await verifyNativeBuild(process.cwd(),resolve(output));
 console.log(JSON.stringify({sourceCommit:result.sourceCommit,inputs:Object.keys(result.inputs).length,outputs:result.outputs}));
}
