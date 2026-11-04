import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {relative,resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';

const root=process.cwd();
const reader=await readHostProjection(root,'deployment/releases/casino-street-20261104-v1/backend-projection.json',{strictOrigins:true});
reader.preload(Object.keys(reader.metadata.files));
registerHooks({load(url,context,next){
 if(!url.startsWith('file:'))return next(url,context);
 const name=relative(root,fileURLToPath(url)).replaceAll('\\','/');
 if(!/^(src|server)\//.test(name))return next(url,context);
 assert(reader.metadata.files[name],'Test runtime input is not in the reviewed backend: '+name);
 const bytes=reader.read(name);
 if(name.endsWith('.json'))return {format:'json',source:bytes,shortCircuit:true};
 return {format:'module',source:transformSync(bytes.toString(),{loader:name.endsWith('.ts')?'ts':'js',format:'esm',target:'es2022',sourcefile:name}).code,shortCircuit:true};
}});
process.once('beforeExit',()=>{
 const folder=resolve(root,'../release/test-inputs');mkdirSync(folder,{recursive:true});
 writeFileSync(resolve(folder,process.pid+'.json'),JSON.stringify({projection:reader.config,sha256:reader.sha256,inputs:reader.inputs},null,2)+'\n');
});
