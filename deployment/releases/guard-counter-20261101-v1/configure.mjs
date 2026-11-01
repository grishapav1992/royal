import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

const root=process.cwd(),folder=path.dirname(fileURLToPath(import.meta.url));
const before=JSON.parse(fs.readFileSync(process.argv[2]));
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024**2});
const changes={
 'host':{file:'src/i18n/en.ts',from:'"Ещё один толчок, и на выход. 9/10.": "One more bump and you are out. 9/10."',to:'"Ещё один толчок, и на выход.": "One more bump and you are out."',prior:'compact-header-20261101-v1'},
 'backend':{file:'server/guards.ts',from:"g.speech=count===9?'Ещё один толчок, и на выход. 9/10.':`Не толкайся. ${count}/10.`;",to:"g.speech=count===9?'Ещё один толчок, и на выход.':'Не толкайся.';",prior:'shared-stakes-20261101-v1'},
};
for(const [kind,change]of Object.entries(changes)){
 const prior=JSON.parse(fs.readFileSync(path.join(folder,'..',change.prior,kind+'-projection.json')));
 const row=prior.files[change.file];
 const old=projectHostSource(row,git('show',row.commit+':'+row.path));
 assert.equal(digest(old),before.sourceLF[change.file],'Production source differs: '+change.file);
 assert.equal(old.toString().split(change.from).length,2,'Speech patch must match once');
 const next=Buffer.from(old.toString().replace(change.from,change.to));
 prior.files[change.file]={...row,patches:[...(row.patches??[]),{from:change.from,to:change.to}],sha256:digest(next)};
 for(const name of ['moduleGames','moduleContracts','moduleAssets'])delete prior[name];
 prior.productionCommit=before.sourceCommit;
 prior.changedSources=Object.values(changes).map(change=>change.file);
 fs.writeFileSync(path.join(folder,kind+'-projection.json'),JSON.stringify(prior,null,2)+'\n');
}
fs.writeFileSync(path.join(folder,'scope.json'),JSON.stringify({release:'guard-counter-20261101-v1',productionCommit:before.sourceCommit,featureCommit:'44195a79e12be5754828abb5c1c58c65c0d90b35',changedSources:Object.values(changes).map(change=>change.file),backendChanges:['dist-server/index.js'],moduleChanges:[],addedGames:[],restoredGames:[]},null,2)+'\n');
console.log(JSON.stringify({productionCommit:before.sourceCommit,changedSources:Object.values(changes).map(change=>change.file)}));
