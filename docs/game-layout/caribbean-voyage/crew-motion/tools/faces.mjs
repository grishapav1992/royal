// node faces.mjs <id> <master.png> <sheet.png> <cropX> <cropY> <cropSize> <features.json>
// Each feature (eye with brow, mouth with cheeks) is aligned on its own, then pasted with a soft ellipse.
import {W,H,load,save,register,warp} from './lib.mjs';
import sharp from 'sharp';import fs from 'node:fs';
const [id,mf,sf,cx,cy,cs,ff]=process.argv.slice(2).map((v,i)=>i<3||i===6?v:+v);
const feats=JSON.parse(fs.readFileSync(ff));const M=await load(mf),names=['blink','smile','laugh','surprise','soft','focus'],out=`layers/${id}/`;fs.mkdirSync(out,{recursive:true});
const sheet=await sharp(sf).ensureAlpha().raw().toBuffer({resolveWithObject:true}),report={};
for(let c=0;c<6;c++){
 const cell=await sharp(sheet.data,{raw:{width:sheet.info.width,height:sheet.info.height,channels:4}}).extract({left:c%3*512,top:Math.floor(c/3)*512,width:512,height:512}).resize(cs,cs,{kernel:'lanczos3'}).png().toBuffer();
 const placed=await load(await sharp({create:{width:W,height:H,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:cell,left:cx,top:cy}]).png().toBuffer());
 const fx=feats.face,g=register(M,placed,[fx[0]-fx[2],fx[1]-fx[3],fx[0]+fx[2],fx[1]+fx[3]]);
 const o={d:new Uint8ClampedArray(W*H*4),w:W,h:H},rep={global:g.p.map(v=>+v.toFixed(3))};
 for(const [name,[ex,ey,rx,ry]] of Object.entries(feats.parts)){
  if(names[c]==='blink'&&name==='mouth')continue;
  // the search box is wider than the paste ellipse; a closed eye has little texture, so lean on the brow and lashes
  const r=register(M,placed,[Math.round(ex-rx*1.5),Math.round(ey-ry*1.6),Math.round(ex+rx*1.5),Math.round(ey+ry*1.4)],[g.p[0],g.p[1],g.p[2]+(g.cx-ex)*(1-g.p[0])*0,g.p[3]]);
  const shiftOk=Math.hypot(r.p[2]-g.p[2],r.p[3]-g.p[3])<40;const use=shiftOk?r:g;const F=warp(placed,use);
  const st=[0,0,0,0,0,0];let n=0;
  for(let y=Math.max(0,ey-ry*1.3|0);y<Math.min(H,ey+ry*1.3);y++)for(let x=Math.max(0,ex-rx*1.3|0);x<Math.min(W,ex+rx*1.3);x++){const e=((x-ex)/rx)**2+((y-ey)/ry)**2;if(e<.8||e>1.3)continue;const i=(y*W+x)*4;if(M.d[i+3]<250||F.d[i+3]<250)continue;n++;for(let k=0;k<3;k++){st[k]+=M.d[i+k];st[k+3]+=F.d[i+k];}}
  const gain=[0,1,2].map(k=>st[k]/Math.max(1,st[k+3]));
  for(let y=Math.max(0,ey-ry|0);y<Math.min(H,ey+ry+1);y++)for(let x=Math.max(0,ex-rx|0);x<Math.min(W,ex+rx+1);x++){const e=Math.sqrt(((x-ex)/rx)**2+((y-ey)/ry)**2);if(e>=1)continue;const i=(y*W+x)*4,a=Math.min(1,(1-e)/.35)**1.4*Math.min(F.d[i+3],M.d[i+3])/255;
   const prev=o.d[i+3]/255,na=Math.max(prev,a);if(na<=0)continue;for(let k=0;k<3;k++){const v=Math.min(255,F.d[i+k]*gain[k]);o.d[i+k]=(o.d[i+k]*prev*(1-a)+v*a)/Math.max(1e-6,prev*(1-a)+a);}o.d[i+3]=na*255;}
  rep[name]={p:use.p.map(v=>+v.toFixed(3)),cost:+r.cost.toFixed(1),local:shiftOk};
 }
 await save(o,out+'face-'+names[c]+'.png');report[names[c]]=rep;
}
fs.writeFileSync(out+'faces.json',JSON.stringify(report,null,1));console.log(JSON.stringify(report));
