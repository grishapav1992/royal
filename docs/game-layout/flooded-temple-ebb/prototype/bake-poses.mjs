/** Aligns the approved poses to the height and soles of the sketch. Usage: node bake-poses.mjs <poses folder> <output folder>
 *  f: size against the sketch, a: point under the heroine in source pixels, hand and lamp for rope and light, e: eyes for blinking. */
import sharp from 'sharp';import {mkdir,writeFile} from 'node:fs/promises';
const [dir,out]=process.argv.slice(2);await mkdir(out+'/assets/poses',{recursive:true});
const P={
 pull:{f:.96,a:[498,1494],hand:[957,787],lamp:[102,647]},
 watch:{f:1.02,a:[532,1488],lamp:[278,641],e:[[525,121],[571,122],[15,9]]},
 shield:{f:.98,a:[500,1505],lamp:[140,625]},
 windup:{f:.98,a:[610,1518],hand:[776,81],lamp:[372,884],cut:[[[412,977],[300,984],[100,1060],[100,1536],[480,1536],[480,1120],[562,1022],[502,962],[440,912],[424,940]]]},
 throw:{f:.92,a:[690,1498],hand:[1415,230],lamp:[558,768]},
 haul:{f:1.04,a:[610,1230],hand:[1003,337],lamp:[403,686]},
 land:{f:.76,a:[600,1230],lamp:[182,581],cut:[[[903,140],[1090,140],[1090,410],[1000,398],[962,386],[930,362],[905,335],[886,302],[880,262],[903,258]]]},
 cheer:{f:1.0,a:[480,1513],lamp:[264,900]},
 triumph:{f:1.04,a:[465,1488],lamp:[119,245]},
 wring:{f:1.0,a:[520,1500],lamp:[340,730],e:[[491,118],[544,136],[15,9]]},
 jump:{f:.84,a:[702,1659],hand:[1130,167],lamp:[209,628]},
 relic:{f:1.0,a:[539,1508],lamp:[290,192]},
 map:{f:1.0,a:[510,1520],lamp:[300,795]},
 sit:{f:.95,a:[470,1310],lamp:[186,771],e:[[429,186],[494,186],[20,10.5]]}};
const meta={},D=1.1;
for(const [id,p] of Object.entries(P)){
 const src=sharp(dir+'/'+id+'.png').ensureAlpha(),{data,info}=await src.raw().toBuffer({resolveWithObject:true}),W=info.width,H=info.height;
 if(p.cut){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${p.cut.map(c=>`<polygon points="${c.map(q=>q.join(',')).join(' ')}" fill="#fff"/>`).join('')}</svg>`;const m=await sharp(Buffer.from(svg)).blur(1.2).extractChannel(3).raw().toBuffer();for(let i=0;i<W*H;i++)data[i*4+3]=Math.round(data[i*4+3]*(1-m[i]/255));}
 let x0=W,x1=0,y0=H,y1=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(data[(y*W+x)*4+3]>20){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 x0=Math.max(0,x0-4);y0=Math.max(0,y0-4);x1=Math.min(W-1,x1+4);y1=Math.min(H-1,y1+4);const u=p.f*700/1024,w=x1-x0+1,h=y1-y0+1;
 await sharp(data,{raw:{width:W,height:H,channels:4}}).extract({left:x0,top:y0,width:w,height:h}).resize(Math.round(w*u*D),Math.round(h*u*D)).webp({quality:90,alphaQuality:100}).toFile(out+`/assets/poses/${id}.webp`);
 const pt=q=>q&&[+((q[0]-p.a[0])*u).toFixed(1),+((q[1]-p.a[1])*u).toFixed(1)];
 meta[id]={x:+((x0-p.a[0])*u).toFixed(1),y:+((y0-p.a[1])*u).toFixed(1),w:+(w*u).toFixed(1),h:+(h*u).toFixed(1),hand:pt(p.hand),lamp:pt(p.lamp),eyes:p.e&&[...pt(p.e[0]),...pt(p.e[1]),+(p.e[2][0]*u).toFixed(1),+(p.e[2][1]*u).toFixed(1)]};
}
await writeFile('poses.json',JSON.stringify(meta,null,1)+'\n');
