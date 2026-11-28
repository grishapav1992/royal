// Packs processed frames into one atlas of uniform cells: node assemble.mjs <out.png> <scale>
import {createRequire} from 'node:module';
import fs from 'node:fs';
const sharp=createRequire(import.meta.url)('sharp');
const D=new URL('.',import.meta.url).pathname;
export const EXTRA=['stock-12-13','stock-13-14','stock-14-15','stock-15-12a','stock-15-12b',
  'polish-8-9','polish-9-10','polish-10-11','polish-11-8',
  'talk-15-13','talk-13-wide','talk-13-o','talk-14-half','talk-15-tilt','talk-13-12',
  'laugh-1','laugh-2','laugh-3','tease-1','tease-2','tease-3','concern-1','concern-2','concern-3',
  'idle-left','idle-right','idle-chin','idle-hair'];
const [out,scaleArg]=process.argv.slice(2),k=Number(scaleArg||1),COLS=Number(process.env.COLS||6),ROWS=Math.ceil(EXTRA.length/COLS),CW=310,CH=318;
const cw=Math.round(CW*k),ch=Math.round(CH*k),parts=[];
for(const [i,id] of EXTRA.entries()){
  const file=`${D}proc/${id}.png`;if(!fs.existsSync(file)){console.log('missing',id);continue;}
  const m=await sharp(file).metadata();
  const b=await sharp(file).resize(Math.round(m.width*k),Math.round(m.height*k)).png().toBuffer();
  parts.push({input:b,left:(i%COLS)*cw+Math.round((cw-Math.round(m.width*k))/2),top:Math.floor(i/COLS)*ch+(ch-Math.round(m.height*k))});
}
await sharp({create:{width:cw*COLS,height:ch*ROWS,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(parts).png().toFile(out);
console.log(out,cw*COLS,ch*ROWS,parts.length,'frames');
