import sharp from 'sharp';
export const W=1024,H=1536;
export const load=async(f,w=W,h=H)=>{const {data,info}=await sharp(f).ensureAlpha().resize(w,h,{fit:'fill'}).raw().toBuffer({resolveWithObject:true});return {d:data,w:info.width,h:info.height};};
export const save=(img,f)=>sharp(Buffer.from(img.d),{raw:{width:img.w,height:img.h,channels:4}}).png().toFile(f);
const lum=(img,i)=>img.d[i*4+3]<16?255:(img.d[i*4]*.3+img.d[i*4+1]*.59+img.d[i*4+2]*.11);
/** Bilinear sample of an RGBA image. */
export function sample(img,x,y,o){const X=Math.max(0,Math.min(img.w-1.001,x)),Y=Math.max(0,Math.min(img.h-1.001,y)),ix=X|0,iy=Y|0,fx=X-ix,fy=Y-iy,a=(iy*img.w+ix)*4,b=a+4,c=a+img.w*4,d=c+4;
 for(let k=0;k<4;k++)o[k]=(img.d[a+k]*(1-fx)+img.d[b+k]*fx)*(1-fy)+(img.d[c+k]*(1-fx)+img.d[d+k]*fx)*fy;return o;}
/** Map from target pixel to source pixel: similarity with rotation about the roi centre. */
export const mapper=(p,cx,cy)=>(x,y)=>{const c=Math.cos(p[1]),s=Math.sin(p[1]),dx=x-cx-p[2],dy=y-cy-p[3];return[cx+(c*dx+s*dy)/p[0],cy+(-s*dx+c*dy)/p[0]];};
/** Finds scale, rotation and shift that bring `mov` onto `ref` inside a region of interest. */
export function register(ref,mov,roi,init=[1,0,0,0]){
 const [x0,y0,x1,y1]=roi,cx=(x0+x1)/2,cy=(y0+y1)/2,o=[0,0,0,0],step=Math.max(2,Math.round((x1-x0)/90));
 const cost=p=>{const m=mapper(p,cx,cy);let e=0,n=0;for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){const r=lum(ref,y*ref.w+x);const [u,v]=m(x,y);sample(mov,u,v,o);const l=o[3]<16?255:o[0]*.3+o[1]*.59+o[2]*.11;e+=Math.abs(l-r);n++;}return e/n;};
 let best=[...init],bc=cost(best),st=[.02,.01,8,8];
 for(let it=0;it<200;it++){let ok=false;for(let k=0;k<4;k++)for(const sg of [-1,1]){const t=[...best];t[k]+=sg*st[k];const c=cost(t);if(c<bc){bc=c;best=t;ok=true;}}if(!ok){st=st.map(v=>v/1.6);if(st[2]<.15)break;}}
 return {p:best,cost:bc,cx,cy};}
export function warp(mov,reg,w=W,h=H){const m=mapper(reg.p,reg.cx,reg.cy),out={d:new Uint8ClampedArray(w*h*4),w,h},o=[0,0,0,0];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const [u,v]=m(x,y);if(u<0||v<0||u>mov.w-1||v>mov.h-1)continue;sample(mov,u,v,o);const i=(y*w+x)*4;for(let k=0;k<4;k++)out.d[i+k]=o[k];}return out;}
/** Per pixel difference after both are composed on grey. */
export function diff(a,b){const out=new Float32Array(a.w*a.h);for(let i=0;i<a.w*a.h;i++){let e=0;for(let k=0;k<3;k++){const p=a.d[i*4+k]*a.d[i*4+3]/255+128*(1-a.d[i*4+3]/255),q=b.d[i*4+k]*b.d[i*4+3]/255+128*(1-b.d[i*4+3]/255);e+=Math.abs(p-q);}out[i]=e/3;}return out;}
export function blurF(f,w,h,r){const t=new Float32Array(f.length),o=new Float32Array(f.length);for(let y=0;y<h;y++){let s=0;for(let x=-r;x<w+r;x++){if(x+r<w)s+=f[y*w+Math.min(w-1,x+r)]*(x+r>=0?1:0);if(x-r-1>=0)s-=f[y*w+x-r-1];if(x>=0&&x<w)t[y*w+x]=s/(2*r+1);}}
 for(let x=0;x<w;x++){let s=0;for(let y=-r;y<h+r;y++){if(y+r<h&&y+r>=0)s+=t[(y+r)*w+x];if(y-r-1>=0)s-=t[(y-r-1)*w+x];if(y>=0&&y<h)o[y*w+x]=s/(2*r+1);}}return o;}
export const inside=(poly,x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
/** A soft mask: pixels that differ, inside a polygon of the region. */
export function changed(dif,w,h,poly,thr=22,grow=3,soft=2){let m=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(inside(poly,x/w,y/h))m[i]=dif[i]>thr?1:0;}
 m=blurF(m,w,h,grow);for(let i=0;i<m.length;i++)m[i]=m[i]>.12?1:0;m=blurF(m,w,h,soft);return m;}
export function apply(img,mask){const o={d:new Uint8ClampedArray(img.d),w:img.w,h:img.h};for(let i=0;i<img.w*img.h;i++)o.d[i*4+3]=img.d[i*4+3]*mask[i];return o;}
export function over(base,top,mask){const o={d:new Uint8ClampedArray(base.d),w:base.w,h:base.h};for(let i=0;i<base.w*base.h;i++){const m=mask[i];if(!m)continue;for(let k=0;k<4;k++)o.d[i*4+k]=base.d[i*4+k]*(1-m)+top.d[i*4+k]*m;}return o;}
/** Keeps the largest connected parts of a binary mask and fills their holes. */
export function solid(dif,w,h,poly,{thr=22,close=5,keep=1,min=800,soft=1.5}={}){
 let m=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(inside(poly,x/w,y/h)&&dif[i]>thr)m[i]=1;}
 m=blurF(m,w,h,close);const b=new Uint8Array(w*h);for(let i=0;i<m.length;i++)b[i]=m[i]>.3?1:0;
 const lab=new Int32Array(w*h),sizes=[0];let n=0;
 for(let i=0;i<w*h;i++){if(!b[i]||lab[i])continue;n++;let s=0;const q=[i];lab[i]=n;while(q.length){const j=q.pop();s++;const x=j%w;for(const k of [x?j-1:-1,x<w-1?j+1:-1,j-w,j+w])if(k>=0&&k<w*h&&b[k]&&!lab[k]){lab[k]=n;q.push(k);}}sizes.push(s);}
 const order=sizes.map((s,i)=>[s,i]).slice(1).sort((a,b)=>b[0]-a[0]).filter(([s])=>s>=min).slice(0,keep).map(([,i])=>i);
 const k=new Uint8Array(w*h);for(let i=0;i<w*h;i++)k[i]=order.includes(lab[i])?1:0;
 // holes: whatever the outside cannot reach
 const out=new Uint8Array(w*h),q=[];for(let x=0;x<w;x++)q.push(x,(h-1)*w+x);for(let y=0;y<h;y++)q.push(y*w,y*w+w-1);
 while(q.length){const j=q.pop();if(out[j]||k[j])continue;out[j]=1;const x=j%w;if(x)q.push(j-1);if(x<w-1)q.push(j+1);if(j>=w)q.push(j-w);if(j<w*(h-1))q.push(j+w);}
 let f=new Float32Array(w*h);for(let i=0;i<w*h;i++)f[i]=out[i]?0:1;return soft?blurF(f,w,h,Math.round(soft)):f;}
