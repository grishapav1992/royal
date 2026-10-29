import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build as buildHost} from 'vite';
import {buildProgram,viteProjection,digest,projectedReader} from './projection.mjs';
const helper=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(helper,'../../..'),work=path.join(root,'artifacts/work/jackie-chan'),out=path.join(work,'payload');
const json=p=>JSON.parse(fs.readFileSync(p)),sha=p=>digest(fs.readFileSync(p));
const git=(...args)=>cp.execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,encoding:'utf8'}).trim();
const scope=json(path.join(helper,'scope.json')),meta=json(path.join(helper,'projection-origins.json')),before=json(path.join(work,'production-before.json'));
const prior=json(path.join(work,'production-prior.json'));assert.equal(prior.sourceRevision,meta.previousProduction);
const release=json(path.join(root,'module-build/release-manifest.json')),receipt=json(path.join(root,'module-build/release-github.json'));
assert.equal(git('status','--porcelain'),'');assert.equal(release.sourceCommit,git('rev-parse','HEAD'));assert.equal(release.baseCommit,scope.base);assert(release.build.passed);assert.equal(receipt.sourceCommit,release.sourceCommit);
assert.equal(before.sourceRevision,scope.base);assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.containers['royal-game-1'].image,before.preparedImage);assert(before.freeBytes>5*1024**3);
assert(!fs.existsSync(out),'Do not reconstruct an existing payload');fs.mkdirSync(out);
const payload={},source={},financeSource={},dist={},modules={},backend={};
function write(name,bytes){assert(!path.isAbsolute(name)&&!name.split('/').includes('..'));const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return payload[name]=digest(bytes);}
function copy(file,name){return write(name,fs.readFileSync(file));}
const sourceReader=projectedReader(before);
for(const row of meta.rows)source[row.file]=write('source/'+row.file,sourceReader.read(row.file));
const allowed=new Set(scope.allowedSource);
for(const file of scope.allowedSource){if(file in source)continue;assert(fs.existsSync(path.join(root,file)),file);source[file]=copy(path.join(root,file),'source/'+file);}
for(const file of ['index.html','admin.html','package-lock.json'])assert.equal(digest(Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n'))),before.source[file].lf,'Baseline entry or dependency changed: '+file);
const hostPlugin=viteProjection(before);
const builtHost=await buildHost({root,configFile:false,publicDir:false,plugins:[hostPlugin],build:{write:false,emptyOutDir:false,rollupOptions:{input:{main:path.join(root,'index.html'),admin:path.join(root,'admin.html')}}}});
for(const result of Array.isArray(builtHost)?builtHost:[builtHost])for(const item of result.output){const file=item.fileName;assert(['index.html','admin.html'].includes(file)||/^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(file),'Unreviewed host output: '+file);const bytes=Buffer.from(item.type==='chunk'?item.code:item.source);if(before.program['dist/'+file]===digest(bytes))continue;assert(['index.html','admin.html'].includes(file)||!('dist/'+file in before.program),'Immutable host asset changed');dist[file]=write('dist/'+file,bytes);}
assert('index.html' in dist);dist['assets/jackie-chan/cover.webp']=copy(path.join(root,'public/assets/jackie-chan/cover.webp'),'dist/assets/jackie-chan/cover.webp');
const app=await buildProgram(before),financial=await buildProgram(before,'finance');
backend['index.js']=write('backend/index.js',app.outputFiles[0].contents);write('play.js',financial.outputFiles[0].contents);
for(const [file,hash] of Object.entries(financial.inputs)){if(before.financeSource[file]?.lf===hash)continue;assert(allowed.has(file),'Unreviewed finance delta: '+file);financeSource[file]=write('finance-source/'+file,financial.contents[file]);}
const catalog=sourceReader.read('src/modules/GameModuleCatalog.ts').toString();assert(catalog.includes("'original-jackie-chan'"));
// Preserve every running host contract and add the qualified game contract.
const host=structuredClone(before.moduleHost);assert(!host.games[scope.changedGame]);host.games[scope.changedGame]=scope.contract;
write('host.json',Buffer.from(JSON.stringify(host,null,2)+'\n'));modules['host-contracts.json']=write('module-dist/host-contracts.json',fs.readFileSync(path.join(out,'host.json')));
const pointerFile=path.join(root,'module-dist',scope.changedGame,'active.json'),pointer=json(pointerFile);
const packageDir=path.dirname(path.join(root,'module-dist',pointer.manifest.replace(/^\/game-modules\//,''))),metadata=json(path.join(packageDir,'manifest.json'));
assert.equal(sha(path.join(packageDir,'manifest.json')),pointer.sha256);for(const field of ['apiVersion','rulesVersion','progressVersion'])assert.equal(metadata[field],scope.contract[field]);
for(const file of ['manifest.json',...Object.keys(metadata.files)]){const from=path.join(packageDir,file);if(file!=='manifest.json')assert.equal(sha(from),metadata.files[file]);const name=scope.changedGame+'/versions/'+metadata.version+'/'+file;modules[name]=copy(from,'module-dist/'+name);copy(from,'jackie-package/'+file);}
modules[scope.changedGame+'/active.json']=copy(pointerFile,'module-dist/'+scope.changedGame+'/active.json');
for(const file of ['deploy.py','snapshot.py','financial_gate.py','quiesce.cjs','runtime-inventory.cjs','run-release.py','scope.json','projection-origins.json','financial-origins.json','test_deploy.py'])copy(path.join(helper,file),file);
copy(path.join(root,'scripts/game-module-release.py'),'game-module-release.py');assert.equal(digest(Buffer.from(fs.readFileSync(path.join(root,'scripts/game-module-release.py'),'utf8').replace(/\r\n/g,'\n'))),before.source['scripts/game-module-release.py'].lf);
for(const file of ['release-manifest.json','release-github.json'])copy(path.join(root,'module-build',file),file);
const manifest={release:scope.release,sourceCommit:release.sourceCommit,baseCommit:scope.base,before,backupBase:{revision:prior.sourceRevision,source:prior.source,financeSource:prior.financeSource},source,financeSource,financialInputs:financial.inputs,financialOrigins:financial.origins,backendInputs:app.inputs,backendOrigins:app.origins,hostInputs:hostPlugin.reader.inputs,hostOrigins:hostPlugin.reader.origins,dist,modules,backend,financial:payload['play.js'],payload,hostContract:payload['host.json'],helperSha256:payload['deploy.py'],modulePackage:{gameId:scope.changedGame,version:metadata.version,manifestSha256:pointer.sha256,beforeSha256:'none'},compatibility:{onlyJackieContractAdded:true,acceptedRules:[1],progressVersion:2,retainedOtherModules:true,unchangedDependencies:true}};
fs.writeFileSync(path.join(out,'install-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
cp.execFileSync('tar',['-czf',path.join(work,'transport.tgz'),'-C',out,'.']);
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(source).length,financeFiles:Object.keys(financeSource).length,hostFiles:Object.keys(dist).length,moduleFiles:Object.keys(modules).length,transportBytes:fs.statSync(path.join(work,'transport.tgz')).size}));
