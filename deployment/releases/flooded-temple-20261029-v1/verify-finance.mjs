import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {buildFinancial} from './financial-build.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
assert.equal(process.argv.length,3,'Specify the production snapshot');
const before=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8'));
const canonical=JSON.parse(readFileSync(resolve(root,'module-build/temple-release/financial-inputs.json'),'utf8'));
const out=resolve(root,'artifacts/work/temple-release-preparation/financial-tests');mkdirSync(out,{recursive:true});
const tests=['flooded-temple-native','caribbean-native','forest-heart-production','flag-battle-native','nile-native-games','legacy-finance'],files=[];
for(const name of tests){
 const entry=(name==='legacy-finance'?'deployment/releases/flooded-temple-20261029-v1/':'server-tests/finance/')+name+'.test.ts',result=await buildFinancial({before,entryPoints:[entry]});
 for(const[file,digest]of Object.entries(result.financialInputs))if(file in canonical.financialInputs)assert.equal(digest,canonical.financialInputs[file],file);
 const file=resolve(out,basename(entry,'.ts')+'.mjs');writeFileSync(file,result.outputFiles[0].contents);files.push(file);
}
// These two current-host tests require wardrobe v4. The published financial v3
// behavior is checked explicitly by legacy-finance.test.ts instead.
const newerWardrobe='^(old cosmetic progress imports once without importing a balance or resetting earned looks|GirlHUB bonus credits Mia once and unlocks Naomi in the common wallet)$';
execFileSync(process.execPath,['--import','tsx','scripts/database-test.ts','--test','--test-concurrency=1','--test-skip-pattern',newerWardrobe,...files],{cwd:root,stdio:'inherit'});
