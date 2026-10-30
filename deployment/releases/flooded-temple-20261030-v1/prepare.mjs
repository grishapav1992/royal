import {readFileSync,writeFileSync,mkdirSync,existsSync,linkSync,statSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {buildProgram,canonical,sha} from './programs.mjs';
const root=process.cwd(),helper='deployment/releases/flooded-temple-20261030-v1',work='artifacts/work/temple-production-096',out=resolve(root,work,'payload');
const json=p=>JSON.parse(readFileSync(p)),hash=p=>sha(readFileSync(p));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const before=json(work+'/before.json'),scope=json(helper+'/scope.json'),release=json('module-build/release-manifest.json'),receipt=json('module-build/release-github.json');
assert.equal(git('status','--porcelain'),'');assert.equal(release.sourceCommit,git('rev-parse','HEAD'));assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(release.baseCommit,scope.base);assert(release.githubVerified&&release.build.passed&&release.scope==='application');
assert.equal(before.sourceRevision,scope.base);assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.containers['royal-game-1'].health,'healthy');assert(before.freeBytes>5*1024**3);
assert(!existsSync(out),'Do not reconstruct a completed or incomplete payload');mkdirSync(out);
const payload={},source={},financeSource={},dist={},modules={},backend={},links=new Map();
function write(name,bytes){
 assert(name&&!name.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.env')||['node_modules','data','secrets'].includes(p)));const file=resolve(out,name);assert(relative(out,file)&&!relative(out,file).startsWith('..'));
 mkdirSync(dirname(file),{recursive:true});const digest=sha(bytes);if(links.has(digest))linkSync(links.get(digest),file);else{writeFileSync(file,bytes,{flag:'wx'});links.set(digest,file);}return payload[name]=digest;
}
const copy=(file,name)=>write(name,readFileSync(file));
for(const file of scope.allowedSource){
 let bytes=readFileSync(file);if(/\.(?:ts|css|json|mjs|cjs|html|md|txt)$/.test(file))bytes=canonical(bytes);
 const digest=sha(bytes);if(digest!==before.source[file]?.lf&&digest!==before.source[file]?.sha256)source[file]=write('source/'+file,bytes);
}
// Inherit every existing public/admin resource; select only prepared hall outputs and the new cover.
for(const[file,digest]of Object.entries(release.files)){
 if(!(file==='dist/index.html'||/^dist\/assets\/(?:main|modulepreload-polyfill)-[a-zA-Z0-9_-]+\.(?:js|css)$/.test(file)||file==='dist/assets/flooded-temple/cover.webp'))continue;
 assert.equal(hash(file),digest);if(before.program[file]===digest)continue;
 assert(file==='dist/index.html'||!before.program[file],'Immutable resource collision');dist[file.slice(5)]=copy(file,file);
}
assert(dist['index.html']&&dist['assets/flooded-temple/cover.webp']);
backend['index.js']=copy('dist-server/index.js','backend/index.js');assert.equal(backend['index.js'],release.files['dist-server/index.js']);
const programs=json('module-build/temple-production-096/programs.json');assert.equal(programs.programs.application.sha256,backend['index.js'],'Final backend differs from the reproduced/compared program');
const financial=await buildProgram(before);assert.equal(sha(financial.outputFiles[0].contents),programs.programs.finance.sha256,'Financial program changed after tests');write('play.js',financial.outputFiles[0].contents);
for(const[file,digest]of Object.entries(financial.inputs))if(before.financeSource[file]?.lf!==digest){assert(scope.allowedSource.includes(file),'Unreviewed finance delta: '+file);financeSource[file]=write('finance-source/'+file,financial.contents[file]);}
const host=json('module-dist/host-contracts.json'),expected=structuredClone(before.moduleHost);assert(!expected.games[scope.changedGame]);expected.games[scope.changedGame]=scope.contract;assert.deepEqual(host,expected,'Only the Temple contract may change');
modules['host-contracts.json']=copy('module-dist/host-contracts.json','module-dist/host-contracts.json');copy('module-dist/host-contracts.json','host.json');
const pointerFile='module-dist/'+scope.changedGame+'/active.json',pointer=json(pointerFile),packageDir=dirname('module-dist/'+pointer.manifest.replace('/game-modules/','')),meta=json(packageDir+'/manifest.json');
assert.equal(hash(packageDir+'/manifest.json'),pointer.sha256);for(const[k,v]of Object.entries(scope.contract))assert.equal(meta[k],v);
for(const file of ['manifest.json',...Object.keys(meta.files)]){const from=packageDir+'/'+file,name=scope.changedGame+'/versions/'+meta.version+'/'+file;assert.equal(hash(from),release.files['module-dist/'+name]);modules[name]=copy(from,'module-dist/'+name);copy(from,'temple-package/'+file);}
modules[scope.changedGame+'/active.json']=copy(pointerFile,'module-dist/'+scope.changedGame+'/active.json');
for(const file of ['deploy.py','snapshot.py','runtime-inventory.cjs','financial_gate.py','quiesce.cjs','run-release.py','scope.json','test_deploy.py'])copy(helper+'/'+file,file);
assert.equal(sha(canonical(readFileSync('scripts/game-module-release.py'))),before.source['scripts/game-module-release.py'].lf);copy('scripts/game-module-release.py','game-module-release.py');
for(const file of ['release-manifest.json','release-github.json'])copy('module-build/'+file,file);copy('module-build/temple-production-096/programs.json','programs.json');
const manifest={release:scope.release,sourceCommit:release.sourceCommit,baseCommit:scope.base,before,source,financeSource,dist,modules,backend,financial:payload['play.js'],payload,hostContract:payload['host.json'],helperSha256:payload['deploy.py'],modulePackage:{gameId:scope.changedGame,version:meta.version,manifestSha256:pointer.sha256,beforeSha256:'none'},financialInputs:financial.inputs,financialOrigins:financial.origins,backendInputs:programs.programs.application.inputs,compatibility:{retainedContracts:Object.keys(before.moduleHost.games).length,onlyTempleContractAdded:true,acceptedTempleRules:[1,2],retainedGIRLHUBProgress:3,unchangedDependencies:true}};
writeFileSync(out+'/install-manifest.json',JSON.stringify(manifest,null,2)+'\n');
execFileSync('tar',['-czf',resolve(work,'transport.tgz'),'-C',out,'.']);
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(source).length,financialSourceFiles:Object.keys(financeSource).length,module:meta.version,payloadFiles:Object.keys(payload).length,transportBytes:statSync(resolve(work,'transport.tgz')).size}));
