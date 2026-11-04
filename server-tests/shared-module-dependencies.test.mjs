import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {moduleFingerprinter,dependencyPath,regularPath} from '../scripts/module-build-cache.mjs';

test('shared installed dependencies keep canonical bundle names and content-bound fingerprints',async()=>{
 const task=await mkdtemp(join(tmpdir(),'royal-shared-deps-')),root=join(task,'checkout'),installed=join(task,'installed');
 try{
  await mkdir(join(installed,'tiny-package'),{recursive:true});await mkdir(root);await symlink(installed,join(root,'node_modules'));
  await writeFile(join(installed,'tiny-package/package.json'),JSON.stringify({name:'tiny-package',main:'index.js'}));
  await writeFile(join(installed,'tiny-package/index.js'),'export const value=1;');
  await writeFile(join(root,'entry.js'),"export {value} from 'tiny-package';");
  const result=await build({absWorkingDir:root,entryPoints:['entry.js'],bundle:true,write:false,metafile:true,preserveSymlinks:true});
  assert.deepEqual(Object.keys(result.metafile.inputs).sort(),['entry.js','node_modules/tiny-package/index.js']);
  const fingerprint=()=>moduleFingerprinter(root,{test:true})({assetRoots:[]},{slug:'fixture'},Object.keys(result.metafile.inputs));
  const before=await fingerprint();await writeFile(join(installed,'tiny-package/index.js'),'export const value=2;');assert.notEqual(await fingerprint(),before);
  await assert.rejects(regularPath(root,'node_modules/tiny-package/index.js'),/symlink/);
  assert.equal(await dependencyPath(root,'node_modules/tiny-package/index.js'),await realpath(join(installed,'tiny-package/index.js')));
 }finally{await rm(task,{recursive:true,force:true});}
});

test('shared dependencies cannot authorize source, output, internal links or traversal',async()=>{
 const task=await mkdtemp(join(tmpdir(),'royal-shared-dep-guards-')),root=join(task,'checkout'),installed=join(task,'installed');
 try{
  await mkdir(installed);await mkdir(root);await writeFile(join(task,'outside.js'),'secret');await symlink(installed,join(root,'node_modules'));await symlink(join(task,'outside.js'),join(installed,'linked.js'));
  for(const name of ['node_modules/../outside.js','../outside.js','src/file.js','dist/out.js','node_modules//file.js','node_modules\\file.js'])await assert.rejects(dependencyPath(root,name),/Unsafe/);
  await assert.rejects(dependencyPath(root,'node_modules/linked.js'),/symlink/);
  await symlink(join(task,'outside.js'),join(root,'source.js'));await assert.rejects(regularPath(root,'source.js'),/symlink/);
 }finally{await rm(task,{recursive:true,force:true});}
});
