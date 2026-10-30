import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,basename} from 'node:path';
import assert from 'node:assert/strict';
import {buildProgram,sha} from './programs.mjs';
const before=JSON.parse(readFileSync(process.argv[2])),folder='artifacts/work/temple-production-096/financial-tests';mkdirSync(folder,{recursive:true});
const actual=JSON.parse(readFileSync('module-build/temple-production-096/programs.json')).programs.finance,files=[];
for(const name of ['flooded-temple-native','caribbean-native','forest-heart-production','flag-battle-native','jackie-native','nile-native-games','legacy-finance']){
 const entry=(name==='legacy-finance'?'deployment/releases/flooded-temple-20261030-v1/':'server-tests/finance/')+name+'.test.ts';
 const result=await buildProgram(before,{entries:[entry]});
 for(const[file,digest]of Object.entries(result.inputs))if(file in actual.inputs)assert.equal(digest,actual.inputs[file],'Financial test differs from publication: '+file);
 const file=resolve(folder,basename(entry,'.ts')+'.mjs');writeFileSync(file,result.outputFiles[0].contents);files.push(file);
}
assert.equal(sha(readFileSync('module-build/temple-production-096/play.js')),actual.sha256);
const v4='^(old cosmetic progress imports once without importing a balance or resetting earned looks|GirlHUB bonus credits Mia once and unlocks Naomi in the common wallet)$';
execFileSync(process.execPath,['--import','tsx','scripts/database-test.ts','--test','--test-concurrency=1','--test-skip-pattern',v4,...files],{stdio:'inherit'});
