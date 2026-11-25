/** The six existing symbols. Winning symbols move by cutting and warping the same drawings. */
import {loadImage} from './gl';
import {MEDIA} from './media';
export const NAMES=['map','compass','pistol','cutlass','ruby','parrot'] as const;
export const images:HTMLImageElement[]=[];
let loading:Promise<void>|undefined;
/** The decoded drawings are shared by every opening of the game. */
export function loadSymbols(){return loading??=Promise.all(NAMES.map(n=>loadImage(MEDIA+'symbol-'+n+'.webp'))).then(l=>{images.push(...l);}).catch(error=>{loading=undefined;throw error;});}
let fit:HTMLCanvasElement[]=[],cache:HTMLCanvasElement[]=[],blur:HTMLCanvasElement[]=[],cacheSize=0;
/** Good quality small copies for the ordinary cells, and a vertical smear for rolling reels. */
export function prepare(size:number){
  size=Math.max(8,Math.round(size));if(size===cacheSize||!images.length)return;cacheSize=size;
  cache=images.map(i=>{let src:CanvasImageSource=i,w=i.naturalWidth,h=i.naturalHeight;const s=Math.min(size/w,size/h);
    while(w*.5>i.naturalWidth*s){const c=document.createElement('canvas');c.width=w=Math.round(w/2);c.height=h=Math.round(h/2);const g=c.getContext('2d')!;g.imageSmoothingQuality='high';g.drawImage(src,0,0,w,h);src=c;}
    const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d')!;g.imageSmoothingQuality='high';const dw=i.naturalWidth*s,dh=i.naturalHeight*s;g.drawImage(src,(size-dw)/2,(size-dh)/2,dw,dh);const t=document.createElement('canvas');t.width=Math.round(dw);t.height=Math.round(dh);const q=t.getContext('2d')!;q.imageSmoothingQuality='high';q.drawImage(src,0,0,t.width,t.height);fit[images.indexOf(i)]=t;return c;});
  blur=cache.map(c=>{const b=document.createElement('canvas');b.width=size;b.height=size*1.7;const g=b.getContext('2d')!;for(let k=0;k<28;k++){g.globalAlpha=.062;g.drawImage(c,0,size*.35+(k-13.5)*size*.024);}return b;});
}
type G=CanvasRenderingContext2D;
export function rolling(g:G,id:number,cx:number,cy:number,size:number,speed:number){
  const a=clamp01((speed-6)/14);
  if(!cache[id])return;if(a<1){g.globalAlpha=1-a;g.drawImage(cache[id],cx-size/2,cy-size/2,size,size);}
  if(a>0){g.globalAlpha=a;g.drawImage(blur[id],cx-size/2,cy-size*.85,size,size*1.7);}
  g.globalAlpha=1;
}
const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
export function plain(g:G,id:number,cx:number,cy:number,size:number){
  if(!images[id])return;
  const big=size*(g.getTransform().a||1)>cacheSize*1.35;
  if(!big&&cache[id]){g.drawImage(cache[id],cx-size/2,cy-size/2,size,size);return;}
  const i=images[id],s=Math.min(size/i.naturalWidth,size/i.naturalHeight);g.drawImage(i,cx-i.naturalWidth*s/2,cy-i.naturalHeight*s/2,i.naturalWidth*s,i.naturalHeight*s);
}
function frameOf(id:number,size:number,k:number){const o=images[id],s=Math.min(size/o.naturalWidth,size/o.naturalHeight),i=size*k<=cacheSize*1.35&&fit[id]?fit[id]:o;return{i,iw:o===i?o.naturalWidth:(i as HTMLCanvasElement).width,ih:o===i?o.naturalHeight:(i as HTMLCanvasElement).height,w:o.naturalWidth*s,h:o.naturalHeight*s};}
let scratch:HTMLCanvasElement|undefined;
export type Spawn=(kind:'flash'|'feather'|'glint'|'puff'|'ember',x:number,y:number,size:number,dir?:number)=>void;
/** `u` runs once from 0 to 1. `last` is the previous value, so accents are spawned once. */
export function alive(g:G,id:number,cx:number,cy:number,size:number,u:number,last:number,spawn:Spawn){
  const {i,w,h,iw,ih}=frameOf(id,size,g.getTransform().a||1),x=(a:number)=>(a-.5)*w,y=(a:number)=>(a-.5)*h,hit=(m:number)=>last<m&&u>=m;
  const pop=Math.sin(Math.min(1,u*3)*Math.PI)*.07*(1-u*.4);
  g.save();g.translate(cx,cy);
  if(id===0){
    g.rotate(Math.sin(u*Math.PI*5)*.05*(1-u));g.scale(1+pop+.03*Math.sin(u*Math.PI*3),1+pop);g.drawImage(i,-w/2,-h/2,w,h);
    const k=Math.sin(u*Math.PI)*(.6+.4*Math.sin(u*Math.PI*7)),r=w*.16,mx=x(.80),my=y(.44);
    const gr=g.createRadialGradient(mx,my,0,mx,my,r);gr.addColorStop(0,`rgba(255,70,40,${.62*k})`);gr.addColorStop(1,'rgba(255,60,30,0)');g.globalCompositeOperation='lighter';g.fillStyle=gr;g.fillRect(mx-r,my-r,r*2,r*2);g.globalCompositeOperation='source-over';
    g.setLineDash([w*.022,w*.022]);g.lineDashOffset=-u*w*.4;g.strokeStyle=`rgba(190,30,18,${Math.sin(u*Math.PI)})`;g.lineWidth=w*.014;g.beginPath();g.moveTo(x(.36),y(.50));g.quadraticCurveTo(x(.5),y(.30),x(.63),y(.44));g.quadraticCurveTo(x(.7),y(.54),mx,my);g.stroke();
  }else if(id===1){
    g.rotate(Math.sin(u*Math.PI*4)*.035*(1-u));g.scale(1+pop,1+pop);g.drawImage(i,-w/2,-h/2,w,h);
    const dx=x(.543),dy=y(.555),r=w*.192,turn=(1-(1-u)**3)*Math.PI*6+Math.sin(u*26)*.25*(1-u);
    g.save();g.beginPath();g.arc(dx,dy,r,0,7);g.clip();g.translate(dx,dy);g.rotate(turn);g.translate(-dx,-dy);g.drawImage(i,-w/2,-h/2,w,h);g.restore();
    if(hit(.1)||hit(.6))spawn('glint',cx+x(.43),cy+y(.30),size*.3);
  }else if(id===2){
    const shots=[.12,.46];let rec=0;for(const s of shots)if(u>s)rec+=Math.exp(-(u-s)*13);
    g.translate(x(.15),y(.8));g.rotate(-rec*.24);g.translate(-x(.15)-rec*w*.05,-y(.8));g.scale(1+pop*.6,1+pop*.6);g.drawImage(i,-w/2,-h/2,w,h);
    for(const s of shots)if(hit(s)){spawn('flash',cx+x(1.0),cy+y(.10),size*.42,-.35);spawn('puff',cx+x(1.0),cy+y(.08),size*.3,-.35);}
  }else if(id===3){
    const a=u<.18?-.55*ease3(u/.18):u<.42?lerp2(-.55,.42,ease3((u-.18)/.24)):.42*Math.cos((u-.42)*9)*Math.exp(-(u-.42)*5);
    g.translate(x(.2),y(.7));g.rotate(a);g.translate(-x(.2),-y(.7));g.scale(1+pop*.5,1+pop*.5);
    if(u>.18&&u<.5){g.globalAlpha=.16;for(let k=1;k<5;k++){g.save();g.translate(x(.2),y(.7));g.rotate(-.11*k);g.translate(-x(.2),-y(.7));g.drawImage(i,-w/2,-h/2,w,h);g.restore();}g.globalAlpha=1;}
    g.drawImage(i,-w/2,-h/2,w,h);
    if(hit(.4))spawn('glint',cx+x(.92),cy+y(.16),size*.4);if(hit(.62))spawn('glint',cx+x(.66),cy+y(.4),size*.26);
  }else if(id===4){
    const s=Math.max(8,Math.round(Math.max(w,h)*(g.getTransform().a||1)));scratch??=document.createElement('canvas');if(scratch.width!==s){scratch.width=scratch.height=s;}
    const c=scratch.getContext('2d')!;c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.clearRect(0,0,s,s);const k=s/Math.max(w,h);c.drawImage(i,(s-w*k)/2,(s-h*k)/2,w*k,h*k);
    c.globalCompositeOperation='source-atop';const p=((u*2.2)%1.1)*1.6-.3,gr=c.createLinearGradient(s*(p-.16),s*(p*.4),s*(p+.16),s*(p*.4+.22));gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(.5,'rgba(255,244,240,.75)');gr.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=gr;c.fillRect(0,0,s,s);
    g.globalCompositeOperation='lighter';const r=size*.62,k2=Math.sin(u*Math.PI)*.55,rg=g.createRadialGradient(0,0,0,0,0,r);rg.addColorStop(0,`rgba(255,40,70,${k2})`);rg.addColorStop(1,'rgba(255,20,50,0)');g.fillStyle=rg;g.fillRect(-r,-r,r*2,r*2);g.globalCompositeOperation='source-over';
    g.rotate(Math.sin(u*Math.PI*3)*.05*(1-u));g.scale(1+pop*1.3,1+pop*1.3);const d=Math.max(w,h);g.drawImage(scratch,-d/2,-d/2,d,d);
    if(hit(.2))spawn('glint',cx+x(.35),cy+y(.3),size*.4);if(hit(.55))spawn('glint',cx+x(.66),cy+y(.62),size*.3);
  }else{
    const f=Math.sin(u*Math.PI*7)*(1-u*.35)*Math.min(1,u*6),n=22;
    g.translate(0,-Math.abs(Math.sin(u*Math.PI*3.5))*h*.025);g.scale(1+pop*.5,1+pop*.5);
    for(let k=0;k<n;k++){
      const a=k/n,b=(k+1)/n,m=(a+b)/2,left=m<.54?((.54-m)/.54)**1.25:0,right=m>.76?((m-.76)/.24)**1.2:0;
      const dy=(left*-.13+right*-.07)*f*h,cut=left?.56:right?.58:0,ov=.7;
      if(!cut){g.drawImage(i,a*iw,0,iw/n+1,ih,x(a),y(0),w/n+ov,h);continue;}
      g.drawImage(i,a*iw,0,iw/n+1,cut*ih,x(a),y(0)+dy,w/n+ov,cut*h-dy);
      g.drawImage(i,a*iw,cut*ih,iw/n+1,(1-cut)*ih,x(a),y(cut),w/n+ov,(1-cut)*h);
    }
    for(const s of [.15,.35,.55])if(hit(s))spawn('feather',cx+x(.2+Math.random()*.6),cy+y(.3),size*.2);
  }
  g.restore();
}
const ease3=(t:number)=>1-(1-Math.max(0,Math.min(1,t)))**3,lerp2=(a:number,b:number,t:number)=>a+(b-a)*t;
