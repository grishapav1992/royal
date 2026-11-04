import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyRelease} from '../../../scripts/release.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
const [maintenanceSha,outPath]=process.argv.slice(2);assert(/^[a-f0-9]{64}$/.test(maintenanceSha)&&outPath);
const folder='deployment/releases/jackie-motion-20261104-v4',game='original-jackie-chan';
const release=await verifyRelease(process.cwd()),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
assert.equal(release.sourceCommit,receipt.sourceCommit);
const scope=JSON.parse(fs.readFileSync(folder+'/scope.json')),reader=await readHostProjection(process.cwd(),folder+'/module-projection.json',{strictOrigins:true});
const out=path.resolve(outPath);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function write(name,bytes){const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return hash(bytes);}
const support={};
for(const name of ['deploy.py','scope.json'])support[name]=write(name,fs.readFileSync(folder+'/'+name));
support['publisher.py']=write('publisher.py',fs.readFileSync('scripts/game-module-release.py'));
for(const name of ['release-manifest.json','release-github.json'])support[name]=write(name,fs.readFileSync('module-build/'+name));
support['installer-source.json']=write('installer-source.json',Buffer.from(JSON.stringify({applicationSourceCommit:release.sourceCommit,installerSourceCommit:release.sourceCommit,githubMainContainsInstaller:true,sha256:hash(fs.readFileSync(folder+'/deploy.py')),remoteMain:receipt.remoteMain},null,2)+'\n'));
const row=release.packages[0];assert.equal(row.gameId,game);assert.equal(release.packages.length,1);
const prefix='module-dist/'+game+'/versions/'+row.version+'/',packageFiles={};
for(const [file,digest]of Object.entries(release.files))if(file.startsWith(prefix)){
 const relative=file.slice(prefix.length);packageFiles[relative]=digest;
 if(relative.startsWith('media/'))continue;
 assert.equal(write('package/'+relative,fs.readFileSync(file)),digest);
}
for(const [name,digest]of Object.entries(scope.sourceAfter))assert.equal(write('source/'+name,reader.read(name)),digest);
const manifest={release:scope.release,sourceCommit:release.sourceCommit,version:row.version,source:scope.sourceAfter,packageFiles,
 pointerSha256:release.files[row.pointer],support,maintenanceSha256:maintenanceSha};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({sourceCommit:manifest.sourceCommit,version:manifest.version,out,files:Object.keys(packageFiles).length}));
