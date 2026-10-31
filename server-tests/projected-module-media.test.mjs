import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{projectedModuleAsset}from'../scripts/module-source-projection.mjs';import{digest}from'../scripts/module-build-cache.mjs';
test('production JSON media uses verified Git bytes and preserves a concurrent working file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'royal-media-'));try{
  await mkdir(join(root,'public'));const name='public/manifest.json',current=Buffer.from('{"new":true}'),production=Buffer.from('{"old":true}');await writeFile(join(root,name),current);
  const reader={metadata:{moduleAssetSources:[name],files:{[name]:{}},moduleAssets:{[name]:digest(production)}},read:n=>{assert.equal(n,name);return production;}};
  assert.deepEqual(await projectedModuleAsset(root,name,reader),production);
  reader.metadata.moduleAssets[name]=digest(current);await assert.rejects(projectedModuleAsset(root,name,reader));
  reader.metadata.moduleAssetSources=[];assert.deepEqual(await projectedModuleAsset(root,name,reader),current);
  reader.metadata.moduleAssets[name]=digest(production);await assert.rejects(projectedModuleAsset(root,name,reader));
 }finally{await rm(root,{recursive:true,force:true});}
});
