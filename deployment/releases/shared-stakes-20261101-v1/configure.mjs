import assert from 'node:assert/strict';import fs from'node:fs';import path from'node:path';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
const root=process.cwd(),[beforeFile,originsFile,feature]=process.argv.slice(2),folder=path.dirname(fileURLToPath(import.meta.url));
assert(/^[a-f0-9]{40}$/.test(feature));const git=args=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,maxBuffer:40*1024**2,stdio:['ignore','pipe','ignore']});
const read=(commit,name)=>Buffer.from(git(['show',commit+':'+name]).toString('utf8').replace(/\r\n/g,'\n')),hash=b=>createHash('sha256').update(b).digest('hex');
const before=JSON.parse(fs.readFileSync(beforeFile)),files=JSON.parse(fs.readFileSync(originsFile)),registry=JSON.parse(read(feature,'scripts/game-math/rtp-policy.json'));
const changed=git(['diff','--name-only','origin/main',feature]).toString().trim().split('\n').filter(n=>/^(src|server|scripts|games|docs\/game-math)\//.test(n));
const qualified=[...new Set(Object.values(registry.stakePolicies).flatMap(p=>[...p.sources,p.qualificationSource]))];
const add=(name,commit=feature)=>{const bytes=read(commit,name),h=hash(bytes);files[name]={commit,path:name,baseSha256:h,sha256:h};};
// These are dependencies of the updated common wallet. Their public betting route remains closed.
for(const name of [...changed,...qualified,'server/demoWalletAmounts.ts'])add(name);
const tracked=git(['ls-tree','-r','--name-only',feature,'--','src','server','scripts','games']).toString().trim().split('\n');
for(const n of tracked)if(!files[n]&&!before.source[n]&&/\.(ts|tsx|mjs|cjs|js|json|css)$/.test(n))add(n);
function patchLines(name,transform){
 const row=files[name],original=read(row.commit,row.path).toString();assert.equal(hash(Buffer.from(original)),row.baseSha256);assert(!row.patches?.length);
 const patches=[];let text=original;
 for(const line of original.split('\n')){const next=transform(line);if(line!==next){assert(line&&text.split(line).length===2,'Ambiguous patch: '+name);patches.push({from:line,to:next});text=text.replace(line,next);}}
 files[name]={...row,patches,sha256:hash(Buffer.from(text))};return text;
}
// Preserve the exact published wardrobe and progress contract, which are independent of payout mathematics.
for(const n of ['src/ui/AfterglowUI.ts','src/shared/afterglowWardrobe.ts','server/afterglowWardrobe.ts','src/wallet/AfterglowWardrobeClient.ts','games/girlhub/entry.ts','games/girlhub/package.json','src/modules/GameModuleCatalog.ts'])files[n]=JSON.parse(fs.readFileSync(originsFile))[n];
patchLines('src/ui/AfterglowUI.ts',line=>line
 .replace("import {tr, locale} from '../i18n/index';","import {confirmedPayout} from '../shared/roundPrecision';\nimport {GAME_STAKE_UNITS as AFTER_BETS} from '../shared/gameStakes';\nimport {tr, locale} from '../i18n/index';")
 .replace('AFTER_GAME,AFTER_BETS,','AFTER_GAME,').replace("stake='100'","stake='10'").replace("this.stake='100'","this.stake='10'")
 .replaceAll('this.setTotal(s.view.afterglow.totalPayoutUnits)','this.setTotal(confirmedPayout(s,s.view.afterglow.totalPayoutUnits))')
 .replaceAll('this.setTotal(v.totalPayoutUnits)','this.setTotal(confirmedPayout(s,v.totalPayoutUnits))'));
patchLines('src/modules/GameModuleCatalog.ts',line=>line.includes("gameId: 'studio-caribbean-treasures'")?line.replace('rulesVersion: 1','rulesVersion: 2'):line);
const moduleAssetSources=['public/assets/caribbean-treasures/audio/credits.json','public/assets/caribbean-treasures/audio/manifest.json','public/assets/caribbean-treasures/crew/manifest.json'];
for(const n of moduleAssetSources){let found=false;for(const c of git(['log','--all','--format=%H','--',n]).toString().trim().split('\n')){if(!c)continue;const bytes=read(c,n);if(hash(bytes)===before.sourceLF[n]){add(n,c);found=true;break;}}assert(found,'Unpreserved production media: '+n);}
const active=Object.keys(registry.stakePolicies),catalog=read(files['src/modules/GameModuleCatalog.ts'].commit,'src/modules/GameModuleCatalog.ts').toString(),moduleGames=[];
for(const id of active){const m=[...catalog.matchAll(/gameId: '([^']+)', slug: '([^']+)'/g)].find(m=>m[1]===id);assert(m,id);moduleGames.push(m[2]);}
const common={format:1,productionCommit:before.sourceCommit,changedSources:changed,files:Object.fromEntries(Object.entries(files).sort()),moduleGames,moduleContracts:{'studio-afterglow':before.moduleHost.games['studio-afterglow']},moduleAssets:Object.fromEntries(Object.entries(before.source).filter(([n])=>n.startsWith('public/'))),moduleAssetSources};
for(const[kind,entries]of [['host',['index.html']],['backend',['server/index.ts']],['native',['scripts/finance-nile-play.ts','scripts/finance-nile-play-proof.ts']]])fs.writeFileSync(path.join(folder,kind+'-projection.json'),JSON.stringify({...common,entries},null,2)+'\n');
fs.writeFileSync(path.join(folder,'scope.json'),JSON.stringify({release:'shared-stakes-20261101-v1',productionCommit:before.sourceCommit,featureCommit:feature,activeGames:active,addedGames:[],restoredGames:[],qualifiedSources:qualified,changedSources:changed,preservedWardrobeProgressVersion:3,nativeService:'royal-nile-play'},null,2)+'\n');
console.log({feature,sourceCandidates:Object.keys(files).length,moduleGames,moduleAssetSources});
