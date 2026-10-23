import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const shipping=resolve(process.argv[2]),origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const m=JSON.parse(await readFile(resolve(shipping,'install-manifest.json'),'utf8')),game=m.games['studio-afterglow'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const health=await fetch(origin+'/healthz',{cache:'no-store'});if(!health.ok||(await health.json()).ok!==true)throw Error('Public health failed');
const pointerResponse=await fetch(origin+'/game-modules/studio-afterglow/active.json?verify='+Date.now(),{cache:'no-store'});if(!pointerResponse.ok||!pointerResponse.headers.get('cache-control')?.includes('no-store'))throw Error('Active pointer delivery failed');
const pointer=await pointerResponse.json(),prefix='/game-modules/studio-afterglow/versions/'+game.version+'/';
if(pointer.manifest!==prefix+'manifest.json'||pointer.sha256!==game.files['manifest.json'])throw Error('Wrong public version');
const files=[];
for(const [name,digest]of Object.entries(game.files)){
 const response=await fetch(origin+prefix+name);if(!response.ok)throw Error('Missing resource '+name);
 if(hash(Buffer.from(await response.arrayBuffer()))!==digest)throw Error('Resource hash differs '+name);
 if(!response.headers.get('cache-control')?.includes('immutable'))throw Error('Immutable resource caching failed '+name);
 files.push(name);
}
const proof={passed:true,sourceCommit:m.sourceCommit,version:game.version,health:true,pointerNoStore:true,immutableFilesVerified:files.length,files};
await writeFile(resolve(shipping,'../proof/http.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
