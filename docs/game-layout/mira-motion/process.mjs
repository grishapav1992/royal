// Turns raw a6api answers into cells aligned with the source game frame.
// node process.mjs <id> <sheet> <cols> <rows> <baseIndex> [<id> <sheet> ...]
import {createRequire} from 'node:module';
import fs from 'node:fs';
const sharp=createRequire(import.meta.url)('sharp');
const DIR=new URL('.',import.meta.url).pathname, ROOT=DIR+'../';
fs.mkdirSync(DIR+'proc',{recursive:true});

async function cellOf(sheet,cols,rows,index){
  const m=await sharp(ROOT+sheet).metadata(),W=Math.floor(m.width/cols),H=Math.floor(m.height/rows);
  const left=Math.floor((index%cols)*m.width/cols),top=Math.floor(Math.floor(index/cols)*m.height/rows);
  const {data}=await sharp(ROOT+sheet).extract({left,top,width:W,height:H}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {W,H,data};
}
function stats(data,W,H){
  let L=W,T=H,R=-1,B=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(data[(y*W+x)*4+3]>200){if(x<L)L=x;if(x>R)R=x;if(y<T)T=y;if(y>B)B=y;}
  // Horizontal centre of the lower body, which stays put in these poses.
  let sum=0,n=0;const y0=Math.round(T+(B-T)*.72);
  for(let y=y0;y<=B;y++)for(let x=L;x<=R;x++)if(data[(y*W+x)*4+3]>200){sum+=x;n++;}
  return {L,T,R,B,h:B-T+1,cx:n?sum/n:(L+R)/2};
}
// Row of the gold belt: the gold-richest row in the lower half (earrings and pendant sit higher).
function beltRow(data,W,H,st){
  let best=-1,row=st.B;for(let y=Math.round(st.T+st.h*.38);y<=Math.round(st.T+st.h*.72);y++){let n=0;for(let x=st.L;x<=st.R;x++){const o=(y*W+x)*4;const r=data[o],g=data[o+1],b=data[o+2];if(data[o+3]>200&&r>170&&g>120&&b<90&&g-b>65&&r-g<85)n++;}if(n>best){best=n;row=y;}}
  return best>3?row:null;
}
function colourStats(data){const s=[[0,0],[0,0],[0,0]];let n=0;for(let o=0;o<data.length;o+=4)if(data[o+3]>200){n++;for(let c=0;c<3;c++){s[c][0]+=data[o+c];s[c][1]+=data[o+c]*data[o+c];}}
  return s.map(([a,b])=>{const m=a/n;return [m,Math.sqrt(Math.max(1,b/n-m*m))];});}
function transferColour(data,from,to){for(let o=0;o<data.length;o+=4)if(data[o+3]>0)for(let c=0;c<3;c++){const v=(data[o+c]-from[c][0])*(to[c][1]/from[c][1])+to[c][0];data[o+c]=Math.max(0,Math.min(255,Math.round(v)));}}
// Keeps the figure and drops loose background islands.
function dropIslands(data,W,H){const label=new Int32Array(W*H).fill(-1),sizes=[];
  for(let p=0;p<W*H;p++){if(label[p]>=0||data[p*4+3]<30)continue;const id=sizes.length;let n=0;const q=[p];label[p]=id;
    while(q.length){const c=q.pop();n++;const x=c%W,y=(c-x)/W;for(const d of [x>0?c-1:-1,x<W-1?c+1:-1,y>0?c-W:-1,y<H-1?c+W:-1])if(d>=0&&label[d]<0&&data[d*4+3]>=30){label[d]=id;q.push(d);}}
    sizes.push(n);}
  const keep=sizes.reduce((m,v,i)=>v>sizes[m]?i:m,0),limit=sizes[keep]*.02;let dropped=0;
  for(let p=0;p<W*H;p++)if(label[p]>=0&&label[p]!==keep&&sizes[label[p]]<limit){data[p*4+3]=0;dropped++;}
  return dropped;}
// Painted transparency checkerboards inside the silhouette: grey and white neutral squares joined into one patch.
function clearChecker(data,W,H){
  const kind=new Uint8Array(W*H);
  for(let p=0;p<W*H;p++){const o=p*4,r=data[o],g=data[o+1],b=data[o+2];if(data[o+3]<200||Math.abs(r-g)>12||Math.abs(g-b)>12)continue;const v=(r+g+b)/3;kind[p]=v>=140&&v<=219?1:v>=220?2:0;}
  const seen=new Uint8Array(W*H);let cleared=0;
  for(let p=0;p<W*H;p++){if(!kind[p]||seen[p])continue;const q=[p],part=[];let grey=0,white=0;seen[p]=1;
    while(q.length){const c=q.pop();part.push(c);kind[c]===1?grey++:white++;const x=c%W,y=(c-x)/W;
      for(const d of [x>0?c-1:-1,x<W-1?c+1:-1,y>0?c-W:-1,y<H-1?c+W:-1])if(d>=0&&kind[d]&&!seen[d]){seen[d]=1;q.push(d);}}
    if(part.length>150&&grey>part.length*.15&&white>part.length*.15){for(const c of part)data[c*4+3]=0;cleared+=part.length;}}
  return cleared;
}
// Removes a flat or near-flat painted background connected to the border.
function clearBackground(data,W,H){
  let transparentCorners=0;for(const [x,y] of [[2,2],[W-3,2],[2,H-3],[W-3,H-3]])if(data[(y*W+x)*4+3]<40)transparentCorners++;
  if(transparentCorners>=3)return 'alpha';
  const samples=[];for(let i=0;i<W;i+=16){samples.push([i,0],[i,H-1]);}for(let j=0;j<H;j+=16){samples.push([0,j],[W-1,j]);}
  const tone=samples.map(([x,y])=>{const o=(y*W+x)*4;return [data[o],data[o+1],data[o+2]];});
  const dist=(o,c)=>Math.hypot(data[o]-c[0],data[o+1]-c[1],data[o+2]-c[2]);
  const near=o=>tone.reduce((m,c)=>Math.min(m,dist(o,c)),1e9);
  const seen=new Uint8Array(W*H),queue=[];
  for(let x=0;x<W;x++)queue.push(x,(H-1)*W+x);for(let y=0;y<H;y++)queue.push(y*W,y*W+W-1);
  while(queue.length){const p=queue.pop();if(seen[p])continue;seen[p]=1;const o=p*4,d=near(o);if(d>34)continue;
    data[o+3]=d<20?0:Math.round(255*(d-20)/14);const x=p%W,y=(p-x)/W;
    if(x>0)queue.push(p-1);if(x<W-1)queue.push(p+1);if(y>0)queue.push(p-W);if(y<H-1)queue.push(p+W);}
  // Light painted backgrounds also show through closed gaps between arm and body: clear large enclosed patches of the same tones.
  const light=tone.reduce((a,c)=>a+(c[0]+c[1]+c[2])/3,0)/tone.length>150;let enclosed=0;
  if(light){const mark=new Uint8Array(W*H);for(let p=0;p<W*H;p++)if(data[p*4+3]>0&&near(p*4)<18)mark[p]=1;
    const done=new Uint8Array(W*H);
    for(let p=0;p<W*H;p++){if(!mark[p]||done[p])continue;const q=[p],part=[];done[p]=1;
      while(q.length){const c=q.pop();part.push(c);const x=c%W,y=(c-x)/W;for(const d of [x>0?c-1:-1,x<W-1?c+1:-1,y>0?c-W:-1,y<H-1?c+W:-1])if(d>=0&&mark[d]&&!done[d]){done[d]=1;q.push(d);}}
      if(part.length>300){for(const c of part)data[c*4+3]=0;enclosed+=part.length;}}}
  return 'cleared'+(enclosed?' enclosed '+enclosed:'');
}
const args=process.argv.slice(2);
for(let i=0;i<args.length;i+=5){
  const [id,sheet,cols,rows,base]=[args[i],args[i+1],+args[i+2],+args[i+3],+args[i+4]];
  const rawPath=fs.existsSync(`${DIR}raw/${id}.png`)?`${DIR}raw/${id}.png`:`${DIR}dl/${id}.png`;
  const ref=await cellOf(sheet,cols,rows,base),rs=stats(ref.data,ref.W,ref.H);
  // The request placed the cell x3 in the middle of a 1024 square; undo that framing.
  let {data,info}=await sharp(rawPath).resize(1024,1024).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let mode=clearBackground(data,1024,1024);
  if(sheet.startsWith('react')){const n=clearChecker(data,1024,1024);if(n)mode+=' checker '+n;}
  // Crop a margin around the original cell so a slightly larger figure is not cut before measuring.
  const M=1.3,w=Math.min(1024,Math.round(ref.W*3*M)),h=Math.min(1024,Math.round(ref.H*3*M)),left=Math.round((1024-w)/2),top=Math.round((1024-h)/2);
  const GW=Math.round(w/3),GH=Math.round(h/3);
  const gen=await sharp(data,{raw:{width:1024,height:1024,channels:4}}).extract({left,top,width:w,height:h}).resize(GW,GH).raw().toBuffer();
  const islands=dropIslands(gen,GW,GH);
  const gs=stats(gen,GW,GH),rb=beltRow(ref.data,ref.W,ref.H,rs),gb=beltRow(gen,GW,GH,gs);
  const kh=rs.h/gs.h,kb=rb!==null&&gb!==null?(rb-rs.T)/(gb-gs.T):kh,useBelt=Math.abs(kb-kh)<=.06;
  const k=Math.max(.8,Math.min(1.2,useBelt?kb:kh));
  transferColour(gen,colourStats(gen),colourStats(ref.data));
  const sw=Math.round(GW*k),sh=Math.round(GH*k);
  const scaled=await sharp(gen,{raw:{width:GW,height:GH,channels:4}}).resize(sw,sh).png().toBuffer();
  const dx=Math.round(rs.cx-gs.cx*k),dy=Math.round(useBelt&&rb!==null&&gb!==null?rb-gb*k:rs.B-gs.B*k);
  const pad=Math.max(sw,sh);
  const canvas=await sharp({create:{width:ref.W+2*pad,height:ref.H+2*pad,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite([{input:scaled,left:pad+dx,top:pad+dy}]).png().toBuffer();
  await sharp(canvas).extract({left:pad,top:pad,width:ref.W,height:ref.H}).png().toFile(`${DIR}proc/${id}.png`);
  if(process.env.DEBUG)console.log(JSON.stringify({rs,rb,gs,gb,GW,GH}));
  const mode2=mode+(islands?' islands '+islands:'')+' belt '+(useBelt?'yes':'no');
  console.log(id,mode2,'scale',k.toFixed(3),'dx',dx,'dy',dy,'refH',rs.h,'genH',gs.h);
}
