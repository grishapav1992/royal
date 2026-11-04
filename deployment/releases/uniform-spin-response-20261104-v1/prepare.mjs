import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyRelease,assertClean} from '../../../scripts/release.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/uniform-spin-response-20261104-v1';
const [beforeFile,publishedFile,helpersFile,reportFile,outDir]=process.argv.slice(2);
assert(outDir);assertClean(process.cwd());const release=await verifyRelease(process.cwd());
const before=JSON.parse(fs.readFileSync(beforeFile)),published=JSON.parse(fs.readFileSync(publishedFile)),helpers=JSON.parse(fs.readFileSync(helpersFile));
const scope=JSON.parse(fs.readFileSync(folder+'/scope.json')),report=JSON.parse(fs.readFileSync(reportFile));
assert.equal(report.stats.unexpected,0);assert.equal(report.stats.expected,3);assert.deepEqual(report.errors,[]);
assert.equal(release.scope,'modules');assert.deepEqual(release.modules,scope.moduleGames);assert.equal(release.baseCommit,before.sourceCommit);
const reader=await readHostProjection(process.cwd(),folder+'/module-projection.json',{strictOrigins:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert(!fs.existsSync(outDir));fs.mkdirSync(outDir,{recursive:true});
const put=(name,bytes)=>{assert(!path.isAbsolute(name)&&!name.split('/').some(p=>p==='..'||p.startsWith('.env')));const target=path.join(outDir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return hash(bytes);};
const copy=name=>put(name,fs.readFileSync(name));
put('before.json',fs.readFileSync(beforeFile));put('publish.py',fs.readFileSync(folder+'/publish.py'));put('publisher.py',fs.readFileSync('scripts/game-module-release.py'));
put('release-manifest.json',fs.readFileSync('module-build/release-manifest.json'));put('release-github.json',fs.readFileSync('module-build/release-github.json'));
const receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));assert.equal(receipt.sourceCommit,release.sourceCommit);
const source={};for(const [name,digest]of Object.entries(scope.sources)){const bytes=reader.read(name);assert.equal(hash(bytes),digest);source[name]=put('source/'+name,bytes);}
const packages={},beforePointers={},games={};
for(const row of release.packages){
 const game=row.gameId,pointer=JSON.parse(fs.readFileSync(row.pointer)),prefix=pointer.manifest.replace('/game-modules/','module-dist/');
 const manifest=JSON.parse(fs.readFileSync(prefix)),files={'manifest.json':hash(fs.readFileSync(prefix)),...manifest.files};
 const old=published[game];assert(old);beforePointers[game]=before.moduleFiles['/opt/royal-game-modules/'+game+'/active.json'];assert.equal(old.pointerSha256,beforePointers[game]);
 const contract=Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(k=>[k,manifest[k]]));assert.deepEqual(contract,before.moduleHost.games[game]);
 packages[game]={version:manifest.version,files,pointerSha256:release.files[row.pointer]};
 for(const [name,digest]of Object.entries(files)){
  const from=path.join(path.dirname(prefix),name),target=path.join(outDir,'packages',game,name);assert.equal(hash(fs.readFileSync(from)),digest);assert.equal(release.files[path.dirname(prefix).replaceAll('\\','/')+'/'+name],digest);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.linkSync(from,target);
 }
 games[game]={kind:'request-feedback',passed:true,beforeManifest:old.pointer.sha256,afterManifest:files['manifest.json'],beforeEntry:old.manifest.files[old.manifest.entry],afterEntry:manifest.files[manifest.entry],browserReportSha256:hash(fs.readFileSync(reportFile))};
}
const proof={sourceCommit:release.sourceCommit,games,checks:{activeHouseGames:19,desktopAndPhone:true,sameOperationRecovery:true,oneTenCentDebit:true,browserReportSha256:hash(fs.readFileSync(reportFile))}};
put('program-proof.json',JSON.stringify(proof,null,2)+'\n');
const operator={sourceCommit:release.sourceCommit,source,packages,beforePointers,wrapperSha256:hash(fs.readFileSync(folder+'/publish.py')),publisherSha256:hash(fs.readFileSync('scripts/game-module-release.py')),releaseManifestSha256:hash(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:hash(fs.readFileSync('module-build/release-github.json')),programProofSha256:hash(fs.readFileSync(path.join(outDir,'program-proof.json'))),snapshotSha256:helpers.snapshotSha256,imageHelperSha256:helpers.imageHelperSha256};
put('operator.json',JSON.stringify(operator,null,2)+'\n');console.log(JSON.stringify({sourceCommit:release.sourceCommit,modules:Object.keys(packages).length,sources:Object.keys(source).length,outDir}));
