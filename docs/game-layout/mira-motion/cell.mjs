import {createRequire} from 'node:module';const sharp=createRequire(import.meta.url)('sharp');
// node cell.mjs <sheet> <cols> <rows> <index> <out> : cell scaled x3 and centred on a 1024 square, transparent.
const [src,cols,rows,index,out]=process.argv.slice(2);const m=await sharp(src).metadata();
const W=Math.floor(m.width/cols),H=Math.floor(m.height/rows),i=Number(index);
const left=Math.floor((i%cols)*m.width/cols),top=Math.floor(Math.floor(i/cols)*m.height/rows);
const k=Math.min(3,1000/Math.max(W,H)),w=Math.round(W*k),h=Math.round(H*k);
const cell=await sharp(src).extract({left,top,width:W,height:H}).resize(w,h).png().toBuffer();
await sharp({create:{width:1024,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:cell,left:Math.round((1024-w)/2),top:Math.round((1024-h)/2)}]).png().toFile(out);
console.log(out,W,H,k.toFixed(3));
