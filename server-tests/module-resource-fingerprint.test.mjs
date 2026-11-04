import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {moduleFingerprinter} from '../scripts/module-build-cache.mjs';

test('unpackageable resource names cannot change a package fingerprint; valid assets and symlink checks remain effective',async()=>{
 const root=await mkdtemp(join(tmpdir(),'royal-media-names-'));
 const folder=join(root,'public/assets/fixture');
 const fingerprint=()=>moduleFingerprinter(root,{test:true})({assetRoots:['fixture']},{slug:'fixture'},[]);
 try{
  await mkdir(folder,{recursive:true});await writeFile(join(folder,'flag.svg'),'<svg/>');
  const before=await fingerprint();
  await writeFile(join(folder,'flag 2.svg'),'<svg>unrelated sync copy</svg>');
  assert.equal(await fingerprint(),before);
  await writeFile(join(folder,'flag.svg'),'<svg>reviewed update</svg>');
  assert.notEqual(await fingerprint(),before);
  await symlink(join(folder,'flag.svg'),join(folder,'linked 2.svg'));
  await assert.rejects(fingerprint(),/symlink/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a shared dependency root is hashed canonically while nested links and unrelated escapes fail closed',async()=>{
 const {moduleSourcePath,normalizeModuleInput,regularPath}=await import('../scripts/module-build-cache.mjs');
 const root=await mkdtemp(join(tmpdir(),'royal-shared-dependencies-')),checkout=join(root,'checkout'),dependencies=join(root,'installed');
 try{
  await mkdir(checkout);await mkdir(join(dependencies,'fixture'),{recursive:true});await writeFile(join(dependencies,'fixture','index.js'),'export const value=1;');
  await symlink(dependencies,join(checkout,'node_modules'),'dir');
  const normalized=await normalizeModuleInput(checkout,'../installed/fixture/index.js');
  assert.equal(normalized,'node_modules/fixture/index.js');
  assert.equal(await moduleSourcePath(checkout,normalized),await realpath(join(dependencies,'fixture','index.js')));
  const fingerprint=()=>moduleFingerprinter(checkout,{test:true})({assetRoots:[]},{slug:'fixture'},['../installed/fixture/index.js']);
  const before=await fingerprint();await writeFile(join(dependencies,'fixture','index.js'),'export const value=2;');assert.notEqual(await fingerprint(),before);
  await assert.rejects(regularPath(checkout,normalized),/symlink/i);
  await writeFile(join(root,'unrelated.js'),'secret');await assert.rejects(normalizeModuleInput(checkout,'../unrelated.js'),/Unsafe/);
  await symlink(join(root,'unrelated.js'),join(dependencies,'fixture','linked.js'));await assert.rejects(moduleSourcePath(checkout,'node_modules/fixture/linked.js'),/symlink/i);
  await assert.rejects(moduleSourcePath(checkout,'node_modules/../unrelated.js'),/Unsafe/);
 }finally{await rm(root,{recursive:true,force:true});}
});
