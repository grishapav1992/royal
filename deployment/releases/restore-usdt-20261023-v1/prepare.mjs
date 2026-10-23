import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{encoding:'utf8'}).trim();
if(git('status','--porcelain','--untracked-files=normal'))throw Error('Requires a clean committed checkout');
git('fetch','origin');
git('merge-base','--is-ancestor','HEAD','origin/main');
const commit=git('rev-parse','HEAD');
const destination=path.resolve('../payload');
await mkdir(destination,{recursive:true});
const sha=data=>createHash('sha256').update(data).digest('hex');
const inputs={},payload={},source={};
for(const [entry,output] of [['scripts/finance-nile-play.ts','nile-play.js'],['scripts/finance-nile-reconcile.ts','nile-reconcile.js']]){
 const result=await build({entryPoints:[entry],bundle:true,platform:'node',external:['pg','pg-native'],format:'esm',outfile:'dist-server/'+output,metafile:true});
 for(const name of Object.keys(result.metafile.inputs))if(!name.startsWith('../')&&!name.startsWith('node_modules/'))inputs[name]=sha((await readFile(name,'utf8')).replaceAll('\r\n','\n'));
 await copyFile('dist-server/'+output,path.join(destination,output));
 payload[output]=sha(await readFile(path.join(destination,output)));
}
for(const name of ['package.json','package-lock.json'])inputs[name]=sha((await readFile(name,'utf8')).replaceAll('\r\n','\n'));
for(const name of ['server/finance/nile-play-ledger.ts','server/finance/nile-test-reconciliation.ts','scripts/finance-nile-play.ts','server/finance/source-refresh.ts']){
 await mkdir(path.dirname(path.join(destination,'source',name)),{recursive:true});
 await copyFile(name,path.join(destination,'source',name));
 source[name]=sha(await readFile(name));
 payload['source/'+name]=source[name];
}
for(const name of ['deploy.py','snapshot.py']){
 await copyFile('deployment/releases/restore-usdt-20261023-v1/'+name,path.join(destination,name));
 payload[name]=sha(await readFile(path.join(destination,name)));
}
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({sourceCommit:commit,githubVerified:true,inputs,source,payload},null,2)+'\n');
console.log(JSON.stringify({sourceCommit:commit,inputs:Object.keys(inputs).length,destination}));
