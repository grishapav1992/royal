// Нарезка графики макета из одобренных ресурсов игры. Запуск из корня рабочей копии.
import sharp from 'sharp';
import {copyFileSync} from 'node:fs';
const A='public/assets/forest-heart/',O='docs/game-layout/forest-living-tree/prototype/assets/';
const svg=(w,h,body)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>${body}</svg>`);
for(const f of ['v1/background','v1/flower','v2/crystal','v2/title','v4/roots','v4/tile','v2/frame']) copyFileSync(A+f+'.webp',O+f.split('/')[1]+'.webp');
for(const p of ['idle','choice','channel','flower','bonus','win','big']) copyFileSync(A+`v3/elf-${p}.webp`,O+`elf-${p}.webp`);
// бутон из выбранного эталона
const bud=await sharp('docs/concepts/forest-heart/approved-concept-v1.png').extract({left:1215,top:560,width:170,height:180}).resize(680,720,{kernel:'lanczos3'}).sharpen({sigma:1.2}).ensureAlpha().toBuffer();
const pts='335,66 395,135 432,122 474,192 524,250 566,268 552,312 582,390 568,468 486,560 408,596 342,636 268,596 196,536 150,440 150,330 168,250 236,190 288,130';
await sharp(bud).composite([{input:svg(680,720,`<polygon points="${pts}" fill="#fff" filter="url(#b)"/>`),blend:'dest-in'}]).png().toBuffer()
 .then(b=>sharp(b).extract({left:130,top:56,width:470,height:590}).resize(282,354).webp({quality:88,alphaQuality:90}).toFile(O+'bud.webp'));
// самоцветы для кнопки из логотипа
const cut=async(n,l,t,w,h,shape)=>{const b=await sharp(A+'v2/title.webp').extract({left:l,top:t,width:w,height:h}).ensureAlpha().toBuffer();
 await sharp(b).composite([{input:svg(w,h,shape),blend:'dest-in'}]).webp({quality:90,alphaQuality:92}).toFile(O+n+'.webp');};
await cut('gem-top',575,0,250,170,'<path d="M125 -10 L175 70 L245 95 L235 135 L170 150 L125 152 L80 146 L15 135 L5 95 L75 70Z" fill="#fff" filter="url(#b)"/>');
await cut('gem-bottom',600,285,200,170,'<path d="M100 12 L150 25 L195 40 L190 85 L140 100 L112 165 L100 172 L88 165 L60 100 L10 85 L5 40 L50 25Z" fill="#fff" filter="url(#b)"/>');
await cut('leaf-left',10,130,190,250,'<path d="M0 0H120L130 120L170 190L150 250H0Z" fill="#fff" filter="url(#b)"/>');
// расцвет рамы: цветок с логотипа, розовый и золотой
{const l=58,t=228,d=88,cx=44,cy=45;const {data}=await sharp(A+'v2/title.webp').extract({left:l,top:t,width:d,height:d}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 for(const [n,C] of [['pink',[255,140,205]],['gold',[255,196,92]]]){const o=Buffer.from(data);
  for(let y=0;y<d;y++)for(let x=0;x<d;x++){const i=(y*d+x)*4,R=data[i],G=data[i+1],B=data[i+2],q=Math.hypot(x-cx,y-cy);
   const v=Math.max(0,Math.min(1,(B-Math.max(G,R*.9)-14)/34)),core=q<13?1:0;o[i+3]=q>41?0:Math.round(255*Math.max(v,core));
   if(!core||v>.5){const L=Math.min(1,B/235),w=Math.max(0,(R+G)/2-90)/165;for(let k=0;k<3;k++)o[i+k]=Math.min(255,(C[k]*L)*(1-w)+255*w);}}
  await sharp(o,{raw:{width:d,height:d,channels:4}}).webp({quality:90}).toFile(O+'blossom-'+n+'.webp');}}
