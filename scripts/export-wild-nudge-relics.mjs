/** Re-export the current approved raster sources without regenerating their artwork. */
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'games/wild-nudge/assets/source');
const target=resolve(root,'public/assets/wild-nudge');
await mkdir(target,{recursive:true});
const atlas=resolve(source,'relics-symbols.png'),meta=await sharp(atlas).metadata();
if(!meta.width||!meta.height||!meta.hasAlpha)throw Error('Expected the approved transparent four-by-two relic atlas');
const path=resolve(root,'games/wild-nudge/assets.json'),record=JSON.parse(await readFile(path,'utf8'));
const rowSplit=record.atlasLayout.rowSplit;
if(!Number.isInteger(rowSplit)||rowSplit<=0||rowSplit>=meta.height)throw Error('Invalid measured atlas row boundary');
const symbols=[];
for(let id=0;id<8;id++){
  const left=Math.round((id%4)*meta.width/4),right=Math.round((id%4+1)*meta.width/4);
  const top=id<4?0:rowSplit,bottom=id<4?rowSplit:meta.height;
  // Materialize the tile before trim, so Sharp cannot reorder the atlas extraction.
  const tile=id===6?await readFile(resolve(source,'relics-wild.png')):await sharp(atlas).extract({left,top,width:right-left,height:bottom-top}).png().toBuffer();
  const output=resolve(target,`symbol-${id}.webp`);
  await sharp(tile).trim({background:'#00000000',threshold:10}).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).webp({quality:94,alphaQuality:100}).toFile(output);
  const {data,info}=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let transparent=0;for(let i=3;i<data.length;i+=4)if(data[i]===0)transparent++;
  if(transparent===0)throw Error(`Symbol ${id} has no transparent pixels`);
  symbols.push({id,width:info.width,height:info.height,transparentFraction:transparent/(info.width*info.height)});
}
await sharp(resolve(source,'relics-cover.png')).resize(640,360,{fit:'cover',position:'centre'}).webp({quality:91}).toFile(resolve(target,'cover.webp'));
record.symbols=symbols;record.assets=[];
for(const name of ['background.webp','cover.webp',...symbols.map(s=>`symbol-${s.id}.webp`),'score.wav']){
  const bytes=await readFile(resolve(target,name));record.assets.push({path:'public/assets/wild-nudge/'+name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({symbolSet:record.symbolSet,symbols,assets:record.assets.length}));
