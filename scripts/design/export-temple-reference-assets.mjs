import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const [rooms,props]=process.argv.slice(2);
if(!rooms||!props)throw Error('Pass the generated room atlas and transparent prop atlas paths');
const folder=resolve('public/assets/flooded-temple');
await mkdir(resolve(folder,'props'),{recursive:true});
await sharp(rooms).resize(1024,1024).webp({quality:90}).toFile(resolve(folder,'rooms.webp'));
const {width:w,height:h,hasAlpha}=await sharp(props).metadata();
if(!hasAlpha)throw Error('Prop atlas must have genuine alpha');
const names=['chest','chest-open','lever','lever-pulled','relic','compass','gate','rope'];
for(const [i,name]of names.entries()){
  const col=i%4,row=Math.floor(i/4),left=Math.round(col*w/4)+6,top=Math.round(row*h/2)+6;
  const width=Math.round((col+1)*w/4)-6-left,height=Math.round((row+1)*h/2)-6-top;
  await sharp(props).extract({left,top,width,height}).resize(320,320,{fit:'contain',background:'#00000000'}).webp({quality:92,alphaQuality:100}).toFile(resolve(folder,'props',name+'.webp'));
}
await sharp(resolve(folder,'props/gate.webp')).trim().resize(320,320).webp({quality:92,alphaQuality:100}).toFile(resolve(folder,'frame.webp'));
await sharp(resolve(folder,'frame.webp')).extract({left:13,top:64,width:25,height:176}).webp({quality:92}).toFile(resolve(folder,'carving.webp'));
console.log(JSON.stringify({floors:'1024x1024',props:names,alphaPreserved:true}));
