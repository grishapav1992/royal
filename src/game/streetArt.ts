import type Phaser from 'phaser';
import { STREET } from '../shared/street';

type Paint = CanvasRenderingContext2D;
const ink = '#29232a', wall = '#681a32', cream = '#f3dcb1', gold = '#f6cf58', snow = '#f8fbff';
export const STREET_ART = { paving:'street-v2-paving', floor:'street-v2-floor', front:'street-v2-front', pine:'street-v2-pine', lamp:'street-v2-lamp', bench:'street-v2-bench', map:'street-v2-map' } as const;

function box(c:Paint,x:number,y:number,w:number,h:number,fill:string,stroke=ink,width=1.5,radius=0){
  c.beginPath();c.roundRect(x,y,w,h,radius);c.fillStyle=fill;c.fill();
  if(width){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
}
function line(c:Paint,x:number,y:number,x2:number,y2:number,color=ink,width=1.5){
  c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();
}
function oval(c:Paint,x:number,y:number,rx:number,ry:number,fill:string){
  c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();
}
function shape(c:Paint,points:number[][],fill:string,stroke=ink,width=1.5){
  c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();
  if(width){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
}

/** One crown drawing serves the facade and its flat map. */
export function paintStreetCrown(c:Paint,x:number,y:number,w:number,h:number){
  c.save();c.translate(x,y);c.scale(w/100,h/60);
  shape(c,[[-49,8],[-28,25],[-24,0],[-12,21],[0,-10],[12,21],[24,0],[28,25],[49,8],[35,53],[-35,53]],gold,'#6b4528',1.2);
  for(const [px,py] of [[-49,8],[-24,0],[0,-10],[24,0],[49,8]])oval(c,px,py,3.5,3.5,'#ffe98e');
  box(c,-35,46,70,8,gold,'#6b4528',1,2);
  for(const [px,py,size] of [[0,29,6],[-22,32,3],[22,32,3]])shape(c,[[px,py-size],[px+size*.6,py],[px,py+size],[px-size*.6,py]],'#b73b42','#835231',.6);
  c.restore();
}
function royal(c:Paint,x:number,y:number,size:number){
  paintStreetCrown(c,x,y-size*2.45,size*3.25,size*1.55);
  c.font=`bold ${size}px Georgia, serif`;c.textAlign='center';c.textBaseline='alphabetic';
  c.strokeStyle='#50222c';c.lineWidth=2;c.strokeText('ROYAL',x,y);c.fillStyle=gold;c.fillText('ROYAL',x,y);
  c.beginPath();c.moveTo(x-size*1.75,y+10);c.quadraticCurveTo(x,y-2,x+size*1.75,y+10);c.strokeStyle=gold;c.lineWidth=4;c.stroke();
  c.beginPath();c.moveTo(x-size*1.65,y+17);c.quadraticCurveTo(x,y+5,x+size*1.65,y+17);c.lineWidth=1.8;c.stroke();
}
function pilaster(c:Paint,x:number,top:number,height:number,width=34){
  box(c,x-width/2,top,width,height,cream,'#594533',1.3);
  box(c,x-width/2+4,top+16,4,height-32,'#ffeac2',ink,0);
  box(c,x-width/2,top,width,14,'#ffebc6','#72573a',1);
  box(c,x-width/2-5,top+14,width+10,8,'#e6c99b','#72573a',1);
  box(c,x-width/2-5,top+height-24,width+10,24,'#e7c899','#72573a',1);
  for(let y=top+height-90;y>top+35;y-=100)line(c,x-width/2+1,y,x+width/2-1,y,'#c8a979',.8);
  if(height>220)shape(c,[[x,top+47],[x+6,top+58],[x,top+69],[x-6,top+58]],gold,'#8c6532',1);
}
function window(c:Paint,x:number,y:number,w:number,h:number){
  box(c,x-3,y-3,w+6,h+6,'#b99b64',ink,2);box(c,x,y,w,h,'#ffdf79',ink,3);
  c.fillStyle='#ffe89a';c.fillRect(x+5,y+5,w/2-8,h/2-8);
  c.fillStyle='#f8d16b';c.fillRect(x+w/2+3,y+h/2+3,w/2-8,h/2-8);
  line(c,x+w/2,y+1,x+w/2,y+h-1,ink,3.5);line(c,x+1,y+h/2,x+w-1,y+h/2,ink,3.5);
  box(c,x-5,y+h+2,w+10,7,cream,'#66513b',1);
}
function canopy(c:Paint,x:number,base:number,w:number,h:number){
  c.beginPath();c.moveTo(x-w/2,base);c.bezierCurveTo(x-w/2,base-h*1.25,x+w/2,base-h*1.25,x+w/2,base);c.closePath();
  c.fillStyle='#711b36';c.fill();c.strokeStyle=ink;c.lineWidth=4;c.stroke();
  c.beginPath();c.moveTo(x-w/2+1,base-2);c.bezierCurveTo(x-w/2+2,base-h*1.2,x+w/2-2,base-h*1.2,x+w/2-1,base-2);
  c.strokeStyle=cream;c.lineWidth=2;c.stroke();box(c,x-w/2,base-2,w,9,'#b58b42',ink,1);
  for(let n=0;n<7;n++)oval(c,x-w*.42+n*w*.14,base+2,2,1.8,'#ffeab0');
}
function planter(c:Paint,x:number,y:number,w:number){
  box(c,x-w/2,y,w,26,'#293d3b',ink,2,2);box(c,x-w/2+5,y+4,w-10,3,'#587265',ink,0);
  for(let n=0;n<Math.ceil(w/17);n++){
    const px=x-w/2+9+n*17;oval(c,px,y-3,14,10,n%2?'#28604a':'#234f40');oval(c,px-2,y-9-n%3,10+n%3,5+n%2,snow);
  }
}
function pine(c:Paint,x:number,y:number,size:number){
  c.save();c.translate(x,y);c.scale(size,size);box(c,-6,-25,12,25,'#6e4938',ink,1);
  const tiers=[{y:0,w:47,h:67},{y:-38,w:38,h:59},{y:-72,w:28,h:56}];
  for(const [index,p] of tiers.entries()){
    c.beginPath();c.moveTo(0,p.y-p.h);c.lineTo(-p.w*.53,p.y-p.h*.45);c.lineTo(-p.w*.43,p.y-p.h*.45);
    c.lineTo(-p.w,p.y-4);c.quadraticCurveTo(-p.w*.7,p.y+5,-p.w*.48,p.y+1);
    c.quadraticCurveTo(0,p.y+8,p.w*.48,p.y+1);c.quadraticCurveTo(p.w*.7,p.y+5,p.w,p.y-4);
    c.lineTo(p.w*.43,p.y-p.h*.45);c.lineTo(p.w*.53,p.y-p.h*.45);c.closePath();
    c.fillStyle=['#1d5142','#245e49','#2d6b50'][index];c.fill();c.strokeStyle='#203f36';c.lineWidth=1.2;c.stroke();
    const sy=p.y-p.h*.53;c.beginPath();c.moveTo(-p.w*.43,sy);c.lineTo(0,p.y-p.h+1);c.lineTo(p.w*.43,sy);
    c.bezierCurveTo(p.w*.24,sy-7,p.w*.18,sy+9,0,sy+1);c.bezierCurveTo(-p.w*.16,sy-9,-p.w*.25,sy+6,-p.w*.43,sy);c.fillStyle=snow;c.fill();
  }
  c.restore();
}
function potPine(c:Paint,x:number,y:number){
  pine(c,x,y-21,.78);shape(c,[[x-27,y-24],[x+27,y-24],[x+21,y+4],[x-21,y+4]],'#a96f43',ink,1.7);
  box(c,x-29,y-26,58,7,'#c28b55',ink,1.5,2);line(c,x-19,y+1,x+19,y+1,'#dca567',1.2);
}
function lantern(c:Paint,x:number,y:number,size=1){
  c.save();c.translate(x,y);c.scale(size,size);
  box(c,-11,-7,22,7,'#302d32',ink,1,2);box(c,-5,-91,10,85,'#35353c',ink,1);box(c,-7,-13,14,6,'#4c4846',ink,1);
  shape(c,[[-17,-124],[17,-124],[14,-93],[-14,-93]],'#292a2f',ink,1.4);
  shape(c,[[-12,-120],[12,-120],[9,-98],[-9,-98]],'#ffe17d','#caa653',1);line(c,0,-120,0,-98,'#8b7148',1.4);
  shape(c,[[-20,-124],[0,-137],[20,-124]],'#353239',ink,1.3);oval(c,0,-139,3,4,'#39363c');
  c.fillStyle=snow;c.beginPath();c.moveTo(-15,-126);c.quadraticCurveTo(0,-141,15,-126);c.closePath();c.fill();c.restore();
}
function wallLantern(c:Paint,x:number,y:number){
  box(c,x-3,y+12,6,27,'#393039',ink,1);
  shape(c,[[x-15,y-25],[x+15,y-25],[x+12,y+14],[x-12,y+14]],'#353036',ink,1.4);
  shape(c,[[x-10,y-20],[x+10,y-20],[x+8,y+9],[x-8,y+9]],'#ffe485','#d0aa50',1);
  line(c,x,y-20,x,y+9,'#a48145',1);
  shape(c,[[x-19,y-25],[x,y-37],[x+19,y-25]],'#3c323a',ink,1.4);
  oval(c,x,y-39,2.5,3.5,'#3c323a');
}
function bench(c:Paint,x:number,y:number){
  for(const side of [-1,1]){
    box(c,x+side*44-3,y-20,6,27,'#33363a',ink,1);
    c.beginPath();c.moveTo(x+side*54,y-42);c.quadraticCurveTo(x+side*71,y-29,x+side*54,y-16);c.strokeStyle=ink;c.lineWidth=5;c.stroke();
  }
  for(let n=0;n<3;n++)box(c,x-55,y-55+n*11,110,9,n%2?'#a96b3e':'#965a33',ink,1.4,1);
  box(c,x-60,y-19,120,11,'#b57a47',ink,1.5,2);
  for(const side of [-1,1])for(let n=0;n<3;n++)oval(c,x+side*48,y-51+n*11,1.5,1.5,'#e3b76a');
  c.beginPath();c.moveTo(x-51,y-56);c.quadraticCurveTo(x-30,y-65,x-13,y-57);c.quadraticCurveTo(x+4,y-63,x+23,y-56);c.lineTo(x-51,y-56);c.fillStyle=snow;c.fill();
}
function paving(c:Paint){
  const colors=['#b9bec8','#c0c4cc','#bcc1ca','#c4c8d0'];
  for(let row=0;row<2;row++)for(let col=-1;col<3;col++){
    const x=col*100+(row?50:0);box(c,x,row*80,100,80,colors[(col+row+4)%4],'#969daa',1);line(c,x+1,row*80+1,x+99,row*80+1,'#d0d4db',.8);
  }
}
function paintUpperFloor(c:Paint){
  box(c,0,0,246,250,wall,ink,0);window(c,85,48,78,130);pilaster(c,16,0,236,28);
  box(c,0,235,246,15,cream,'#665039',1);line(c,0,238,246,238,'#fff0ce',2);
}
function paintFront(c:Paint){
  const w=STREET.building.w,base=320,door=STREET.entrance.x-STREET.building.x;
  box(c,0,0,w,base,wall,ink,2);
  for(const x of [20,442,772,1114,w-20])pilaster(c,x,0,base,38);
  box(c,0,0,w,15,cream,'#665039',1.5);line(c,0,3,w,3,'#ffefcc',3);box(c,0,base-14,w,14,cream,'#665039',1);
  for(const x of [930,1280]){window(c,x-85,base-179,170,133);canopy(c,x,base-184,210,55);planter(c,x,base-36,220);}
  royal(c,540,base-113,44);planter(c,540,base-36,218);
  box(c,door-79,base-197,158,197,'#392b28',ink,2.5);box(c,door-73,base-191,146,191,'#a47140','#79542f',1.5);
  for(const side of [-1,1]){
    const x=side<0?door-68:door+3;box(c,x,base-186,65,182,'#775036','#432e26',1.5);
    box(c,x+7,base-178,51,93,'#82593a','#493328',1.4);box(c,x+7,base-76,51,65,'#6e472e','#493328',1.4);
    line(c,x+9,base-175,x+56,base-175,'#b38753',1);
  }
  line(c,door,base-190,door,base,ink,3);
  for(const side of [-1,1])box(c,door+side*11-2,base-109,4,36,gold,'#9e7938',1,1);
  canopy(c,door,base-194,212,77);paintStreetCrown(c,door,base-246,41,28);
  for(const side of [-1,1]){
    const x=door+side*126;potPine(c,x,base+8);wallLantern(c,x,base-145);
  }
  shape(c,[[door-71,base+1],[door+71,base+1],[door+80,base+26],[door-80,base+26]],'#ac3549','#7c2b40',1);
  line(c,door-70,base+22,door+70,base+22,'#c95c64',1.5);
}

/** The overview and minimap share this cached, perpendicular plan. */
export function paintStreetMap(c:Paint){
  const b=STREET.building;box(c,0,0,STREET.width,STREET.height,'#e6edf2',ink,0);box(c,320,240,2180,960,'#bfc4cd','#a5adb8',2);
  for(let y=240;y<1200;y+=80)line(c,320,y,2500,y,'#b1b8c2',1.8);
  for(let x=320;x<=2500;x+=100)line(c,x,240,x,1200,'#b1b8c2',1.8);
  box(c,0,1210,STREET.width,170,'#303d50',ink,0);box(c,0,1198,STREET.width,12,snow,ink,0);
  for(let x=25;x<STREET.width;x+=140)box(c,x,1295,68,6,gold,ink,0);
  for(const {x,y} of STREET.trees){
    for(const [dx,dy,r] of [[0,0,40],[-24,-9,26],[21,-17,26],[0,-31,25]])oval(c,x+dx,y+dy,r,r,'#285d48');
    oval(c,x-10,y-28,25,12,snow);
  }
  for(const p of STREET.lamps)box(c,p.x-12,p.y-10,24,20,'#ffe17d',ink,4,2);
  for(const p of STREET.benches)bench(c,p.x,p.y);
  c.save();c.setLineDash([20,18]);c.strokeStyle='#5faaa4';c.lineWidth=4;c.beginPath();
  STREET.loop.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.stroke();c.restore();
  box(c,b.x,b.y,b.w,b.h,wall,ink,7,2);box(c,b.x+14,b.y+14,b.w-28,b.h-28,wall,cream,5);
  royal(c,b.x+b.w/2,b.y+b.h/2+53,73);
  const front=b.y+b.h;box(c,STREET.entrance.x-45,front-5,90,13,gold,ink,1);
  shape(c,[[STREET.entrance.x-48,front+8],[STREET.entrance.x+48,front+8],[STREET.entrance.x+60,front+43],[STREET.entrance.x-60,front+43]],'#ac3549',ink,1);
  for(const side of [-1,1])oval(c,STREET.entrance.x+side*126,front,22,22,'#2d6b50');
}

export function createStreetArt(scene:Phaser.Scene){
  const make=(key:string,w:number,h:number,density:number,paint:(c:Paint)=>void)=>{
    if(scene.textures.exists(key))return;
    const texture=scene.textures.createCanvas(key,Math.ceil(w*density),Math.ceil(h*density))!;
    const c=texture.context;c.scale(density,density);c.lineCap='round';c.lineJoin='round';paint(c);texture.refresh();
  };
  make(STREET_ART.paving,200,160,2,paving);make(STREET_ART.floor,246,250,2,paintUpperFloor);
  make(STREET_ART.front,STREET.building.w,350,2,paintFront);
  make(STREET_ART.pine,128,184,2,c=>pine(c,64,164,1.17));
  make(STREET_ART.lamp,66,160,2,c=>lantern(c,33,151));
  make(STREET_ART.bench,144,84,2,c=>bench(c,72,70));
  make(STREET_ART.map,STREET.width,STREET.height,.75,paintStreetMap);
  return scene.textures.get(STREET_ART.map).getSourceImage() as HTMLCanvasElement;
}
