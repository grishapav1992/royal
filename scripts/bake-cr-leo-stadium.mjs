// Derives the cloud and crowd layers of CR vs. Leo from the approved stadium plate. No new artwork.
// Usage: node scripts/bake-cr-leo-stadium.mjs. Prints the roof line kept in games/cr-vs-leo/stands.ts.
import {chromium} from '@playwright/test';import {readFileSync,writeFileSync} from 'node:fs';
const out='public/assets/cr-vs-leo/v3';
const src='data:image/webp;base64,'+readFileSync('public/assets/cr-vs-leo/v2/stadium-free.webp').toString('base64');
const b=await chromium.launch({channel:'chrome'}),p=await b.newPage();
const r=await p.evaluate(async src=>{
 const im=new Image();im.src=src;await im.decode();const W=im.width,H=im.height;
 const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
 const c=mk(W,H),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(im,0,0);
 const id=x.getImageData(0,0,W,H),d=id.data,at=(X,Y)=>(Y*W+X)*4;
 const blue=(i)=>d[i+2]-d[i]>26&&d[i+2]>150, white=i=>Math.min(d[i],d[i+1],d[i+2])>196;
 // sky edge: lowest y of the run of sky from the top of each column
 const edge=new Float32Array(W);
 for(let X=0;X<W;X++){let y=0,miss=0,last=-1;for(;y<200;y++){const i=at(X,y);if(blue(i)||(white(i)&&d[i+2]>=d[i]-2)){last=y;miss=0}else if(++miss>1)break}edge[X]=last}
 const med=new Float32Array(W);for(let X=0;X<W;X++){const a=[];for(let k=-9;k<=9;k++)a.push(edge[Math.max(0,Math.min(W-1,X+k))]);a.sort((p,q)=>p-q);med[X]=Math.max(0,a[5]-5)}
 // base sky fit: quadratic in x,y per channel from clearly blue pixels
 const fit=ch=>{const n=10,A=Array.from({length:n},()=>new Float64Array(n+1));
  for(let X=0;X<W;X+=3)for(let Y=0;Y<med[X]-3;Y+=2){const i=at(X,Y);if(d[i+2]-d[i]<75)continue;const u=X/W,v=Y/200,f=[1,u,v,u*u,u*v,v*v,u*u*u,u*u*v,u*v*v,v*v*v];for(let a=0;a<n;a++){for(let q=0;q<n;q++)A[a][q]+=f[a]*f[q];A[a][n]+=f[a]*d[i+ch]}}
  for(let a=0;a<n;a++){let m=a;for(let q=a;q<n;q++)if(Math.abs(A[q][a])>Math.abs(A[m][a]))m=q;[A[a],A[m]]=[A[m],A[a]];for(let q=0;q<n;q++)if(q!==a){const k=A[q][a]/A[a][a];for(let z=a;z<=n;z++)A[q][z]-=k*A[a][z]}}
  return A.map((row,a)=>row[n]/row[a])};
 const F=[fit(0),fit(1),fit(2)];const base=(X,Y,ch)=>{const u=X/W,v=Y/200,f=[1,u,v,u*u,u*v,v*v,u*u*u,u*u*v,u*v*v,v*v*v];return Math.max(0,Math.min(255,f.reduce((s,q,a)=>s+q*F[ch][a],0)))};
 const SH=200,al=new Float32Array(W*SH);
 for(let X=0;X<W;X++)for(let Y=0;Y<SH;Y++)if(Y<med[X]){const i=at(X,Y),br=base(X,Y,0);al[Y*W+X]=Math.max(0,Math.min(1,(d[i]-br-9)/(238-br)))}
 // connected clouds; keep the ones attached to the roof or the frame in the plate
 const lab=new Int32Array(W*SH);let n=0;const comps=[];
 for(let s=0;s<W*SH;s++)if(!lab[s]&&al[s]>.035){n++;const q=[s];lab[s]=n;let touch=false,area=0,x0=W,x1=0;
  while(q.length){const k=q.pop(),X=k%W,Y=k/W|0;area++;x0=Math.min(x0,X);x1=Math.max(x1,X);if(Y>=med[X]-3||X<2||X>W-3)touch=true;
   for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0]]){const a=X+dx,e=Y+dy;if(a<0||a>=W||e<0||e>=SH)continue;const z=e*W+a;if(!lab[z]&&al[z]>.035){lab[z]=n;q.push(z)}}}
  comps[n]={touch,area,x0,x1}}
 const keep=new Uint8Array(W*SH);for(let s=0;s<W*SH;s++){const l=lab[s];if(l&&!comps[l].touch&&comps[l].area>120)keep[s]=1}
 // dilate for soft rims
 const soft=new Float32Array(W*SH);for(let Y=0;Y<SH;Y++)for(let X=0;X<W;X++){let m=0;for(let a=-6;a<=6;a++)for(let e=-6;e<=6;e++){const A=X+a,E=Y+e;if(A<0||A>=W||E<0||E>=SH)continue;if(keep[E*W+A]){const q=Math.max(0,1-Math.hypot(a,e)/7);if(q>m)m=q}}soft[Y*W+X]=keep[Y*W+X]?1:m}
 const cl=mk(W,SH),cx=cl.getContext('2d'),ci=cx.createImageData(W,SH);
 for(let s=0;s<W*SH;s++){const X=s%W,Y=s/W|0,i=s*4,k=Y<med[X]?soft[s]:0;const a=k?Math.max(0,Math.min(1,(d[i]-base(X,Y,0))/(250-base(X,Y,0))))*k:0;
  ci.data[i]=ci.data[i+1]=ci.data[i+2]=252;ci.data[i+3]=a>.02?a*255:0;
  if(k){for(let ch=0;ch<3;ch++)d[i+ch]=d[i+ch]*(1-k)+base(X,Y,ch)*k}}
 cx.putImageData(ci,0,0);x.putImageData(id,0,0);
 // crowd mask from local contrast between roof and hoardings
 const x2=mk(W,H).getContext('2d',{willReadFrequently:true});x2.drawImage(im,0,0);const o=x2.getImageData(0,0,W,H).data;
 const Y0=160,Y1=430,MH=Y1-Y0,v=new Float32Array(W*MH);const L=(X,Y)=>{const i=at(X,Y);return .3*o[i]+.59*o[i+1]+.11*o[i+2]};
 for(let Y=Y0;Y<Y1;Y++)for(let X=0;X<W;X++){let s=0,s2=0,nn=0;for(let a=-5;a<=5;a+=2)for(let e=-4;e<=4;e+=2){const l=L(Math.max(0,Math.min(W-1,X+a)),Y+e);s+=l;s2+=l*l;nn++}v[(Y-Y0)*W+X]=Math.sqrt(Math.max(0,s2/nn-(s/nn)**2))}
 const mc=mk(W,MH),mx=mc.getContext('2d'),mi=mx.createImageData(W,MH);
 for(let s=0;s<W*MH;s++){const k=Math.max(0,Math.min(1,(v[s]-26)/14));mi.data[s*4]=mi.data[s*4+1]=mi.data[s*4+2]=255;mi.data[s*4+3]=k*255}
 mx.putImageData(mi,0,0);
 const tiers=mk(W,MH),tx=tiers.getContext('2d');tx.filter='blur(1.5px)';
 const X5=[0,150,300,530,768,1000,1240,1390,1536],poly=(a,z)=>{tx.beginPath();X5.forEach((q,i)=>i?tx.lineTo(q,a[i]-Y0):tx.moveTo(q,a[i]-Y0));[...X5].reverse().forEach((q,i)=>tx.lineTo(q,z[X5.length-1-i]-Y0));tx.fill()};
 poly([186,212,237,250,255,250,236,213,186],[277,300,313,322,324,322,314,300,276]);poly([316,333,342,347,349,347,343,333,312],[419,419,419,419,419,419,419,419,419]);
 const sm=mk(W/2,MH/2),sx=sm.getContext('2d');sx.filter='blur(1.5px)';sx.drawImage(mc,0,0,W/2,MH/2);sx.filter='none';sx.globalCompositeOperation='destination-in';sx.drawImage(tiers,0,0,W/2,MH/2);
 const dump=(cv,t,q)=>cv.toDataURL(t,q);
 return{plate:dump(c,'image/webp',.9),clouds:dump(cl,'image/webp',.9),mask:dump(sm,'image/webp',.8),edge:[...med].filter((_,i)=>i%12===0).map(v=>Math.round(v)),comps:comps.filter(Boolean).filter(c=>c.area>120)};
},src);
for(const [k,f] of [['plate','stadium-clear.webp'],['clouds','clouds.webp'],['mask','crowd-mask.webp']])writeFileSync(out+'/'+f,Buffer.from(r[k].split(',')[1],'base64'));
console.log(r.edge.join(','));await b.close();
