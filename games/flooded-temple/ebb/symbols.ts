/** The nine existing reliefs. Each has its own way to land and its own way to win, made from the same drawing. */
import {loadImage} from './gl';
import {clamp} from './clock';
type G=CanvasRenderingContext2D;
let atlas:HTMLImageElement,size=0;const sprites:HTMLCanvasElement[]=[];
export type Grain={x:number;y:number;c:string};export const grains:Grain[][]=[];
export const IDOL=0,SUN=1,JAGUAR=2,FALCON=3,SERPENT=4,MOON=5,FISH=6,WILD=7,RELIC=8;
export const GLOW=['255,196,84','255,150,60','255,120,90','96,226,206','120,230,130','130,160,255','205,130,255','255,214,110','110,255,226'];
export async function loadSymbols(){
  atlas=await loadImage('/assets/flooded-temple/cascade-symbols.webp');const c=document.createElement('canvas');c.width=c.height=48;const g=c.getContext('2d',{willReadFrequently:true})!;
  for(let i=0;i<9;i++){g.clearRect(0,0,48,48);g.drawImage(atlas,i%3*400,Math.floor(i/3)*400,400,400,0,0,48,48);const d=g.getImageData(0,0,48,48).data,l:Grain[]=[];
    for(let y=1;y<47;y++)for(let x=1;x<47;x++){const k=(y*48+x)*4;if(d[k+3]>160&&(x*7+y*13)%5===0)l.push({x:x/48-.5,y:y/48-.5,c:`rgb(${d[k]},${d[k+1]},${d[k+2]})`});}grains.push(l);}
}
export function prepare(px:number){
  px=Math.max(16,Math.round(px));if(px===size||!atlas)return;size=px;sprites.length=0;
  for(let i=0;i<9;i++){let src:CanvasImageSource=atlas,sx=i%3*400,sy=Math.floor(i/3)*400,w=400;
    while(w/2>px){const c=document.createElement('canvas');w=Math.round(w/2);c.width=c.height=w;const g=c.getContext('2d')!;g.imageSmoothingQuality='high';g.drawImage(src,sx,sy,w*2,w*2,0,0,w,w);src=c;sx=sy=0;}
    const c=document.createElement('canvas');c.width=c.height=px;const g=c.getContext('2d')!;g.imageSmoothingQuality='high';g.drawImage(src,sx,sy,w,w,0,0,px,px);sprites.push(c);}
}
export const sprite=(i:number)=>sprites[i];
const full=(g:G,i:number,S:number)=>g.drawImage(sprites[i],-S/2,-S/2,S,S);
const part=(g:G,i:number,S:number,u0:number,v0:number,u1:number,v1:number,dx=0,dy=0)=>{const P=size;g.drawImage(sprites[i],u0*P,v0*P,(u1-u0)*P,(v1-v0)*P,(u0-.5)*S+dx,(v0-.5)*S+dy,(u1-u0)*S+.6,(v1-v0)*S+.6);};
const halo=(g:G,S:number,x:number,y:number,r:number,c:string,a:number)=>{if(a<=0)return;const m=g.globalCompositeOperation;g.globalCompositeOperation='lighter';const gr=g.createRadialGradient(x*S,y*S,0,x*S,y*S,r*S);gr.addColorStop(0,`rgba(${c},${a})`);gr.addColorStop(1,`rgba(${c},0)`);g.fillStyle=gr;g.fillRect((x-r)*S,(y-r)*S,r*2*S,r*2*S);g.globalCompositeOperation=m;};
const strips=(g:G,i:number,S:number,n:number,dy:(m:number)=>number)=>{for(let k=0;k<n;k++){const a=k/n,b=(k+1)/n;part(g,i,S,a,0,b,1,0,dy((a+b)/2)*S);}};
const rows=(g:G,i:number,S:number,n:number,dx:(m:number)=>number)=>{for(let k=0;k<n;k++){const a=k/n,b=(k+1)/n;part(g,i,S,0,a,1,b,dx((a+b)/2)*S,0);}};
export type Spawn=(kind:'spark'|'ring'|'feather'|'bubble'|'dust'|'ray'|'drop',x:number,y:number,size:number,color?:string)=>void;
export function plain(g:G,i:number,S:number,t:number,seed:number,calm:number){
  // quiet life: the compass never quite rests, the relic breathes, the fish hovers
  const s=t+seed*1.7;
  if(i===WILD&&calm){g.rotate(Math.sin(s*1.1)*.05);}
  if(i===RELIC&&calm){halo(g,S,0,-.02,.5,GLOW[8],.14+.1*Math.sin(s*2.2));}
  if(i===FISH&&calm){g.translate(0,Math.sin(s*1.3)*S*.012);strips(g,i,S,16,m=>Math.sin(s*2.4-m*5)*.012*(1-m));return;}
  if(i===SERPENT&&calm){rows(g,i,S,18,m=>Math.sin(s*1.6+m*6)*.007);return;}
  full(g,i,S);
}
/** `u` from 0 to 1, `last` is the previous value so accents fire once. Coordinates are cell centred. */
export function landing(g:G,i:number,S:number,u:number,last:number,spawn:Spawn){
  const hit=(m:number)=>last<m&&u>=m,b=Math.sin(Math.min(1,u*2.4)*Math.PI)*(1-u);
  switch(i){
    case IDOL:g.translate(0,b*S*.05);g.scale(1+b*.12,1-b*.16);if(hit(.02)){spawn('dust',-.3,.42,1);spawn('dust',.3,.42,1);}full(g,i,S);break;
    case SUN:g.rotate((1-u)**2*-.9);full(g,i,S);halo(g,S,0,0,.55,GLOW[1],(1-u)*.35);break;
    case JAGUAR:g.translate(-Math.sin(u*Math.PI)*S*.05*(1-u),0);g.rotate(Math.sin(u*9)*.07*(1-u));g.scale(1+b*.07,1-b*.07);full(g,i,S);break;
    case FALCON:strips(g,i,S,18,m=>-Math.sin(u*Math.PI*3)*.09*(1-u)*Math.max(0,.55-m)*2);if(hit(.15))spawn('feather',-.25,-.1,.8,GLOW[3]);break;
    case SERPENT:rows(g,i,S,22,m=>Math.sin(u*16+m*9)*.09*(1-u)**1.4);break;
    case MOON:g.rotate(Math.sin(u*8)*.16*(1-u));full(g,i,S);break;
    case FISH:g.rotate(Math.sin(u*14)*.1*(1-u));strips(g,i,S,18,m=>Math.sin(u*26-m*5)*.08*(1-u)*(1-m));if(hit(.1)){spawn('drop',-.35,.1,1);spawn('drop',-.35,.1,1);}if(hit(.35))spawn('bubble',.35,-.1,1);break;
    case WILD:{const a=(1-u)**2.4*9;g.rotate(a);full(g,i,S);halo(g,S,0,0,.5,GLOW[7],(1-u)*.3);break;}
    default:g.translate(0,-Math.sin(u*Math.PI)*S*.05);g.scale(1+b*.04,1+b*.04);full(g,i,S);halo(g,S,0,-.02,.62,GLOW[8],.2+.5*Math.sin(u*Math.PI));if(hit(.2)){spawn('ray',0,-.1,1,GLOW[8]);spawn('ring',0,0,.9,GLOW[8]);}
  }
}
export function winning(g:G,i:number,S:number,u:number,last:number,spawn:Spawn){
  const hit=(m:number)=>last<m&&u>=m,e=Math.sin(u*Math.PI),pop=Math.sin(Math.min(1,u*2.2)*Math.PI);
  g.scale(1+.07*pop,1+.07*pop);
  switch(i){
    case IDOL:{full(g,i,S);const k=e*(.75+.25*Math.sin(u*30));for(const x of[-.115,.095]){halo(g,S,x,-.07,.11,'90,255,215',k*.6);halo(g,S,x,-.07,.035,'235,255,245',k*.8);}if(hit(.25)||hit(.55))spawn('ring',0,0,1,GLOW[0]);break;}
    case SUN:{g.save();g.rotate(u*u*(3-2*u)*Math.PI*.334);full(g,i,S);g.restore();g.save();g.beginPath();g.arc(0,0,S*.27,0,7);g.clip();full(g,i,S);g.restore();halo(g,S,0,0,.75,GLOW[1],e*.75);if(hit(.2)||hit(.45)||hit(.7))for(let k=0;k<4;k++)spawn('spark',Math.cos(k*1.6+u*9)*.36,Math.sin(k*1.6+u*9)*.36,1,GLOW[1]);break;}
    case JAGUAR:{const r=Math.sin(clamp(u*1.6)*Math.PI),sh=Math.sin(u*70)*.012*r;g.translate(sh*S,0);g.rotate(-.07*r);part(g,i,S,0,0,1,.56);g.save();g.translate(S*.06,S*.04);g.rotate(.10*r);g.translate(-S*.06,-S*.04+S*.02*r);part(g,i,S,0,.555,1,1);g.restore();halo(g,S,.24,-.16,.1,'255,220,60',e);if(hit(.18)||hit(.32)||hit(.46))spawn('ring',.2,.12,.8,GLOW[2]);break;}
    case FALCON:{const f=Math.sin(u*Math.PI*4)*(1-u*.4);g.translate(0,-Math.abs(f)*S*.05);strips(g,i,S,22,m=>-f*.16*Math.max(0,.58-m)*1.7);halo(g,S,.1,-.12,.14,'255,220,90',e*.8);if(hit(.15)||hit(.4)||hit(.65)){spawn('feather',-.3,-.05,1,GLOW[3]);spawn('feather',-.15,-.2,.8,GLOW[3]);}break;}
    case SERPENT:{rows(g,i,S,26,m=>Math.sin(u*19+m*8)*.055*e);halo(g,S,.14,-.31,.12,'255,60,50',e);const t=Math.max(0,Math.sin(u*22))*e;if(t>.02){g.strokeStyle='#e0474c';g.lineWidth=S*.014;g.beginPath();g.moveTo(S*.3,-S*.16);g.lineTo(S*(.3+.13*t),-S*.14);g.lineTo(S*(.3+.18*t),-S*.18);g.moveTo(S*(.3+.13*t),-S*.14);g.lineTo(S*(.3+.18*t),-S*.1);g.stroke();}break;}
    case MOON:{g.rotate(Math.sin(u*Math.PI*2)*.1);full(g,i,S);halo(g,S,-.05,0,.8,GLOW[5],e*.45);halo(g,S,.1,0,.3,'230,238,255',e*.22);if(hit(.2)||hit(.5))spawn('ring',0,0,1.15,GLOW[5]);break;}
    case FISH:{const j=Math.sin(u*Math.PI);g.translate(0,-j*S*.1);g.rotate(Math.sin(u*Math.PI*2)*-.16);strips(g,i,S,22,m=>Math.sin(u*30-m*5)*.075*e*(1-m*.8));halo(g,S,.27,-.1,.12,GLOW[6],e*.8);if(hit(.15)||hit(.4)||hit(.7)){spawn('bubble',.35,-.1,1);spawn('drop',-.38,.05,1);spawn('drop',-.3,.15,1);}break;}
    case WILD:{g.rotate((1-(1-u)**3)*Math.PI*2);full(g,i,S);halo(g,S,0,0,.7,GLOW[7],e*.7);if(hit(.15))spawn('ray',0,0,1,GLOW[7]);if(hit(.3)||hit(.6))for(let k=0;k<4;k++)spawn('spark',Math.cos(k*1.57)*.4,Math.sin(k*1.57)*.4,1,GLOW[7]);break;}
    default:g.translate(0,-e*S*.06);full(g,i,S);halo(g,S,0,-.02,.85,GLOW[8],e*.85);if(hit(.1)||hit(.4)||hit(.7))spawn('ray',0,-.1,1,GLOW[8]);
  }
}
