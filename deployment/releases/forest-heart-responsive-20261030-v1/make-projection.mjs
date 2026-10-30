import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';
const folder=dirname(fileURLToPath(import.meta.url)),root=resolve(folder,'../../..');
const before=JSON.parse(readFileSync(process.argv[2]||resolve(root,'artifacts/work/forest-heart-responsive/publication/before.json'),'utf8'));
const output=process.argv[3]||resolve(folder,'host-projection.json');
const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','ignore'],maxBuffer:32*1024**2});
const commit=git('rev-parse','HEAD').toString().trim();
const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const tracked=git('ls-files','-z').toString().split('\0').filter(Boolean),cache=new Map();
const blob=(revision,path)=>{const key=revision+':'+path;if(!cache.has(key))cache.set(key,canonical(git('show',key)));return cache.get(key);};
const changed=['src/ui/GameViewport.ts','src/ui/RoyalCatalogArtwork.ts','src/ui/royal-platform.css'];
const css=blob(commit,'src/ui/royal-platform.css').toString().split('\n').filter(line=>line.startsWith('.rp-card[data-platform-game="studio-forest-heart"]')).join('\n');assert.equal(css.split('\n').length,2);
const functionStart='export function royalCatalogArtwork(id: string): string {';
const cssAnchor='@media(prefers-reduced-motion:reduce){.rp-card{transition:none}}';
const patches={
 'src/ui/GameViewport.ts':[{from:'.dracona-frame',to:'.dracona-frame, .forest-heart-frame'}],
 'src/ui/RoyalCatalogArtwork.ts':[{from:functionStart,to:functionStart+"\n  if(id==='studio-forest-heart')return '/assets/forest-heart/v3/elf-idle.webp';"}],
 'src/ui/royal-platform.css':[{from:cssAnchor,to:cssAnchor+'\n\n'+css}]
};
const files={};
for(const file of Object.keys(before.sourceLF).filter(f=>f==='index.html'||f.startsWith('src/')&&/\.(?:ts|json|css)$/.test(f)).sort()){
 const expected=before.sourceLF[file];let bytes,origin;
 for(const path of [file,...tracked.filter(p=>p.endsWith('/source/'+file))]){
  try{const value=blob(commit,path);if(hash(value)===expected){bytes=value;origin={commit,path};break;}}catch{}
 }
 if(!bytes){for(const revision of git('log','origin/main','--format=%H','--',file).toString().trim().split('\n').filter(Boolean)){
  try{const value=blob(revision,file);if(hash(value)===expected){bytes=value;origin={commit:revision,path:file};break;}}catch{}
 }}
 assert(bytes,'Production source is not preserved in Git: '+file);
 let value=bytes;
 for(const patch of patches[file]??[]){const parts=value.toString().split(patch.from);assert.equal(parts.length-1,1,'Scoped patch must match exactly once: '+file);value=Buffer.from(parts.join(patch.to));}
 const row={...origin,baseSha256:expected,sha256:hash(value),...(patches[file]?{patches:patches[file]}:{})};
 assert.equal(hash(projectHostSource(row,bytes)),row.sha256);files[file]=row;
}
for(const file of changed)assert(files[file]?.patches);
const projection={format:1,productionCommit:before.sourceCommit||before.sourceRevision,entries:['index.html'],changedSources:changed,files};
writeFileSync(output,JSON.stringify(projection,null,2)+'\n');
console.log(JSON.stringify({files:Object.keys(files).length,changed,productionCommit:projection.productionCommit,output}));
