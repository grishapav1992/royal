import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import sharp from 'sharp';
const id='studio-caribbean-treasures',source='games/caribbean-treasures/assets/catalog-cover.png',manifestPath='src/ui/royalCatalogArtwork.json';
const check=process.argv.includes('--check'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
let bytes,quality;
for(const q of [88,84,80,76]){quality=q;bytes=await sharp(source).resize(512,320,{fit:'cover',position:'centre'}).webp({quality:q,effort:6}).toBuffer();if(bytes.length<=75000)break;}
if(bytes.length>75000)throw Error('Catalogue image exceeds 75 KB');
const digest=createHash('sha256').update(bytes).digest('hex').slice(0,12),url=`/assets/royal-catalog/${id}.${digest}.webp`,file='public'+url;
if(check){if(manifest[id]!==url||!(await readFile(file)).equals(bytes))throw Error('Caribbean catalogue cover is stale');}
else{await mkdir('public/assets/royal-catalog',{recursive:true});await writeFile(file,bytes);manifest[id]=url;await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');}
let totalBytes=0;for(const path of Object.values(manifest))totalBytes+=(await stat('public'+path)).size;
if(totalBytes>1800000)throw Error('Catalogue artwork exceeds the established total budget');
console.log(JSON.stringify({checked:check,id,source,url,quality,bytes:bytes.length,width:512,height:320,registeredImages:Object.keys(manifest).length,totalBytes}));
