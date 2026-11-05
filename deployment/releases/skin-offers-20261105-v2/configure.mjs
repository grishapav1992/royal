import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/skin-offers-20261105-v2';
const capture=JSON.parse(fs.readFileSync(process.argv[2])),{before}=capture;
const feature='72aa2c851bb353f57a8514f599eb7252667aec4d';
const parent='f68a2c008a547fa8e39867cae96a9db919559e02';
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeSources=["src/game/RoomScene.ts", "src/game/ToiletRenderer.ts", "src/game/ToiletMerchant.ts", "src/game/toiletMerchantPose.ts", "src/shared/toilet.ts", "src/shared/skinStudio.ts", "src/ui/SkinStudioUI.ts", "src/ui/skin-studio.css", "src/i18n/en.ts", "docs/concepts/toilet-janitor-animations/animations-v1.json", "server/accounts.ts", "server/demoWalletAmounts.ts", "server/skinPayments.ts", "server/skinStudio.ts", "server/skinStudioRoutes.ts", "src/game/CasinoStreetExit.ts"];
const mediaSources=["public/assets/toilet/royal-janitor-v1-90a698e1d019.png"];
const scope={release:'skin-offers-20261105-v2',featureCommit:feature,productionCommit:before.sourceCommit,changedSources:[...runtimeSources,...mediaSources],mediaSources,expectedSources:{},preservedBackendInputs:{},addedGames:[],restoredGames:[]};
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
  if(kind==='backend'&&!["server/accounts.ts", "server/demoWalletAmounts.ts", "server/skinPayments.ts", "server/skinStudio.ts", "server/skinStudioRoutes.ts", "src/shared/toilet.ts", "src/shared/skinStudio.ts"].includes(name))continue;
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
     const queue=[change],seen=new Set();let exact;
     while(queue.length){
      const candidate=queue.shift(),key=JSON.stringify(candidate);if(seen.has(key))continue;seen.add(key);
      if(candidate.from.trim()&&text.split(candidate.from).length===2){exact=candidate;break;}
      const from=candidate.from.split('\n'),to=candidate.to.split('\n');
      if(from.length>2&&from[0]===to[0])queue.push({from:from.slice(1).join('\n'),to:to.slice(1).join('\n')});
      if(from.length>2&&from.at(-2)===to.at(-2))queue.push({from:[...from.slice(0,-2),''].join('\n'),to:[...to.slice(0,-2),''].join('\n')});
     }
     if(!exact&&name==='src/game/RoomScene.ts'&&change.from.includes('  preload() {')&&change.from.includes('preloadToiletResident(this);')){
      const inline={from:'  preload() { preloadToiletResident(this); preloadRoyalBarArt(this);\n',to:'  preload() { preloadToiletResident(this); preloadToiletMerchant(this); preloadRoyalBarArt(this);\n'};
      assert.equal(text.split(inline.from).length,2,'Production preload layout differs');exact=inline;
     }
     assert(exact,'Feature patch does not apply exactly once: '+name+' '+JSON.stringify(change.from));
     Object.assign(change,exact);
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
