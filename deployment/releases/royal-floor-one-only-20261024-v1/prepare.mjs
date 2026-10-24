import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),work=resolve(root,'..'),out=resolve(work,'payload');
const name='royal-floor-one-only-20261024-v1',base='09dbad7d86ec4b5c7d18c16715d1861de65468f3';
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,encoding:'utf8'}).trim();
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const before=json(resolve(work,'before.json')),normalized=json(resolve(work,'source-normalized.json')),active=json(resolve(work,'active-modules.json'));
const release=json(resolve(root,'module-build/release-manifest.json'));
assert.equal(release.sourceCommit,git('rev-parse','HEAD'));assert.equal(release.baseCommit,base);assert(release.build.passed);
const receipt=json(resolve(root,'module-build/release-github.json'));assert.equal(receipt.sourceCommit,release.sourceCommit);
assert(!git('status','--porcelain'));assert(!existsSync(out),'Review an existing payload before replacing it');mkdirSync(out);
function copy(from,to){const dest=resolve(out,to);assert(dest.startsWith(out+'/'));mkdirSync(dirname(dest),{recursive:true});copyFileSync(from,dest);}
const changed={};
for(const file of release.changed){if(!/^(src|server|scripts|docs)\//.test(file))continue;assert(existsSync(resolve(root,file)),file);const digest=hash(resolve(root,file));if(before.source[file]===digest)continue;changed[file]=digest;copy(resolve(root,file),'source/'+file);}
for(const [file,digest]of Object.entries(before.source)){
 if(file==='deployment/SERVER.md'||file.endsWith('.orig')||file.endsWith('.bak')||file in changed)continue;
 assert(existsSync(resolve(root,file)),file);const actual=hash(resolve(root,file));assert(actual===digest||normalized[file]?.lf===actual,'Unrelated production source differs: '+file);
}
const delta={};
for(const [file,digest]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===digest)continue;
 const sub=file.slice(5);
 if(['index.html','admin.html'].includes(sub)||/^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub)){
  assert(['index.html','admin.html'].includes(sub)||!(file in before.program),'Immutable client URL would change');delta[sub]=digest;copy(resolve(root,file),'dist-delta/'+sub);
 }else assert.equal(before.source['public/'+sub],digest,'Unexpected static asset change: '+file);
}
assert('index.html'in delta);copy(resolve(root,'dist-server/index.js'),'server-delta/index.js');
const moduleDelta={},modulePackages=[];
for(const row of release.packages){
 const folder=resolve(root,'module-dist',row.gameId,'versions',row.version),metadata=json(resolve(folder,'manifest.json')),prior=active.games[row.gameId];
 if(prior&&JSON.stringify(metadata.files)===JSON.stringify(prior.metadata.files))continue;
 const contract=active.host.games[row.gameId];assert(contract,row.gameId);for(const key of ['apiVersion','rulesVersion','progressVersion'])assert.equal(metadata[key],contract[key],row.gameId+' '+key);
 const pointer='/opt/royal-game-modules/'+row.gameId+'/active.json';modulePackages.push({gameId:row.gameId,version:row.version,beforeSha256:before.moduleFiles[pointer]||'none'});
 function visit(dir){for(const row of readdirSync(dir,{withFileTypes:true})){const file=resolve(dir,row.name);if(row.isDirectory())visit(file);else{const sub=relative(resolve(root,'module-dist'),file);moduleDelta[sub]=hash(file);assert.equal(release.files['module-dist/'+sub],moduleDelta[sub]);copy(file,'modules/'+sub);}}}visit(folder);
}
const helper=dirname(fileURLToPath(import.meta.url));for(const file of ['deploy.py','snapshot.py','modules.py'])copy(resolve(helper,file),file);
copy(resolve(root,'module-build/release-manifest.json'),'release-manifest.json');copy(resolve(root,'module-build/release-github.json'),'release-github.json');
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:base,before,changed,delta,serverDelta:{'index.js':hash(resolve(root,'dist-server/index.js'))},helperSha256:hash(resolve(out,'deploy.py')),snapshotSha256:hash(resolve(out,'snapshot.py')),modulesHelperSha256:hash(resolve(out,'modules.py')),moduleDelta,modulePackages};
writeFileSync(resolve(out,'install-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
execFileSync('tar',['-czf',resolve(work,'transport.tgz'),'-C',out,'.']);
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,modulePackages:modulePackages.length,transportBytes:statSync(resolve(work,'transport.tgz')).size}));
