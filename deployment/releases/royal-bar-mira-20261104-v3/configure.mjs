import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';
const folder='deployment/releases/royal-bar-mira-20261104-v3',work='artifacts/work/royal-bar-mira/';
const before=JSON.parse(fs.readFileSync(work+'production-before.json')),production=JSON.parse(fs.readFileSync(work+'production-manifest.json'));
assert.equal(production.sourceCommit,before.sourceCommit);assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.image,before.preparedImage);assert.equal(before.container.health,'healthy');
const feature='ba74d39f91bdd0b65eb65f2540be0e9d37345ca2',base='cb446a44089129672482703d645171cc6312ab26';
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2,stdio:['ignore','pipe','ignore']});
const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n')),sha=b=>createHash('sha256').update(b).digest('hex');
const blob=(commit,name)=>canonical(git('show',commit+':'+name));
const original=JSON.parse(fs.readFileSync('deployment/releases/royal-bar-mira-20261104-v1/host-projection.json'));
const originalBackend=JSON.parse(fs.readFileSync('deployment/releases/royal-bar-mira-20261104-v1/backend-projection.json'));
const runtimeSources=['server/LobbyRoom.ts','server/bartender.ts','src/game/Bar.ts','src/game/RoomScene.ts','src/game/MiraRig.ts','src/game/miraAnimation.ts','src/game/royalBarArt.ts','src/i18n/en.ts','src/main.ts','src/shared/clubLayout.ts','src/shared/miraRoutine.ts','src/shared/world.ts','src/ui/MiraChat.ts','src/ui/MiraPortrait.ts','src/ui/SocialUI.ts'];
const own=new Set(['src/game/Bar.ts','src/game/MiraRig.ts','src/game/miraAnimation.ts','src/game/royalBarArt.ts']);
const mediaSources=['public/assets/royal-bar/v2/bar-assembly.png','public/assets/royal-bar/v2/bar-stool.png',...['walk','seat','work-corrected','react','serve'].map(key=>'public/assets/royal-bar/v3/mira-'+key+'.png')];
const scope={release:'royal-bar-mira-20261104-v3',featureCommit:feature,productionCommit:before.sourceCommit,runtimeSources,mediaSources,expectedSources:{},preservedBackendInputs:{},addedGames:[],restoredGames:[]};
const scratch=path.join(work,'production-merge-inputs');fs.mkdirSync(scratch,{recursive:true});const conflicts=[];
const resolutions=[];
function reconcile(name,text,kind){
 return text.replace(/^<<<<<<<[^\n]*\n([\s\S]*?)^\|\|\|\|\|\|\|[^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>>[^\n]*(?:\n|$)/gm,(whole,current,ancestor,feature)=>{
  let result,reason;
  if(name==='src/game/RoomScene.ts'&&current.includes('recover: commands.recover,')){
   result=current.replace('cat: commands.cat,','cat: commands.cat, miraAttention: commands.miraAttention,');reason='Preserve recovery and street commands, add Mira attention.';
  }else if(name==='src/game/RoomScene.ts'&&current.includes('this.player.stairStep=self.stairStep')){
   result=current+feature;reason='Keep authoritative stair progress and pending bar entry.';
  }else if(name==='src/i18n/en.ts'&&current.includes('...streetEnglish,')&&feature.includes("'Чат': 'Chat'")){
   result=current;reason='The current dictionary already contains the old header labels; preserve street and recovery translations.';
  }else if(name==='src/main.ts'&&current.includes('installPlayerRecoverySettings')){
   result=current;reason='Preserve the published recovery settings import.';
  }else if(name==='src/shared/world.ts'&&current.includes('export type NetworkCommands =')){
   result=current.replace('export type NetworkCommands = {','export type NetworkCommands = { miraAttention?: (phase: MiraAttention) => void;');reason='Extend the published command set without dropping recovery or stair windows.';
  }else if(name==='src/ui/SocialUI.ts'&&current.includes('this.scene.enableOnline({ recover:')){
   result=current.replace('this.scene.enableOnline({','this.scene.enableOnline({ miraAttention: phase => this.client.send(\'mira-attention\',{phase}),');reason='Add Mira attention while preserving the current online command handlers.';
  }else return whole;
  resolutions.push({kind,name,reason});return result;
 });
}
function sourceOrigin(previous,from,to){
 if(sha(from)===sha(to))return previous;
 fs.writeFileSync(path.join(scratch,'old'),from);fs.writeFileSync(path.join(scratch,'new'),to);
 const diff=spawnSync('git',['diff','--no-index','--no-ext-diff','--unified=3','--',path.join(scratch,'old'),path.join(scratch,'new')],{encoding:'utf8',maxBuffer:32*1024**2});
 assert([0,1].includes(diff.status));const patches=[];let patch;
 for(const line of diff.stdout.split('\n')){
  if(line.startsWith('@@')){patch={from:'',to:''};patches.push(patch);continue;}if(!patch)continue;
  if(line.startsWith(' ')||line.startsWith('-'))patch.from+=line.slice(1)+'\n';
  if(line.startsWith(' ')||line.startsWith('+'))patch.to+=line.slice(1)+'\n';
 }
 let check=from.toString();for(const p of patches){assert.equal(check.split(p.from).length,2,'Ambiguous merged patch');check=check.replace(p.from,p.to);}assert.equal(check,to.toString());
 return {...previous,patches:[...(previous.patches??[]),...patches],sha256:sha(to)};
}
for(const kind of ['host','backend']){
 const graph=production[kind+'Projection'],files=structuredClone(graph.origins);
 for(const [name,hash]of Object.entries(graph.inputs)){
  if(kind==='backend'&&![before.source[name],before.sourceLF[name]].includes(hash)){scope.preservedBackendInputs[name]=hash;continue;}
  assert([before.source[name],before.sourceLF[name]].includes(hash),'Production source mismatch: '+name);
 }
 for(const name of runtimeSources){
  if(kind==='host'&&name.startsWith('server/'))continue;
  if(kind==='backend'&&(!files[name]&&!/^src\/shared\//.test(name)||scope.preservedBackendInputs[name]))continue;
  const previous=files[name];let wanted;
  if(own.has(name))wanted=blob(feature,name);
  else{
   const row=(kind==='backend'?originalBackend:original).files[name];assert(row,'No reviewed feature source: '+name);
   wanted=projectHostSource(row,git('show',row.commit+':'+row.path));
   if(name==='src/game/RoomScene.ts')wanted=Buffer.from("import {preloadRoyalBarArt} from './royalBarArt';\n"+wanted.toString().replace('preload() {','preload() { preloadRoyalBarArt(this);'));
  }
  if(!previous){files[name]={commit:feature,path:name,baseSha256:sha(wanted),sha256:sha(wanted)};assert.equal(sha(blob(feature,name)),sha(wanted),'New source lacks exact Git origin');}
  else{
   const current=projectHostSource(previous,git('show',previous.commit+':'+previous.path));let ancestor;try{ancestor=blob(base,name);}catch{ancestor=Buffer.alloc(0);}
   fs.writeFileSync(path.join(scratch,'current'),current);fs.writeFileSync(path.join(scratch,'base'),ancestor);fs.writeFileSync(path.join(scratch,'feature'),wanted);
   const merge=spawnSync('git',['merge-file','-p','--diff3',path.join(scratch,'current'),path.join(scratch,'base'),path.join(scratch,'feature')],{maxBuffer:32*1024**2});
   assert(Number.isInteger(merge.status)&&merge.status>=0&&merge.status<128,'Cannot reconcile '+name);
   const merged=merge.status?reconcile(name,merge.stdout.toString(),kind):merge.stdout.toString();
   if(merged.includes('<<<<<<<')){conflicts.push({kind,name,text:merged});continue;}
   files[name]=sourceOrigin(previous,current,canonical(Buffer.from(merged)));
  }
  if(scope.expectedSources[name])assert.equal(scope.expectedSources[name],files[name].sha256,'Host/backend disagreement: '+name);
  scope.expectedSources[name]=files[name].sha256;
 }
 fs.writeFileSync(folder+'/'+kind+'-projection.json',JSON.stringify({format:1,productionCommit:before.sourceCommit,entries:kind==='host'?['index.html']:['server/index.ts'],files},null,2)+'\n');
}
fs.writeFileSync(work+'production-merge-conflicts.json',JSON.stringify(conflicts,null,2));
assert.equal(conflicts.length,0,'Inspect task-owned production-merge-conflicts.json before proceeding');
for(const name of mediaSources){assert(!before.source[name]&&!before.program[name.replace(/^public\//,'dist/')],'Asset path already published');scope.expectedSources[name]=sha(git('show',feature+':'+name));}
scope.hostRequired=runtimeSources.filter(n=>!n.startsWith('server/'));scope.backendRequired=runtimeSources.filter(n=>n.startsWith('server/')||/^src\/shared\//.test(n));scope.changedSources=Object.keys(scope.expectedSources).sort();
scope.reviewedResolutions=resolutions;
assert.equal(scope.changedSources.length,22);
fs.writeFileSync(folder+'/scope.json',JSON.stringify(scope,null,2)+'\n');
console.log(JSON.stringify({production:before.sourceCommit,changedSources:scope.changedSources.length,media:mediaSources.length,backendPreserved:scope.preservedBackendInputs}));
