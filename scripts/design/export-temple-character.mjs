import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const input=process.argv[2];
if(!input)throw Error('Pass the generated transparent 3 by 2 explorer pose atlas');
const folder=resolve('public/assets/flooded-temple/character');
await mkdir(folder,{recursive:true});
const {width,height,hasAlpha}=await sharp(input).metadata();
if(!hasAlpha)throw Error('Explorer poses require genuine alpha');
const names=['idle','observe','brace','discover','celebrate','reflect'];
const outputs=[];
for(const [i,name] of names.entries()){
  const col=i%3,row=Math.floor(i/3),left=Math.round(col*width/3),top=Math.round(row*height/2);
  const image=sharp(input).extract({left,top,width:Math.round((col+1)*width/3)-left,height:Math.round((row+1)*height/2)-top});
  const file=resolve(folder,name+'.webp');
  const info=await image.resize(512,768).webp({quality:93,alphaQuality:100}).toFile(file);
  outputs.push({pose:name,file:'character/'+name+'.webp',bytes:info.size});
}
console.log(JSON.stringify({outputs,alphaPreserved:true,conversion:'Equal cell extraction and resize only, without trimming or repainting'}));
