import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {buildProgram} from './projection.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),work=path.join(root,'artifacts/work/jackie-chan'),before=JSON.parse(fs.readFileSync(path.join(work,'production-before.json'))),rows=[];
for(const [file,kind]of [['server-tests/jackie-chan.test.ts','application'],['server-tests/cr-leo-wallet.test.ts','application'],['server-tests/forest-heart-wallet.test.ts','application'],['server-tests/finance/jackie-native.test.ts','finance'],['server-tests/finance/flag-battle-native.test.ts','finance'],['server-tests/finance/nile-native-games.test.ts','finance'],['tests/fixtures/jackie-backend.ts','application']]){
 const result=await buildProgram(before,kind,[file]),target=path.join(work,path.basename(file).replace(/\.ts$/,'.mjs'));
 fs.writeFileSync(target,result.outputFiles[0].contents);rows.push({file,kind,target,inputs:result.inputs,origins:result.origins});console.log(file,Object.keys(result.inputs).length);
}
fs.writeFileSync(path.join(work,'projected-test-inputs.json'),JSON.stringify(rows,null,2)+'\n');

