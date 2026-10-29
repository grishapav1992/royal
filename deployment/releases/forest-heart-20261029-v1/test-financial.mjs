import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {buildFinancial} from './financial-build.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const work=resolve(root,'artifacts/work/forest-heart-ux-v7');
const before=JSON.parse(readFileSync(resolve(work,'production-before.json'),'utf8').replace(/^\uFEFF/,''));
const tests=[];
for(const name of ['forest-heart-production','nile-native-games']){
 const built=await buildFinancial({before,entryPoints:['server-tests/finance/'+name+'.test.ts']});
 const target=resolve(work,name+'.test.mjs');writeFileSync(target,built.outputFiles[0].contents);tests.push(target);
}
execFileSync(process.execPath,['--import','tsx','scripts/database-test.ts','--test',...tests],{cwd:root,stdio:'inherit'});
