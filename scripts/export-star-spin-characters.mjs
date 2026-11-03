import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),manifestPath=new URL('games/wild-nudge/assets/characters/prompts.json',root);
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
await mkdir(new URL('public/assets/wild-nudge/characters/',root),{recursive:true});
for(const asset of manifest.characters){
 const input=new URL(`games/wild-nudge/assets/characters/${asset.id}.png`,root),out=new URL(`public/assets/wild-nudge/characters/${asset.id}.webp`,root);
 const data=await sharp(await readFile(input)).resize({height:960,width:640,fit:'inside',withoutEnlargement:true}).webp({quality:92,alphaQuality:100}).toBuffer();
 await writeFile(out,data);const metadata=await sharp(data).metadata();
 asset.output=`public/assets/wild-nudge/characters/${asset.id}.webp`;asset.width=metadata.width;asset.height=metadata.height;asset.hasAlpha=metadata.hasAlpha;asset.bytes=data.length;asset.sha256=createHash('sha256').update(data).digest('hex');
 console.log(JSON.stringify({id:asset.id,width:metadata.width,height:metadata.height,hasAlpha:metadata.hasAlpha,bytes:data.length}));
}
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
