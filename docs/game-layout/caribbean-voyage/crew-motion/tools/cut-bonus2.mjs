// The edit came back with a painted checkerboard instead of transparency: keep the old silhouette and add only the filled gap.
import sharp from 'sharp';
import {W,H,load,register,warp,blurF} from './lib.mjs';
const A=await load('gen/isa-bonus.png'),B0=await load('gen/isa-bonus2.png'),B=warp(B0,register(A,B0,[300,100,1000,1400]));
const gap=(x,y)=>x>600&&x<860&&y>560&&y<1020;
let al=new Float32Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,r=B.d[i*4],g=B.d[i*4+1],b=B.d[i*4+2],checker=Math.min(r,g,b)>196&&Math.max(r,g,b)-Math.min(r,g,b)<14;
 al[i]=Math.max(A.d[i*4+3]/255,gap(x,y)&&!checker?1:0);}
const soft=blurF(al,W,H,1);const out=Buffer.alloc(W*H*4);
for(let i=0;i<W*H;i++){const a=Math.min(al[i],soft[i]+.0);const keepOld=A.d[i*4+3]>250&&!gap(i%W,i/W|0);for(let k=0;k<3;k++)out[i*4+k]=keepOld?A.d[i*4+k]:B.d[i*4+k];out[i*4+3]=Math.round(a*255);}
await sharp(out,{raw:{width:W,height:H,channels:4}}).png().toFile('gen/isa-bonus-fixed.png');
const r={left:470,top:520,width:550,height:500};await sharp('gen/isa-bonus-fixed.png').extract(r).flatten({background:'#ff00ff'}).png().toFile('z.png');
