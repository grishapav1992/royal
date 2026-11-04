import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';
const folder='deployment/releases/player-recovery-20261104-v2';
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
const sha=b=>createHash('sha256').update(b).digest('hex');
const before=JSON.parse(fs.readFileSync('artifacts/work/player-unstuck/v2/before.json'));
const host=JSON.parse(fs.readFileSync('artifacts/work/player-unstuck/v2/host-manifest.json')).hostProjection;
const backend=JSON.parse(fs.readFileSync('artifacts/work/player-unstuck/v2/production-manifest.json')).backendProjection;
const feature=git('rev-parse',process.argv[2]||'60834b76').toString().trim(),parent=git('rev-parse','8807b3d4^').toString().trim();
const styleCommit='a23da60dd62d4323f68e3f9809120e73d5106257';
const sources=git('diff','--name-only',parent,feature).toString().trim().split('\n').filter(p=>p.startsWith('src/')||p.startsWith('server/'));
function patches(name){
  const lines=git('diff','--unified=3',parent,feature,'--',name).toString().split('\n'),result=[];
  let patch;
  for(const line of lines){
    if(line.startsWith('@@')){patch={from:'',to:''};result.push(patch);continue;}
    if(!patch)continue;
    if(line.startsWith(' ')||line.startsWith('-'))patch.from+=line.slice(1)+'\n';
    if(line.startsWith(' ')||line.startsWith('+'))patch.to+=line.slice(1)+'\n';
  }
  return result;
}
const scope={release:'player-recovery-20261104-v2',featureCommit:feature,productionCommit:before.sourceCommit,changedSources:sources,expectedSources:{},preservedBackendInputs:{'src/i18n/en.ts':backend.inputs['src/i18n/en.ts']},addedGames:[],restoredGames:[]};
for(const [kind,graph]of [['host',host],['backend',backend]]){
  const files=structuredClone(graph.origins);
  for(const [name,hash]of Object.entries(graph.inputs)){
    if(kind==='backend'&&scope.preservedBackendInputs[name])continue;
    assert([before.source[name],before.sourceLF[name]].includes(hash),'Baseline source differs: '+name);
  }
  for(const name of sources){
    if(kind==='host'&&name.startsWith('server/'))continue;
    if(kind==='backend'&&(!files[name]&&!['src/shared/playerRecovery.ts'].includes(name)||name==='src/i18n/en.ts'))continue;
    const previous=files[name];
    if(!previous){
      const revision=name==='src/ui/player-recovery.css'?styleCommit:feature,bytes=git('show',revision+':'+name),hash=sha(bytes);
      files[name]={commit:revision,path:name,baseSha256:hash,sha256:hash};scope.expectedSources[name]=hash;continue;
    }
    const bytes=projectHostSource(previous,git('show',previous.commit+':'+previous.path));
    let text=bytes.toString();const changes=patches(name);
    if(name==='src/main.ts')changes[0]={from:"import './i18n/paymentMethodsEn';",to:"import { installPlayerRecoverySettings } from './ui/PlayerRecoverySettings';\nimport './i18n/paymentMethodsEn';"};
    for(const patch of changes){
      while(text.split(patch.from).length!==2){
        const from=patch.from.split('\n'),to=patch.to.split('\n');
        if(from[0]===to[0]&&from.length>2){from.shift();to.shift();}
        else if(from.at(-2)===to.at(-2)&&from.length>2){from.splice(-2,1);to.splice(-2,1);}
        else {
          const a=patch.from,b=patch.to;let start=0,end=0;
          while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
          while(end<Math.min(a.length,b.length)-start&&a.at(-1-end)===b.at(-1-end))end++;
          const prefix=a.slice(Math.max(0,start-80),start),suffix=a.slice(a.length-end,a.length-end+40);
          const anchor=prefix.trim()?prefix:'';
          patch.from=anchor+a.slice(start,a.length-end)+(anchor?'':suffix);
          patch.to=anchor+b.slice(start,b.length-end)+(anchor?'':suffix);
          assert(patch.from&&text.split(patch.from).length===2,'Feature patch does not apply to production: '+name+' '+patch.from);
          break;
        }
        patch.from=from.join('\n');patch.to=to.join('\n');
      }
      text=text.replace(patch.from,patch.to);
    }
    const hash=sha(Buffer.from(text));files[name]={...previous,patches:[...(previous.patches??[]),...changes],sha256:hash};
    if(scope.expectedSources[name])assert.equal(scope.expectedSources[name],hash,'Host/backend source differs: '+name);
    scope.expectedSources[name]=hash;
  }
  fs.writeFileSync(folder+'/'+kind+'-projection.json',JSON.stringify({format:1,productionCommit:before.sourceCommit,entries:kind==='host'?['index.html']:['server/index.ts'],files},null,2)+'\n');
}
fs.writeFileSync(folder+'/scope.json',JSON.stringify(scope,null,2)+'\n');
console.log(JSON.stringify({base:before.sourceCommit,sources:scope.expectedSources}));

let installer=fs.readFileSync(folder+'/deploy.py','utf8');
installer=installer.replace(/^PRESERVED_BACKEND_INPUTS = .*$/m,'PRESERVED_BACKEND_INPUTS = '+JSON.stringify(scope.preservedBackendInputs));
fs.writeFileSync(folder+'/deploy.py',installer);
