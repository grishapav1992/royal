import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/remove-room-labels-20261105-v1';
const {before,host}=JSON.parse(fs.readFileSync(process.argv[2]));
const feature='0d7c862b';
const parent='920fb6e68df12aadc4d145876d03e36fbe143f5d';
const sources=['src/game/RoomScene.ts','src/i18n/en.ts','src/main.ts','src/ui/compact-header.css'];
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
const canonical=bytes=>Buffer.from(bytes.toString().replace(/\r\n/g,'\n'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=structuredClone(host.hostProjection.origins);
assert.deepEqual(before.program,before.preparedProgram);
assert.equal(before.container.image,before.preparedImage);
for(const [name,hash]of Object.entries(host.hostProjection.inputs))assert([before.source[name],before.sourceLF[name]].includes(hash),'Production origin differs: '+name);
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
const scope={productionCommit:before.sourceCommit,featureCommit:feature,expectedSources:{},addedGames:[],restoredGames:[]};
for(const name of sources){
  const previous=files[name];assert(previous,'Missing published source: '+name);
  const bytes=projectHostSource(previous,git('show',previous.commit+':'+previous.path));
  const baseline=canonical(git('show',parent+':'+name));
  const updated=canonical(git('show',feature+':'+name));
  if(sha(bytes)===sha(baseline))files[name]={commit:feature,path:name,baseSha256:sha(updated),sha256:sha(updated)};
  else{
    let text=bytes.toString();const changes=patches(name);assert(changes.length);
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
  scope.expectedSources[name]=files[name].sha256;
}
fs.writeFileSync(folder+'/host-projection.json',JSON.stringify({format:1,productionCommit:before.sourceCommit,entries:['index.html'],files},null,2)+'\n');
fs.writeFileSync(folder+'/scope.json',JSON.stringify(scope,null,2)+'\n');
console.log(JSON.stringify({base:before.sourceCommit,inputs:Object.keys(files).length,changes:scope.expectedSources}));
