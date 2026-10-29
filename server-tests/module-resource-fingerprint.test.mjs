import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
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
