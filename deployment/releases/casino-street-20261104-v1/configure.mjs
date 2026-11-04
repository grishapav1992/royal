import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/casino-street-20261104-v1';
const [beforeFile,productionFile,featureRevision='HEAD',baseRevision='origin/main',reviewFolder,backendManifestFile]=process.argv.slice(2);
assert(beforeFile&&productionFile&&reviewFolder,'Specify baseline, production manifest, feature, base and task-owned review folder');
const gitBinary=process.env.ROYAL_GIT_BINARY||'git';
const git=(...args)=>execFileSync(gitBinary,args,{maxBuffer:64*1024**2});
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
const before=JSON.parse(fs.readFileSync(beforeFile)),production=JSON.parse(fs.readFileSync(productionFile));
assert.equal(production.sourceCommit,before.sourceCommit);
assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.image,before.preparedImage);assert.equal(before.container.health,'healthy');
if(!production.backendProjection){
  assert(backendManifestFile,'The retained compiled backend needs its original manifest');
  const retained=JSON.parse(fs.readFileSync(backendManifestFile));
  assert.equal(retained.files['dist-server/index.js'],before.program['dist-server/index.js'],'Retained backend is no longer published');
  assert.equal(retained.backendProjection.output.sha256,before.program['dist-server/index.js']);
  production.backendProjection=retained.backendProjection;
}
const feature=git('rev-parse',featureRevision).toString().trim(),base=git('rev-parse',baseRevision).toString().trim();
git('merge-base','--is-ancestor',base,feature);
const sources=git('diff','--name-only',base,feature,'--','src','server').toString().trim().split('\n').filter(Boolean);
assert(sources.length>20&&sources.every(p=>/^(src|server)\/.+\.(ts|css)$/.test(p)),'Unexpected street feature scope');
fs.mkdirSync(reviewFolder,{recursive:true});
const scratch=path.join(reviewFolder,'merge-inputs');fs.mkdirSync(scratch,{recursive:true});
const conflicts=[],results={},expectedSources={},preservedBackendInputs={},reviewedResolutions=[];
function resolveReviewed(name,text,kind){
  return text.replace(/^<<<<<<< [^\n]*\n([\s\S]*?)^\|\|\|\|\|\|\| [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*(?:\n|$)/gm,(whole,current,base,feature)=>{
    let result,reason;
    if(name==='src/game/RoomScene.ts'&&current.includes('recover: commands.recover,')){
      result=current.replace('recover: commands.recover,','recover: commands.recover, stairWindow: commands.stairWindow,');reason='Add the requested window action, preserving the production command set.';
    }else if(name==='src/game/RoomScene.ts'&&!current&&base.includes("this.pendingLounge === 'bar'")){
      result='      if(!this.prediction.active){this.player.stairStep=self.stairStep??0;this.player.stairDirection=self.stairDirection??1;}\n';reason='Restore stair progress without adding the unpublished bar-attention approach.';
    }else if(name==='src/game/avatarArt.ts'&&!current&&feature.includes('const frontalBody')){
      result=current;reason='Keep the published frontal drawing; its separate animation release is outside this scope.';
    }else if(name==='src/game/avatarArt.ts'&&current.includes('arm(false)')&&feature.includes('parts?.afterHead?.(c)')){
      result='  parts?.afterHead?.(c);\n'+current;reason='Add the tourist camera grip layer while retaining the published arm drawing.';
    }else if(name==='src/i18n/en.ts'&&current.includes("'Чат'")&&feature.includes('...streetEnglish')){
      result=current+feature;reason='Preserve published chat labels and add only the street translations.';
    }else if(name==='src/shared/world.ts'&&current.includes('export type NetworkCommands =')){
      result=current.replace('recover?: () => Promise<boolean>;','recover?: () => Promise<boolean>; stairWindow?: () => void;');reason='Add the requested stair-window command without adding unpublished command contracts.';
    }else if(name==='src/ui/SocialUI.ts'&&current.includes('this.scene.enableOnline(')){
      result=current.replace('elevator: target =>','stairWindow: () => { this.client.send(\'stair-window\'); }, elevator: target =>');reason='Wire the window action while preserving the current online controls.';
    }else return whole;
    assert.notEqual(result,undefined);reviewedResolutions.push({kind,path:name,reason});return result;
  });
}
function blob(commit,name){return canonical(git('show',commit+':'+name));}
function previousRow(name,kind){
  const direct=production[kind+'Projection'].origins[name];if(direct)return direct;
  const other=production[kind==='host'?'backendProjection':'hostProjection'].origins[name];if(other)return other;
  if(!before.source[name])return;
  const revisions=[before.sourceCommit,...git('log','--format=%H','--all','--',name).toString().trim().split('\n')];
  for(const revision of [...new Set(revisions)]){try{const bytes=blob(revision,name),hash=sha(bytes);if(hash===before.sourceLF[name])return {commit:revision,path:name,baseSha256:hash,sha256:hash};}catch{}}
  throw Error('No committed origin for production source '+name);
}
function patches(from,to){
  fs.writeFileSync(path.join(scratch,'old'),from);fs.writeFileSync(path.join(scratch,'new'),to);
  const diff=spawnSync(gitBinary,['diff','--no-index','--no-ext-diff','--unified=3','--',path.join(scratch,'old'),path.join(scratch,'new')],{encoding:'utf8',maxBuffer:32*1024**2});
  assert([0,1].includes(diff.status),'Cannot compare projected source');
  const result=[];let patch;
  for(const line of diff.stdout.split('\n')){
    if(line.startsWith('@@')){patch={from:'',to:''};result.push(patch);continue;}
    if(!patch)continue;
    if(line.startsWith(' ')||line.startsWith('-'))patch.from+=line.slice(1)+'\n';
    if(line.startsWith(' ')||line.startsWith('+'))patch.to+=line.slice(1)+'\n';
  }
  let checked=from.toString();for(const p of result){assert(p.from&&checked.split(p.from).length===2,'Ambiguous source patch');checked=checked.replace(p.from,p.to);}
  assert.equal(checked,to.toString(),'Patch reconstruction differs');return result;
}
for(const kind of ['host','backend']){
  const graph=production[kind+'Projection'],files=structuredClone(graph.origins),changed=[];
  for(const [name,hash]of Object.entries(graph.inputs)){
    if(kind==='backend'&&![before.source[name],before.sourceLF[name]].includes(hash)){preservedBackendInputs[name]=hash;continue;}
    assert([before.source[name],before.sourceLF[name]].includes(hash),'Production source no longer matches '+name);
  }
  for(const name of sources){
    if(kind==='host'&&name.startsWith('server/'))continue;
    if(kind==='backend'&&(preservedBackendInputs[name]||(!files[name]&&!/^src\/shared\//.test(name))))continue;
    const previous=previousRow(name,kind),wanted=blob(feature,name);
    if(!previous){const hash=sha(wanted);files[name]={commit:feature,path:name,baseSha256:hash,sha256:hash};expectedSources[name]=hash;changed.push(name);continue;}
    const old=projectHostSource(previous,blob(previous.commit,previous.path));
    fs.writeFileSync(path.join(scratch,'current'),old);fs.writeFileSync(path.join(scratch,'base'),blob(base,name));fs.writeFileSync(path.join(scratch,'feature'),wanted);
    const merged=spawnSync(gitBinary,['merge-file','-p','--diff3',path.join(scratch,'current'),path.join(scratch,'base'),path.join(scratch,'feature')],{maxBuffer:32*1024**2});
    assert(Number.isInteger(merged.status)&&merged.status>=0&&merged.status<128,'Source merge failed: '+name);
    const text=merged.status>0?resolveReviewed(name,merged.stdout.toString(),kind):merged.stdout.toString();
    if(text.includes('<<<<<<<')){conflicts.push({kind,name,status:merged.status,text,old:old.toString()});continue;}
    const bytes=canonical(Buffer.from(text)),hash=sha(bytes);
    files[name]={...previous,patches:[...(previous.patches??[]),...patches(old,bytes)],sha256:hash};
    if(expectedSources[name])assert.equal(expectedSources[name],hash,'Host/backend source mismatch: '+name);
    expectedSources[name]=hash;changed.push(name);
  }
  results[kind]={format:1,productionCommit:before.sourceCommit,entries:kind==='host'?['index.html']:['server/index.ts'],files};
}
fs.writeFileSync(path.join(reviewFolder,'merge-conflicts.json'),JSON.stringify(conflicts,null,2)+'\n');
if(conflicts.length){console.log(JSON.stringify({conflicts:conflicts.map(c=>({kind:c.kind,name:c.name}))}));process.exitCode=2;}
else{
  assert(sources.every(name=>expectedSources[name]),'Feature source omitted from both projections');
  for(const kind of ['host','backend'])fs.writeFileSync(folder+'/'+kind+'-projection.json',JSON.stringify(results[kind],null,2)+'\n');
  const scope={release:'casino-street-20261104-v1',productionCommit:before.sourceCommit,featureCommit:feature,featureBase:base,changedSources:sources,expectedSources,preservedBackendInputs,reviewedResolutions,addedGames:[],restoredGames:[]};
  fs.writeFileSync(folder+'/scope.json',JSON.stringify(scope,null,2)+'\n');
  console.log(JSON.stringify({base:before.sourceCommit,feature,featureBase:base,sources:sources.length,hostInputs:Object.keys(results.host.files).length,backendInputs:Object.keys(results.backend.files).length,preservedBackendInputs}));
}
for(const name of fs.readdirSync(scratch))fs.unlinkSync(path.join(scratch,name));fs.rmdirSync(scratch);
