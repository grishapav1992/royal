import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';
const root=process.cwd(),source='src/shared/arcadeCatalog.ts';
const config=JSON.parse(readFileSync(new URL('./host-projection.json',import.meta.url)));
const row=config.files[source];
const bytes=execFileSync(process.env.ROYAL_GIT_BINARY||'git',['show',row.commit+':'+row.path]);
const after=projectHostSource(row,bytes).toString();
const before=after.replace('ROYAL_PLATFORM_GAMES: readonly string[] = [','ROYAL_PLATFORM_GAMES: readonly string[] = [...REWARD_SLOT_GAMES, ');
async function catalogue(contents){
 const result=await build({stdin:{contents,loader:'ts',resolveDir:resolve(root,'src/shared')},bundle:true,platform:'node',format:'cjs',write:false});
 const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);return module.exports;
}
const old=await catalogue(before),current=await catalogue(after);
assert.deepEqual(current.ROYAL_PLATFORM_GAMES,old.ROYAL_PLATFORM_GAMES.filter(id=>!['royal-coins','royal-fruits'].includes(id)));
assert.equal(old.ROYAL_PLATFORM_GAMES.length-current.ROYAL_PLATFORM_GAMES.length,2);
assert.deepEqual(current.collectionGames('royal'),current.ROYAL_PLATFORM_GAMES);
for(const id of ['royal-coins','royal-fruits'])assert.equal(current.isCollectionGame('royal',id),false);
for(const key of ['ARCADE_CABINET_SPECS','ACTIVE_ARCADE_GAMES','RETIRED_ARCADE_GAMES','ARCADE_HOUSE_GAMES','ARCADE_CLASSIC_GAMES'])assert.deepEqual(current[key],old[key],key);
assert.equal(after.replace('ROYAL_PLATFORM_GAMES: readonly string[] = [','ROYAL_PLATFORM_GAMES: readonly string[] = [...REWARD_SLOT_GAMES, '),before);
console.log(JSON.stringify({passed:true,removed:['royal-coins','royal-fruits'],before:old.ROYAL_PLATFORM_GAMES,after:current.ROYAL_PLATFORM_GAMES,physicalCabinetsAndRecoveryUnchanged:true}));
