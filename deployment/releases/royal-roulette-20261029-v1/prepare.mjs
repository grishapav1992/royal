import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const helper=dirname(fileURLToPath(import.meta.url)),root=resolve(helper,'../../..'),work=resolve(root,'..'),out=resolve(work,'payload');
const json=p=>JSON.parse(readFileSync(p,'utf8')),digest=b=>createHash('sha256').update(b).digest('hex'),sha=p=>digest(readFileSync(p));
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root});
const scope=json(resolve(helper,'scope.json')),before=json(resolve(work,'before.json')),release=json(resolve(root,'module-build/release-manifest.json')),receipt=json(resolve(root,'module-build/release-github.json'));
assert.equal(release.sourceCommit,git('rev-parse','HEAD').toString().trim());assert.equal(release.baseCommit,scope.base);assert(release.build.passed);assert.equal(receipt.sourceCommit,release.sourceCommit);assert.equal(git('status','--porcelain').toString().trim(),'');
assert.equal(before.sourceRevision,scope.base);assert.deepEqual(before.program,before.preparedProgram);assert(before.availableBytes>5*1024**3);assert(!existsSync(out));mkdirSync(out);
const payload={},changed={},delta={},serverDelta={},retainedSource=[];const allowed=new Set(scope.allowedSource);
function copy(from,to){const target=resolve(out,to);assert(target.startsWith(out+'/'));mkdirSync(dirname(target),{recursive:true});copyFileSync(from,target);payload[to]=sha(target);return payload[to];}
for(const file of release.changed.filter(p=>allowed.has(p))){const value=sha(resolve(root,file));if(![before.source[file],before.sourceLF[file]].includes(value))changed[file]=copy(resolve(root,file),'source/'+file);}
// Unrelated service sources can be newer than the running game graph. Retain their exact reviewed Git origins.
for(const [file,hash]of Object.entries(before.source)){
 if(file==='deployment/SERVER.md'||file.endsWith('.orig')||file.endsWith('.bak')||file in changed)continue;
 const actual=existsSync(resolve(root,file))?sha(resolve(root,file)):null;if([hash,before.sourceLF[file]].includes(actual))continue;
 const origins=[];for(const commit of ['968b6649ecf1a7d0d195d7c1c816c9bcf9112eb4',scope.base]){try{const blob=git('show',commit+':'+file);if([digest(blob),digest(Buffer.from(blob.toString().replace(/\r\n/g,'\n')))].some(v=>[hash,before.sourceLF[file]].includes(v)))origins.push(commit);}catch{}}
 assert(origins.length,'Unknown retained production source: '+file);retainedSource.push({file,liveSha256:hash,buildSha256:actual,origins});
}
for(const [file,hash]of Object.entries(release.files)){
 assert.equal(sha(resolve(root,file)),hash);if(!file.startsWith('dist/'))continue;
 const sub=file.slice(5);if(before.program[file]===hash||before.programLF[file]===hash)continue;
 if(sub==='index.html'||/^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub)||sub==='assets/royal-roulette/cover.svg'){
  assert(sub==='index.html'||!(file in before.program),'Immutable host URL changed: '+file);delta[sub]=copy(resolve(root,file),'dist-delta/'+sub);
 }else{assert([before.source['public/'+sub],before.sourceLF['public/'+sub]].includes(hash),'Unrelated static source changed: '+file);}
}
assert('index.html'in delta);mkdirSync(resolve(out,'server-delta'));
const audit=await build({absWorkingDir:root,entryPoints:['server/index.ts'],bundle:true,platform:'node',packages:'external',format:'esm',outfile:'dist-server/index.js',write:false,metafile:true});
assert.equal(digest(audit.outputFiles[0].contents),release.files['dist-server/index.js']);
const inputAudit={};for(const file of Object.keys(audit.metafile.inputs)){
 const actual=sha(resolve(root,file));if(!allowed.has(file))assert.equal(actual,digest(git('show',scope.base+':'+file)),'Unreviewed game backend source: '+file);inputAudit[file]=actual;
}
serverDelta['index.js']=copy(resolve(root,'dist-server/index.js'),'server-delta/index.js');
assert.equal(sha(resolve(root,'package-lock.json')),before.program['package-lock.json'],'Dependency lock changed');
const basePackage=JSON.parse(git('show',scope.base+':package.json')),
 currentPackage=json(resolve(root,'package.json'));delete basePackage.scripts;delete currentPackage.scripts;assert.deepEqual(currentPackage,basePackage,'Runtime package metadata changed');
const localHost=json(resolve(root,'module-dist/host-contracts.json'));assert.deepEqual(localHost.games,before.moduleHost.games,'Host compatibility contract changed');
const pointer=json(resolve(root,'module-dist/royal-roulette/active.json')),folder=dirname(resolve(root,'module-dist',pointer.manifest.replace(/^\/game-modules\//,''))),metadata=json(resolve(folder,'manifest.json'));
assert.equal(sha(resolve(folder,'manifest.json')),pointer.sha256);for(const field of ['apiVersion','rulesVersion','progressVersion'])assert.equal(metadata[field],scope.contract[field]);
const moduleFiles={};for(const file of ['manifest.json',...Object.keys(metadata.files)])moduleFiles[file]=copy(resolve(folder,file),'roulette-package/'+file);
for(const file of ['deploy.py','snapshot.py','runtime-inventory.cjs','quiesce.cjs','financial_gate.py','run-release.py'])copy(resolve(helper,file),file);
copy(resolve(root,'scripts/game-module-release.py'),'game-module-release.py');
for(const file of ['release-manifest.json','release-github.json'])copy(resolve(root,'module-build',file),file);
const helpers=Object.fromEntries(['runtime-inventory.cjs','quiesce.cjs','financial_gate.py'].map(f=>[f,payload[f]]));
const manifest={release:scope.release,sourceCommit:release.sourceCommit,baseCommit:scope.base,before,changed,delta,serverDelta,helpers,helperSha256:payload['deploy.py'],snapshotSha256:payload['snapshot.py'],payload,moduleFiles,modulePublisherSha256:payload['game-module-release.py'],moduleBeforeSha256:before.moduleFiles['/opt/royal-game-modules/royal-roulette/active.json'],retainedSource,inputAudit,compatibility:{hostContractUnchanged:true,rulesUnchanged:true,dependencyLockUnchanged:true,paymentAndFinanceProgramsRetained:true,otherModulesRetained:true}};
writeFileSync(resolve(out,'install-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
execFileSync('tar',[...(process.platform==='darwin'?['--no-xattrs']:[]),'-czf',resolve(work,'transport.tgz'),'-C',out,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,backendFiles:1,module:metadata.version,transportBytes:statSync(resolve(work,'transport.tgz')).size}));
