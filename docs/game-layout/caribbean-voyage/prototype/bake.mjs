/** Technical masks from the existing harbour picture: R water, G sky. No new artwork. Usage: node bake.mjs <output folder> */
import sharp from 'sharp';
import {mkdir,copyFile,readdir} from 'node:fs/promises';
const out=process.argv[2],src='../../../../public/assets/caribbean-treasures/',W=800,H=450;
await mkdir(out+'/assets/crew',{recursive:true});await mkdir(out+'/assets/audio',{recursive:true});
const px=await sharp(src+'harbor.webp').resize(W,H).removeAlpha().raw().toBuffer();
const at=(x,y)=>{const i=(y*W+x)*3;return[px[i],px[i+1],px[i+2]];};
function flood(starts,ok){const m=new Uint8Array(W*H),q=[...starts];while(q.length){const [x,y]=q.pop();if(x<0||y<0||x>=W||y>=H||m[y*W+x]||!ok(x,y))continue;m[y*W+x]=1;q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}return m;}
const horizon=204;
const sky=flood([[400,20],[300,60],[480,90]],(x,y)=>{if(y>horizon-6||x<205)return false;const [r,g,b]=at(x,y);return b>=r-4&&b>=g-14&&b>120&&(r+g+b)>330;});
const water=flood([[400,300],[250,330],[600,330],[200,260],[660,240]],(x,y)=>{if(y<horizon+1||y>374)return false;const [r,g,b]=at(x,y);return g>r-6&&b>r-12&&!(r>235&&g>225&&b<200);});
const rgb=Buffer.alloc(W*H*3);for(let i=0;i<W*H;i++){rgb[i*3]=water[i]*255;rgb[i*3+1]=sky[i]*255;}
// Feather inwards, so a moving pixel never drags the shore or a palm with it.
const ch=async k=>{const one=Buffer.alloc(W*H);for(let i=0;i<W*H;i++)one[i]=rgb[i*3+k];
 return sharp(one,{raw:{width:W,height:H,channels:1}}).blur(k?5:2.2).linear(2,-255).blur(k?4:1.2).toColourspace('b-w').raw().toBuffer();};
const r=await ch(0),g=await ch(1);for(let i=0;i<W*H;i++){rgb[i*3]=r[i];rgb[i*3+1]=g[i];}
await sharp(rgb,{raw:{width:W,height:H,channels:3}}).webp({quality:82}).toFile(out+'/assets/harbor-mask.webp');
for(const f of ['harbor','frame','captain','captain-blink','captain-bonus','captain-focus','captain-laugh','captain-soft','captain-surprise','captain-win','symbol-map','symbol-compass','symbol-pistol','symbol-cutlass','symbol-ruby','symbol-parrot'])await copyFile(src+f+'.webp',out+'/assets/'+f+'.webp');
for(const f of await readdir(src+'crew'))if(f.endsWith('.webp'))await copyFile(src+'crew/'+f,out+'/assets/crew/'+f);
for(const f of await readdir(src+'audio'))if(f.endsWith('.m4a'))await copyFile(src+'audio/'+f,out+'/assets/audio/'+f.replace('.m4a','.mp4'));
