import test from 'node:test';import assert from 'node:assert/strict';
import {ciScope,ciScopeFromGit,ciResult} from '../scripts/release-ci-scope.mjs';

test('the required result cannot pass a failed classifier, skipped required suite or unknown profile',()=>{
 assert(ciResult('full','success','success','skipped'));assert(ciResult('records','success','skipped','success'));assert(ciResult('docs','success','skipped','skipped'));
 for(const profile of ['full','records','docs','unknown'])for(const status of ['failure','cancelled','skipped',''])assert(!ciResult(profile,status,'success','success'));
 for(const status of ['failure','cancelled','skipped','']){assert(!ciResult('full','success',status,'success'));assert(!ciResult('records','success','success',status));}
 assert(!ciResult('unknown','success','success','success'));
});

test('ordinary notes and deployment records do not rebuild application or games',()=>{
 assert.equal(ciScope(['deployment/SERVER.md','docs/release-process.md','AGENTS.md']),'docs');
 assert.equal(ciScope(['deployment/SERVER.md','deployment/releases/fix-v1/verification.json','deployment/releases/fix-v1/README.md']),'records');
});
test('financial, game, contract, dependency, CI and unknown changes always retain full checks',()=>{
 for(const name of ['server/demoWallet.ts','server/auth.ts','server/games/math.ts','src/shared/gameStakes.ts','src/network/LobbyClient.ts','games/example/entry.ts','public/assets/cover.png','scripts/check-game-rtp.mjs','package-lock.json','.github/workflows/game-rtp.yml','deployment/maintenance/cleanup-release-history.py','server-tests/game-wallet.test.ts','new-file','docs/proof.json','games/example/README.md'])assert.equal(ciScope(['deployment/SERVER.md',name]),'full',name);
 assert.equal(ciScope([]),'full');
});
test('missing, untrusted or unavailable Git baselines fail closed to the full matrix',()=>{
 for(const base of [undefined,'HEAD','0'.repeat(40),'a'.repeat(40),'bad\nHEAD'])assert.equal(ciScopeFromGit(process.cwd(),base),'full');
});

test('the real Git diff distinguishes records and treats moving executable code as a full change',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises'),{resolve,dirname}=await import('node:path'),{git}=await import('../scripts/release.mjs');
 const parent=resolve('artifacts/work/release-ci-scope-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(resolve(parent,'fixture-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 git(root,['init','-q']);git(root,['config','user.name','CI scope test']);git(root,['config','user.email','ci-scope@example.invalid']);
 const put=async(name,text)=>{await mkdir(dirname(resolve(root,name)),{recursive:true});await writeFile(resolve(root,name),text);};
 const commit=()=>{git(root,['add','.']);git(root,['commit','-qm','fixture']);return git(root,['rev-parse','HEAD']);};
 await put('src/value.ts','export const value=1;');let base=commit();await put('deployment/SERVER.md','release record');commit();assert.equal(ciScopeFromGit(root,base),'docs');
 base=git(root,['rev-parse','HEAD']);await put('deployment/releases/test-v1/verification.json','{}');commit();assert.equal(ciScopeFromGit(root,base),'records');
 base=git(root,['rev-parse','HEAD']);git(root,['mv','src/value.ts','README.md']);commit();assert.equal(ciScopeFromGit(root,base),'full');
});
