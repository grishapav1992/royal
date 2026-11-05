import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/mira-counter-rest-20261105-v1';
const capture=JSON.parse(fs.readFileSync(process.argv[2])),{before}=capture;
const feature='90ef9d9dfc3161866b7d563fabe0f21a0d84cf07';
const parent='920fb6e68df12aadc4d145876d03e36fbe143f5d';
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeSources=["src/game/MiraRig.ts","src/game/miraAnimation.ts","src/game/royalBarArt.ts","src/game/royalBarLayers.ts","src/shared/miraRoutine.ts"];
const mediaSources=[];
const scope={release:'mira-counter-rest-20261105-v1',featureCommit:feature,productionCommit:before.sourceCommit,changedSources:[...runtimeSources,...mediaSources],mediaSources,expectedSources:{},preservedBackendInputs:{},addedGames:[],restoredGames:[]};
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
  if(kind==='backend'&&name!=='src/shared/miraRoutine.ts')continue;
  const previous=files[name],updated=canonical(git('show',feature+':'+name));
  if(!previous){
   assert(!(name in before.source),'Existing unreviewed input: '+name);
   files[name]={commit:feature,path:name,baseSha256:sha(updated),sha256:sha(updated)};
  }else{
   const bytes=projectHostSource(previous,git('show',previous.commit+':'+previous.path)),base=canonical(git('show',parent+':'+name));
   if(sha(bytes)===sha(base))files[name]={commit:feature,path:name,baseSha256:sha(updated),sha256:sha(updated)};
   else{
    let text=bytes.toString();const changes=patches(name);assert(changes.length,'No feature patch: '+name);
    for(const change of changes){
     while(text.split(change.from).length!==2){
      const from=change.from.split('\n'),to=change.to.split('\n');
      if(from.length>2&&from[0]===to[0]){from.shift();to.shift();}
      else if(from.length>2&&from.at(-2)===to.at(-2)){from.splice(-2,1);to.splice(-2,1);}
      else throw Error('Feature patch does not apply exactly once: '+name);
      change.from=from.join('\n');change.to=to.join('\n');
     }
     text=text.replace(change.from,change.to);
    }
    files[name]={...previous,patches:[...(previous.patches??[]),...changes],sha256:sha(Buffer.from(text))};
   }
  }
  if(scope.expectedSources[name])assert.equal(scope.expectedSources[name],files[name].sha256,'Host/backend input differs');
  scope.expectedSources[name]=files[name].sha256;
 }
 fs.writeFileSync(folder+'/'+kind+'-projection.json',JSON.stringify({format:1,productionCommit:before.sourceCommit,entries:kind==='host'?['index.html']:['server/index.ts'],files},null,2)+'\n');
}
for(const name of mediaSources)scope.expectedSources[name]=sha(git('show',feature+':'+name));
assert.deepEqual(Object.keys(scope.expectedSources).sort(),scope.changedSources.toSorted());
fs.writeFileSync(folder+'/scope.json',JSON.stringify(scope,null,2)+'\n');
console.log(JSON.stringify({productionCommit:before.sourceCommit,runtimeFiles:runtimeSources.length,mediaFiles:mediaSources.length}));
