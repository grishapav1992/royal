// Package only committed, verified Cosmic release bytes against the guarded live snapshot.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyGithub,verifyRelease} from '../../../scripts/release.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const work=resolve(root,'artifacts/work/cosmic-origin-release'),out=resolve(work,'payload');
const name='cosmic-origin-20261026-v1',game='studio-cosmic-escape';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const canonical=value=>createHash('sha256').update(value.toString().replace(/\r\n/g,'\n')).digest('hex');
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,encoding:'utf8'}).trim();
await verifyGithub(root);
const before=json(resolve(work,'before.json')),release=json(resolve(root,'module-build/release-manifest.json')),receipt=json(resolve(root,'module-build/release-github.json'));
const beforeSha256=sha(resolve(work,'before.json'));
assert.equal(release.sourceCommit,git('rev-parse','HEAD'));assert.equal(release.baseCommit,before.sourceRevision);
assert(release.build.passed&&release.scope==='application'&&release.githubVerified);assert.equal(receipt.sourceCommit,release.sourceCommit);assert(!git('status','--porcelain'));
assert.equal(before.container.health,'healthy');assert.equal(before.container.image,before.preparedImage);assert.deepEqual(before.program,before.preparedProgram);
for(const[p,h]of Object.entries(release.files))assert.equal(sha(resolve(root,p)),h,p);
assert(!existsSync(out),'Existing payload requires an explicit review');mkdirSync(out);
function copy(source,target){const p=resolve(out,target);assert(p.startsWith(out+'/'));mkdirSync(dirname(p),{recursive:true});copyFileSync(source,p);return sha(p);}
const changed={};
for(const file of release.changed){if(!/^(src|server|public|scripts|docs|games)\//.test(file))continue;assert(!file.endsWith('.orig')&&!file.endsWith('.bak'));const p=resolve(root,file);assert(existsSync(p),file);if(canonical(readFileSync(p))!==before.sourceLF[file])changed[file]=copy(p,'source/'+file);}
for(const[file,h]of Object.entries(before.source)){if(file==='deployment/SERVER.md'||file==='package.json'||file.endsWith('.orig')||file.endsWith('.bak')||file in changed)continue;const p=resolve(root,file);assert(existsSync(p),'Missing production source '+file);assert(sha(p)===h||canonical(readFileSync(p))===before.sourceLF[file],'Unrelated production source differs: '+file);}
const oldPackageText=execFileSync(process.env.ROYAL_GIT_BINARY||'git',['show',before.sourceRevision+':package.json'],{cwd:root});
assert.equal(canonical(oldPackageText),before.sourceLF['package.json'],'Production package metadata differs from its recorded source');
const oldPackage=JSON.parse(oldPackageText),currentPackage=json(resolve(root,'package.json'));
assert.deepEqual(Object.fromEntries(Object.entries(currentPackage).filter(([k])=>k!=='scripts')),Object.fromEntries(Object.entries(oldPackage).filter(([k])=>k!=='scripts')),'Dependency metadata change needs its own release');
const runtimePackages={};if(canonical(readFileSync(resolve(root,'package.json')))!==before.sourceLF['package.json']){changed['package.json']=copy(resolve(root,'package.json'),'source/package.json');runtimePackages['package.json']=copy(resolve(root,'package.json'),'metadata/package.json');}
for(const file of ['Dockerfile','.dockerignore','package-lock.json','index.html','tsconfig.json','tsconfig.finance.json','vite.config.ts'])assert.equal(canonical(readFileSync(resolve(root,file))),before.sourceLF[file],'Unexpected root build input '+file);
const delta={},retainedPublicRuntime=[];
for(const[file,h]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===h)continue;
 const sub=file.slice(5),p=resolve(root,file),source=resolve(root,'public',sub);
 // Preserve deployed public bytes when their public source is unchanged.
 if(file in before.program&&existsSync(source)&&sha(source)===h&&canonical(readFileSync(source))===before.sourceLF['public/'+sub]){
  retainedPublicRuntime.push({file,retainedSha256:before.program[file],preparedSha256:h,unchangedPublicSourceSha256:sha(source)});continue;
 }
 assert(['index.html','admin.html'].includes(sub)||/^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub),'Unexpected client output '+file);
 assert(['index.html','admin.html'].includes(sub)||!(file in before.program),'Immutable client collision '+file);
 delta[sub]=copy(p,'dist-delta/'+sub);
}
assert('index.html'in delta);assert(!('admin.html'in delta),'Administration must remain unchanged');
const serverDelta={'index.js':copy(resolve(root,'dist-server/index.js'),'server-delta/index.js')};assert.notEqual(serverDelta['index.js'],before.program['dist-server/index.js'],'Missing Cosmic backend update');
const host=json(resolve(root,'module-dist/host-contracts.json'));assert.deepEqual(host,before.moduleHost,'Host contracts must stay unchanged');
const row=release.packages.find(p=>p.gameId===game);assert(row);const folder=resolve(root,'module-dist',game,'versions',row.version),meta=json(resolve(folder,'manifest.json'));
for(const key of ['apiVersion','rulesVersion','progressVersion'])assert.equal(meta[key],host.games[game][key]);
const moduleDelta={};for(const file of ['manifest.json',...Object.keys(meta.files)]){const relative=game+'/versions/'+row.version+'/'+file;assert.equal(release.files['module-dist/'+relative],sha(resolve(folder,file)));moduleDelta[relative]=copy(resolve(folder,file),'modules/'+relative);}
const helpers=dirname(fileURLToPath(import.meta.url));for(const file of ['deploy.py','snapshot.py','modules.py'])copy(resolve(helpers,file),file);
copy(resolve(root,'module-dist/host-contracts.json'),'host.json');for(const file of ['release-manifest.json','release-github.json'])copy(resolve(root,'module-build',file),file);
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:release.baseCommit,before,changed,delta,serverDelta,runtimePackages,retainedPublicRuntime,
 helperSha256:sha(resolve(out,'deploy.py')),snapshotSha256:sha(resolve(out,'snapshot.py')),modulesHelperSha256:sha(resolve(out,'modules.py')),hostContractSha256:sha(resolve(out,'host.json')),
 moduleDelta,modulePackages:[{gameId:game,version:row.version,beforeSha256:before.moduleFiles['/opt/royal-game-modules/'+game+'/active.json']||before.program['module-dist/'+game+'/active.json']||'none'}]};
// External pointer absence is distinct from the bundled fallback pointer.
manifest.modulePackages[0].beforeSha256=before.moduleFiles['/opt/royal-game-modules/'+game+'/active.json']||'none';
writeFileSync(resolve(out,'install-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
execFileSync('tar',[...(process.platform==='darwin'?['--no-xattrs']:[]),'-czf',resolve(work,'transport.tgz'),'-C',out,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
await verifyRelease(root);
assert.equal(sha(resolve(work,'before.json')),beforeSha256,'Production snapshot changed during packaging');
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,moduleVersion:row.version,moduleFiles:Object.keys(moduleDelta).length,transportBytes:statSync(resolve(work,'transport.tgz')).size}));
