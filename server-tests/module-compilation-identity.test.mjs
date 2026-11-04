import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{build,version}from'esbuild';
import{digest}from'../scripts/module-build-cache.mjs';import{moduleSourceSha256}from'../scripts/module-source-projection.mjs';
test('different effective tsconfig modes cannot collide in one immutable module version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'royal-compiler-identity-'));
 try{
  await mkdir(join(root,'game'));const common=JSON.stringify({compilerOptions:{target:'ES2022',useDefineForClassFields:true}}),game=JSON.stringify({extends:'../tsconfig.json',compilerOptions:{useDefineForClassFields:false}}),entry='class Example { field:number|undefined; } console.log(new Example());';
  await writeFile(join(root,'tsconfig.json'),common);await writeFile(join(root,'game/tsconfig.json'),game);await writeFile(join(root,'game/entry.ts'),entry);
  const options={absWorkingDir:root,entryPoints:['game/entry.ts'],bundle:true,write:false,target:'es2022',logLevel:'silent'};
  const normal=await build(options),projected=await build({...options,tsconfigRaw:common});assert.notEqual(normal.outputFiles[0].text,projected.outputFiles[0].text);
  const configurations={'tsconfig.json':digest(common),'game/tsconfig.json':digest(game)},sourceFiles={...configurations,'game/entry.ts':digest(entry)},base={config:{version:'1.0.0'},contract:{},esbuildVersion:version,builderSha256:'a'.repeat(64),sourceFiles,media:{}};
  const compilation=projected=>({format:1,projected,configurations,helperSha256:'b'.repeat(64)});
  assert.notEqual(moduleSourceSha256({...base,compilation:compilation(false)}),moduleSourceSha256({...base,compilation:compilation(true)}));
  assert.throws(()=>moduleSourceSha256({...base,sourceFiles:{...sourceFiles,'tsconfig.json':'c'.repeat(64)},compilation:compilation(true)}));
  assert.notEqual(moduleSourceSha256({...base,compilation:compilation(true)}),moduleSourceSha256({...base,compilation:{...compilation(true),helperSha256:'d'.repeat(64)}}));
 }finally{await rm(root,{recursive:true,force:true});}
});
