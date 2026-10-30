import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ARCHIVED_GITHUB_GAMES,ACTIVE_STUDIO_GAMES,RETIRED_ARCADE_GAMES} from '../src/shared/arcadeCatalog';
import {STUDIO_GAMES,STUDIO_INFO} from '../src/shared/studioGames';
import {VARIANT_NAMES} from '../src/shared/casinoVariants';
const files:string[]=[];
function collect(path:string){for(const row of readdirSync(path,{withFileTypes:true})){const name=path+'/'+row.name;if(row.isDirectory())collect(name);else if(/\.(ts|js)$/.test(name))files.push(name);}}
collect('server/games');collect('src/vendor/github');
files.push('src/shared/originalGames.ts','src/shared/gameCore.ts','src/shared/studioGames.ts','src/shared/casinoVariants.ts','src/shared/casinoNextVariants.ts','src/shared/casinoBatchVariants.ts','src/shared/casinoExpansion.ts','src/shared/casinoSessions.ts','server/demoExpansion.ts','server/demoCasino.ts','server/demoMines.ts');
const names:Record<string,string>={'royal-fruits':'Royal Fruits','royal-dice':'Royal Dice','royal-limbo':'Royal Limbo','royal-mines':'Royal Mines','royal-keno':'Royal Keno','github-craps':'Craps','github-diamonds':'Diamonds','github-sic-bo':'Sic Bo'};
const manifest={format:1,label:'Игры с GitHub',archivedAt:'2026-10-24',status:'removed-from-first-floor',
 sourceCommit:process.argv.includes('--check')?JSON.parse(readFileSync('docs/game-math/github-games/manifest.json','utf8')).sourceCommit:execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 note:'This is a source-preservation index, not a production game catalogue. Original mathematical files remain at canonical paths so accepted rounds can finish. The archive label does not change authorship or licenses.',
 games:[...ARCHIVED_GITHUB_GAMES.map(id=>({id,name:names[id],origin:'github-adaptation'})),...STUDIO_GAMES.filter(id=>!(ACTIVE_STUDIO_GAMES as readonly string[]).includes(id)).map(id=>({id,name:STUDIO_INFO[id].name,origin:'royal-studio'})),...RETIRED_ARCADE_GAMES.filter(id=>id.startsWith('variant-')).map(id=>({id,name:VARIANT_NAMES[id as keyof typeof VARIANT_NAMES],origin:'royal-variant'}))],
 sources:Object.fromEntries([...new Set(files)].sort().map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]))};
const json=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--check')){const saved=JSON.parse(readFileSync('docs/game-math/github-games/manifest.json','utf8'));for(const [path,digest] of Object.entries(saved.sources))if(manifest.sources[path]!==digest)throw Error('Archived mathematical source changed: '+path);if(JSON.stringify(saved.games)!==JSON.stringify(manifest.games))throw Error('Archived game list changed');console.log(JSON.stringify({archiveVerified:true,games:saved.games.length,sources:Object.keys(saved.sources).length}));}
else writeFileSync('docs/game-math/github-games/manifest.json',json);
