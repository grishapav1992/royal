import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {relative,resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const root=process.cwd();
const {readHostProjection}=await import(pathToFileURL(resolve(root,'scripts/build-host-projection.mjs')));
const backend=await readHostProjection(root,'deployment/releases/mira-counter-rest-20261105-v2/backend-projection.json',{strictOrigins:true});
const host=await readHostProjection(root,'deployment/releases/mira-counter-rest-20261105-v2/host-projection.json',{strictOrigins:true});
for(const reader of [backend,host])reader.preload(Object.keys(reader.metadata.files));
registerHooks({load(url,context,next){
 if(!url.startsWith('file:'))return next(url,context);
 const name=relative(root,fileURLToPath(url)).replaceAll('\\','/');
 if(!/^(src|server)\//.test(name))return next(url,context);
 const reader=backend.metadata.files[name]?backend:host;
 assert(reader.metadata.files[name],'Test input is absent from both reviewed projections: '+name);
 const bytes=reader.read(name);
 if(name.endsWith('.json'))return {format:'json',source:bytes,shortCircuit:true};
 return {format:'module',source:transformSync(bytes.toString(),{loader:name.endsWith('.ts')?'ts':'js',format:'esm',target:'es2022',sourcefile:name}).code,shortCircuit:true};
}});
process.once('beforeExit',()=>{
 const folder=resolve(root,'artifacts/work/mira-counter-rest-20261105/v2/test-inputs');mkdirSync(folder,{recursive:true});
 writeFileSync(resolve(folder,process.pid+'.json'),JSON.stringify({projections:[backend,host].map(reader=>({config:reader.config,sha256:reader.sha256,inputs:reader.inputs}))},null,2)+'\n');
});
