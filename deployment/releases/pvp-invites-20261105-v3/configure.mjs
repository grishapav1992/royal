import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/pvp-invites-20261105-v3';
const capture=JSON.parse(fs.readFileSync(process.argv[2]));
const {before}=capture;
const feature='f39d48910bb7189cb721256b48effc67f0477cbd';
const parent='b5eba82a6b0aa91b4548abc7c9385c9d1b798f60';
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeSources=['server/pvp/store.ts','src/shared/pvp.ts','src/ui/GameChat.ts','src/ui/PlayerDuelMenu.ts','src/ui/PvpUI.ts','src/ui/pvp-invitations.css'];
const evidenceSources=[...['chess-virtual-v1','crazy-eights-virtual-v1','durak-virtual-v1','hockey-virtual-v1','mortal-kombat-v2','pool-virtual-v1','transfer-durak-virtual-v1','tsu-e-fa-v1','tsu-e-fa-v2','tsu-e-fa-v3','tsu-e-fa-v4'].map(name=>'docs/game-math/qualifications/'+name+'.json'),'scripts/game-math/tsu-duel-wallet.ts'];
const scope={release:'pvp-invites-20261105-v3',featureCommit:feature,productionCommit:before.sourceCommit,runtimeSources,expectedSources:{},evidenceSources:{},preservedBackendInputs:{},addedGames:[],restoredGames:[]};

function patches(name){
 const result=[];let patch;
 for(const line of git('diff','--unified=3',parent,feature,'--',name).toString().split('\n')){
  if(line.startsWith('@@')){patch={from:'',to:''};result.push(patch);continue;}
  if(!patch)continue;
  if(line.startsWith(' ')||line.startsWith('-'))patch.from+=line.slice(1)+'\n';
  if(line.startsWith(' ')||line.startsWith('+'))patch.to+=line.slice(1)+'\n';
 }
 return result;
}
for(const [kind,graph]of [['host',capture.host.hostProjection],['backend',capture.backend.backendProjection]]){
 const files=structuredClone(graph.origins);
 for(const [name,hash]of Object.entries(graph.inputs)){
  if(kind==='backend'&&name==='src/i18n/en.ts'){scope.preservedBackendInputs[name]=hash;continue;}
  assert([before.source[name],before.sourceLF[name]].includes(hash),'Production origin differs: '+name);
 }
 for(const name of runtimeSources){
  if(kind==='host'&&name.startsWith('server/'))continue;
  if(kind==='backend'&&!files[name])continue;
  const previous=files[name];assert(previous,'Missing production input: '+name);
  const bytes=projectHostSource(previous,git('show',previous.commit+':'+previous.path));
  const base=canonical(git('show',parent+':'+name));
  const updated=canonical(git('show',feature+':'+name));
  if(sha(bytes)===sha(base))files[name]={commit:feature,path:name,baseSha256:sha(updated),sha256:sha(updated)};
  else{
   let text=bytes.toString();const changes=patches(name);
   assert(changes.length,'No feature patch: '+name);
   for(const change of changes){
    while(text.split(change.from).length!==2){
     const from=change.from.split('\n'),to=change.to.split('\n');
     if(from.length>2&&from[0]===to[0]){from.shift();to.shift();}
     else if(from.length>2&&from.at(-2)===to.at(-2)){from.splice(-2,1);to.splice(-2,1);}
     else throw Error('Feature patch does not apply exactly once: '+name+' '+change.from.slice(0,120));
     change.from=from.join('\n');change.to=to.join('\n');
    }
    text=text.replace(change.from,change.to);
   }
   files[name]={...previous,patches:[...(previous.patches??[]),...changes],sha256:sha(Buffer.from(text))};
  }
  if(scope.expectedSources[name])assert.equal(scope.expectedSources[name],files[name].sha256,'Host/backend input differs');
  scope.expectedSources[name]=files[name].sha256;
 }
 fs.writeFileSync(folder+'/'+kind+'-projection.json',JSON.stringify({format:1,productionCommit:before.sourceCommit,entries:kind==='host'?['index.html']:['server/index.ts'],files},null,2)+'\n');
}
assert.deepEqual(Object.keys(scope.expectedSources).sort(),runtimeSources.toSorted());
for(const name of evidenceSources)scope.evidenceSources[name]=sha(canonical(git('show',feature+':'+name)));
const sourceHashes={...before.sourceLF,...scope.expectedSources,...scope.evidenceSources};
for(const file of evidenceSources.filter(name=>name.endsWith('.json'))){
 const proof=JSON.parse(git('show',feature+':'+file));
 for(const [name,hash]of Object.entries(proof.sourceHashes))assert.equal(sourceHashes[name],hash,'Qualification does not bind actual production source: '+file+' '+name);
}
fs.writeFileSync(folder+'/scope.json',JSON.stringify(scope,null,2)+'\n');
console.log(JSON.stringify({productionCommit:before.sourceCommit,runtimeFiles:runtimeSources.length,evidenceFiles:evidenceSources.length}));
