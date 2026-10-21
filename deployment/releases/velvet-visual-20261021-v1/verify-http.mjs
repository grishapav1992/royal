import{readFile,writeFile,mkdir}from'node:fs/promises';
import{createHash}from'node:crypto';
import{resolve}from'node:path';
const origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const local=JSON.parse(await readFile('module-dist/studio-velvet-reign/active.json','utf8'));
const expected=JSON.parse(await readFile('module-dist/.'+local.manifest.replace('/game-modules',''),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const rows=[];
async function get(path){const response=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error(`${response.status} ${path}`);const bytes=Buffer.from(await response.arrayBuffer());const row={path,status:response.status,sha256:hash(bytes),bytes:bytes.length,cache:response.headers.get('cache-control'),type:response.headers.get('content-type')};rows.push(row);return{bytes,row};}
const pointer=await get('/game-modules/studio-velvet-reign/active.json');
if(pointer.row.sha256!==hash(await readFile('module-dist/studio-velvet-reign/active.json')))throw Error('Public pointer differs');
if(!/no-store|no-cache/.test(pointer.row.cache))throw Error('Active pointer cache');
const manifest=await get(local.manifest);if(manifest.row.sha256!==local.sha256)throw Error('Public manifest differs');
const base=local.manifest.slice(0,local.manifest.lastIndexOf('/')+1);
for(const[name,digest]of Object.entries(expected.files)){const file=await get(base+name);if(file.row.sha256!==digest)throw Error('Public asset differs: '+name);if(!/immutable/.test(file.row.cache))throw Error('Missing immutable cache: '+name);}
const health=JSON.parse((await get('/healthz')).bytes.toString());if(health.ok!==true)throw Error('Health failed');
const result={at:new Date().toISOString(),origin,version:expected.version,filesVerified:Object.keys(expected.files).length,manifestSha256:manifest.row.sha256,health:health.ok,requests:rows};
const output=resolve(process.argv[2]||'artifacts/velvet-public-http.json');await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({version:result.version,filesVerified:result.filesVerified,health:result.health}));
