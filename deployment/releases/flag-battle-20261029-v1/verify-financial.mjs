import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildFinancial} from './financial-build.mjs';
const work=resolve(process.env.ROYAL_RELEASE_WORK||'artifacts/work/flag-battle-production');
const before=JSON.parse(readFileSync(resolve(work,'before-full.json')));
mkdirSync(resolve(work,'finance-tests'),{recursive:true});
for(const name of ['flag-battle-native','forest-heart-production','nile-native-games']){
 const result=await buildFinancial({before,entryPoints:['server-tests/finance/'+name+'.test.ts'],outfile:resolve(work,'finance-tests',name+'.test.mjs')});
 writeFileSync(result.outputFiles[0].path,result.outputFiles[0].contents);
 console.log(JSON.stringify({test:name,retainedGraphInputs:Object.keys(result.financialInputs).length}));
}
