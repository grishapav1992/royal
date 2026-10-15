import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('dist-server',{recursive:true});
for(const [source,target] of [['server/card-engine','card-engine'],['server/card-engine-v1','card-engine-v1']]) {
  const result=spawnSync(process.env.ROYAL_GO_BINARY||'go',['build','-trimpath','-o',resolve('dist-server/'+target),'.'],{
    cwd:source,stdio:'inherit',env:{...process.env,CGO_ENABLED:'0',GOENV:'off',GOTOOLCHAIN:'local'},
  });
  if(result.error)console.error('Go runtime is required to build the card engine. Set ROYAL_GO_BINARY to its executable path.');
  if(result.status!==0)process.exit(result.status??1);
}
