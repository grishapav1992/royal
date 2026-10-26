import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('dist-server',{recursive:true});
const result=spawnSync(process.env.ROYAL_GO_BINARY||'go',['build','-trimpath','-o',resolve('dist-server/card-engine'),'.'],{
  cwd:'server/card-engine',stdio:'inherit',env:{...process.env,CGO_ENABLED:'0',GOENV:'off',GOTOOLCHAIN:'local'},
});
if(result.error)console.error('Go runtime is required to build the card engine. Set ROYAL_GO_BINARY to its executable path.');
process.exit(result.status??1);
