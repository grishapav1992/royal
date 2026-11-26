// Builds the layers of one rig from the master and the edited plates. node bake.mjs <id>
import {W,H,load,save,register,warp,diff,solid,apply,over,blurF} from './lib.mjs';
import sharp from 'sharp';import fs from 'node:fs';
const id=process.argv[2],C=JSON.parse(fs.readFileSync(`rigs/${id}.json`)),out=`layers/${id}/`;fs.mkdirSync(out,{recursive:true});
const M=await load(C.master);let body=M;const report={};
async function plate(file,roi){const m=await load(file),r=register(M,m,roi);report[file]=r.p.map(v=>+v.toFixed(4));return warp(m,r);}
for(const [name,L] of Object.entries(C.cut)){
 // a part removed in the plate becomes its own layer, the plate fills the hole in the body
 const P=await plate(L.plate,L.roi),mask=solid(diff(M,P),W,H,L.poly,L.opt??{});
 body=over(body,P,mask);await save(apply(M,mask),out+name+'.png');
}
await save(body,out+'body.png');
const rig={layers:{}};
// every texture is cropped to what it covers; the rig keeps the offset in master pixels
async function crop(img,alphaOf,name,pad=4){let x0=W,y0=H,x1=0,y1=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(alphaOf(y*W+x)>2){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
 x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(W-1,x1+pad);y1=Math.min(H-1,y1+pad);const w=x1-x0+1,h=y1-y0+1;
 await sharp(Buffer.from(img.d),{raw:{width:W,height:H,channels:4}}).extract({left:x0,top:y0,width:w,height:h}).webp({quality:92,alphaQuality:95}).toFile(out+name+'.webp');return[x0,y0,w,h];}
rig.layers.body=await crop(body,i=>body.d[i*4+3],'body',0);
for(const name of Object.keys(C.cut)){const L=await load(out+name+'.png');rig.layers[name]=await crop(L,i=>L.d[i*4+3],name);}
for(const [name,L] of Object.entries(C.gestures??{})){
 // a gesture replaces the body inside its mask, also where the plate is empty
 const P=await plate(L.plate,L.roi),mask=solid(diff(L.against==='body'?body:M,P),W,H,L.poly,L.opt??{});
 // what the old arm covered and the new pose leaves empty is erased with a hard edge
 if(L.erase){const [ex0,ey0,ex1,ey1]=L.erase;let e=new Float32Array(W*H);const ref=L.against==='body'?body:M;for(let y=ey0;y<ey1;y++)for(let x=ex0;x<ex1;x++){const i=y*W+x;if(ref.d[i*4+3]>20&&P.d[i*4+3]<90)e[i]=1;}
  e=blurF(e,W,H,3);for(let i=0;i<W*H;i++)if(e[i]>.05)mask[i]=1;}
 const img={d:new Uint8ClampedArray(P.d),w:W,h:H};for(let i=0;i<W*H;i++)if(mask[i]<.004)img.d.fill(0,i*4,i*4+4);
 const r=await crop(img,i=>mask[i]*255,'gesture-'+name);const m=Buffer.alloc(r[2]*r[3]);for(let y=0;y<r[3];y++)for(let x=0;x<r[2];x++)m[y*r[2]+x]=Math.round(mask[(y+r[1])*W+x+r[0]]*255);
 await sharp(m,{raw:{width:r[2],height:r[3],channels:1}}).webp({quality:92}).toFile(out+'gesture-'+name+'-mask.webp');rig.layers['gesture-'+name]=r;
}
for(const f of fs.readdirSync(out).filter(f=>/^face-.*\.png$/.test(f))){const L=await load(out+f);rig.layers[f.slice(0,-4)]=await crop(L,i=>L.d[i*4+3],f.slice(0,-4));}
fs.writeFileSync(out+'crops.json',JSON.stringify(rig.layers));
fs.writeFileSync(out+'bake.json',JSON.stringify(report,null,1));console.log(report);
