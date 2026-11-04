import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const folder='deployment/releases/uniform-spin-response-20261104-v1';
const feature='cf412e52',before=JSON.parse(fs.readFileSync(process.argv[2]));
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2,stdio:['ignore','pipe','ignore']});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const commit=git('rev-parse',feature).toString().trim();
const config=JSON.parse(git('show',before.sourceCommit+':deployment/releases/manual-stakes-20261104-v1/host-projection.json'));
const files=config.files,changed=git('diff','--name-only',commit+'^',commit).toString().trim().split('\n').filter(n=>/^(src|games)\//.test(n)&&!n.endsWith('.md'));
const project=row=>{
 let value=canonical(git('show',row.commit+':'+row.path)).toString();assert.equal(hash(Buffer.from(value)),row.baseSha256);
 for(const patch of row.patches??[]){assert.equal(value.split(patch.from).length,2);value=value.replace(patch.from,patch.to);}
 assert.equal(hash(Buffer.from(value)),row.sha256);return value;
};
const special={
 'games/jackie-chan/JackieUI.ts':[["this.find('[data-recovery]').hidden=!client.pending||client.busy;","this.find('[data-recovery]').hidden=!canRecoverOperation(client);"]],
 'src/ui/LastExitUI.ts':[["this.find('[data-recovery]').hidden=!client.pending||client.busy;","this.find('[data-recovery]').hidden=!canRecoverOperation(client);"]],
 'src/ui/AfterglowUI.ts':[[":client.pending?translateText('Ход сохранён.",":canRecoverOperation(client)?translateText('Ход сохранён."],['pending:!!client.pending,busy:client.busy,hidden:','pending:!!client.pending,busy:client.busy,loading:client.loading,hidden:']],
};
const sources={};
for(const name of changed){
 const bytes=canonical(git('show',commit+':'+name));let parent;
 try{parent=canonical(git('show',commit+'^:'+name));}catch{}
 if(!before.sourceLF[name]||parent&&hash(parent)===before.sourceLF[name]){
  const digest=hash(bytes);files[name]={commit,path:name,baseSha256:digest,sha256:digest};
 }else{
  const row=files[name];assert.equal(row.sha256,before.sourceLF[name],'Published origin changed: '+name);
  let text=project(row);const first=text.slice(0,text.indexOf('\n')+1),relative=name.startsWith('games/')?'../../src/ui/operationFeedback':'./operationFeedback';
  const patches=[{from:first,to:`import {canRecoverOperation} from '${relative}';\n`+first},...(special[name]??[]).map(([from,to])=>({from,to}))];
  assert(special[name],'Unexpected unpublished source divergence: '+name);
  for(const p of patches){assert.equal(text.split(p.from).length,2,'Nonunique feature patch: '+name);text=text.replace(p.from,p.to);}
  files[name]={...row,patches:[...(row.patches??[]),...patches],sha256:hash(Buffer.from(text))};
 }
 sources[name]=files[name].sha256;
}
const motionCommit=git('rev-parse','e3cfad45').toString().trim();
for(const name of ['games/dracona/entry.ts','games/dracona/requestStyles.ts']){
 const digest=hash(canonical(git('show',motionCommit+':'+name)));
 files[name]={commit:motionCommit,path:name,baseSha256:digest,sha256:digest};sources[name]=digest;
}
const audioCommit=git('rev-parse','88a99af8').toString().trim();
for(const name of ['games/flag-battle/FlagAudio.ts','games/flag-battle/package.json','games/flag-battle/tsconfig.json']){
 const digest=hash(canonical(git('show',audioCommit+':'+name)));
 assert.equal(digest,before.sourceLF[name],'Published Flag collision audio changed: '+name);
 files[name]={commit:audioCommit,path:name,baseSha256:digest,sha256:digest};sources[name]=digest;
}
const moduleGames=['cosmic-escape','caramel-carnival','velvet-reign','last-convoy','nitro-run','girlhub','meme-overload','dracona','forest-heart','caribbean-treasures','flooded-temple','wild-nudge','flag-battle','royal-plinko','cr-vs-leo','jackie-chan','last-exit'];
const projection={format:1,productionCommit:before.sourceCommit,moduleGames,moduleContracts:before.moduleHost.games,files:Object.fromEntries(Object.entries(files).filter(([n])=>/\.(ts|js|mjs|cjs|css|json|html)$/.test(n))),moduleAssets:config.moduleAssets,moduleDependencies:config.moduleDependencies};
fs.writeFileSync(folder+'/module-projection.json',JSON.stringify(projection,null,2)+'\n');
// This committed legacy adapter is outside the selected active-module dependency graph.
delete sources['src/ui/ClusterSlotUI.ts'];
fs.writeFileSync(folder+'/scope.json',JSON.stringify({release:'uniform-spin-response-20261104-v1',featureCommit:commit,motionCommit,productionCommit:before.sourceCommit,moduleGames,sources,added:['src/ui/operationFeedback.ts','games/dracona/requestStyles.ts'],addedGames:[],restoredGames:[]},null,2)+'\n');
console.log(JSON.stringify({productionCommit:before.sourceCommit,modules:moduleGames.length,changedSources:Object.keys(sources).length,preservedSourceVariants:Object.keys(special)}));
