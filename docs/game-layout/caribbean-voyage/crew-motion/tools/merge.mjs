import sharp from 'sharp';
const W=1024,H=1536,raw=async f=>(await sharp(f).ensureAlpha().raw().toBuffer());
const m=await raw('gen/freya-master.png');
const p=await sharp({create:{width:W,height:H,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:await sharp('gen/freya-m1.png').resize(889,1332,{kernel:'lanczos3'}).png().toBuffer(),left:29,top:13}]).raw().toBuffer();
// background of the checkerboard: light, colourless, connected to the border
const bg=new Uint8Array(W*H),q=[];const isBg=i=>{const a=m[i*4],b=m[i*4+1],c=m[i*4+2];return Math.min(a,b,c)>218&&Math.max(a,b,c)-Math.min(a,b,c)<12;};
for(let x=0;x<W;x++){q.push(x,(H-1)*W+x);}for(let y=0;y<H;y++)q.push(y*W,y*W+W-1);
while(q.length){const i=q.pop();if(bg[i]||!isBg(i))continue;bg[i]=1;const x=i%W;if(x)q.push(i-1);if(x<W-1)q.push(i+1);if(i>=W)q.push(i-W);if(i<W*(H-1))q.push(i+W);}
let al=Buffer.alloc(W*H);for(let i=0;i<W*H;i++)al[i]=bg[i]?0:255;
al=await sharp(al,{raw:{width:W,height:H,channels:1}}).blur(1.3).linear(1.9,-180).toColourspace('b-w').raw().toBuffer();
// colour transfer of the new parts to the first drawing
const st=(b,sel)=>{const s=[0,0,0],s2=[0,0,0];let n=0;for(let i=0;i<W*H;i++)if(sel(i)){n++;for(let k=0;k<3;k++){const v=b[i*4+k];s[k]+=v;s2[k]+=v*v;}}return s.map((v,k)=>[v/n,Math.sqrt(s2[k]/n-(v/n)**2)]);};
const both=i=>p[i*4+3]>250&&al[i]>250&&i/W>700,A=st(m,both),B=st(p,both);console.log(A,B);
const out=Buffer.alloc(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
 // weight of the first drawing: full inside, fading at its cropped right and lower edges
 const w=Math.min(1,Math.max(0,(912-x)/26))*Math.min(1,Math.max(0,(1340-y)/30));
 const pa=p[i*4+3]/255,ma=al[i]/255,a=w*pa+(1-w)*ma;out[i*4+3]=Math.round(a*255);
 for(let k=0;k<3;k++){const mc=(m[i*4+k]-A[k][0])/A[k][1]*B[k][1]+B[k][0];const v=a>0?(w*pa*p[i*4+k]+(1-w)*ma*mc)/a:0;out[i*4+k]=Math.max(0,Math.min(255,Math.round(v)));}}
await sharp(out,{raw:{width:W,height:H,channels:4}}).png().toFile('gen/freya.png');
await sharp(out,{raw:{width:W,height:H,channels:4}}).resize(800,1200).flatten({background:'#2a6a80'}).png().toFile('z.png');
