import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{encoding:'utf8'}).trim();
if(git('status','--porcelain','--untracked-files=normal'))throw Error('Financial bundle requires a clean committed checkout');
const result=await build({entryPoints:['scripts/finance-nile-play.ts'],bundle:true,platform:'node',external:['pg','pg-native'],format:'esm',outfile:'dist-server/nile-play.js',metafile:true});
await mkdir('artifacts/work/mortal-kombat-duel',{recursive:true});
await writeFile('artifacts/work/mortal-kombat-duel/financial-meta.json',JSON.stringify({...result.metafile,sourceCommit:git('rev-parse','HEAD')},null,2)+'\n');
console.log('Financial bundle and input inventory saved');
