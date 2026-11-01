import type Phaser from 'phaser';
import { STREET } from '../shared/street';
import { STREET_CARS } from './StreetLife';
import { STREET_SERVICE_PROPS } from './streetDetails';
import { t } from '../i18n';

type Paint = CanvasRenderingContext2D;
const ink = '#29232a', wall = '#681a32', cream = '#f3dcb1', gold = '#f6cf58', snow = '#f8fbff';
export const STREET_ART = { paving:'street-v2-paving', floor:'street-v2-floor', front:'street-v4-front', pine:'street-v2-pine', lamp:'street-v2-lamp', bench:'street-v2-bench', map:'street-v4-map', sign:'street-sign', sheen:'street-sign-sheen',carpet:'street-carpet',rear:'street-service-wall',taxiSign:'street-taxi-sign' } as const;
export const STREET_SIGN={center:(442+772)/2,width:300,height:216,baseline:156,baselineOffset:-113} as const;

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
  const metrics=c.measureText('ROYAL'),anchor=x+(metrics.actualBoundingBoxLeft-metrics.actualBoundingBoxRight)/2;
  c.strokeStyle='#50222c';c.lineWidth=2;c.strokeText('ROYAL',anchor,y);c.fillStyle=gold;c.fillText('ROYAL',anchor,y);
  line(c,x-size*1.75,y+11,x+size*1.75,y+11,gold,3);
  line(c,x-size*1.65,y+18,x+size*1.65,y+18,gold,1.5);
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
  line(c,44,3,47,12,'#adb3bd',.7);line(c,47,12,42,17,'#adb3bd',.7);
  line(c,149,119,162,116,'#b0b6c0',.7);line(c,80,62,91,61,'#d1d5db',1);
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
  planter(c,STREET_SIGN.center,base-36,218);
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
  // Wall-mounted signs sit within the existing solid facade.
  for(const x of [57,362]){
    box(c,x-25,base-152,50,89,'#b78b4d',ink,2,2);box(c,x-21,base-148,42,81,'#302535',ink,1);
    c.font='bold 8px Georgia';c.textAlign='center';c.fillStyle=gold;c.fillText('ROYAL',x,base-135);
    shape(c,[[x,base-122],[x+9,base-108],[x,base-94],[x-9,base-108]],'#d7bd77','#f4dfa8',1);
    for(const y of [base-83,base-77])line(c,x-13,y,x+13,y,'#bd9e63',1);
  }
  box(c,door+84,base-179,35,24,'#bb9458',ink,1.5,3);
  c.font='bold 13px Georgia';c.fillStyle='#3c2931';c.textAlign='center';c.fillText('01',door+101.5,base-162);
  box(c,door-52,base-171,104,20,'#d4b279',ink,1.2,2);
  c.font='bold 9px Arial';c.fillStyle='#4c3037';c.fillText(t('ДОБРО ПОЖАЛОВАТЬ'),door,base-157);
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
  for(const {x,y} of STREET.trees.filter(p=>!(p.x===2580&&p.y===1100))){
    for(const [dx,dy,r] of [[0,0,40],[-24,-9,26],[21,-17,26],[0,-31,25]])oval(c,x+dx,y+dy,r,r,'#285d48');
    oval(c,x-10,y-28,25,12,snow);
  }
  for(const p of STREET.lamps)box(c,p.x-12,p.y-10,24,20,'#ffe17d',ink,4,2);
  for(const p of STREET.benches.filter(p=>p.y>500))bench(c,p.x,p.y);
  paintParking(c);
  for(const prop of STREET_SERVICE_PROPS){c.save();c.translate(prop.x-prop.width/2,prop.y-prop.height);paintServiceProp(c,prop.id,true);c.restore();}
  c.save();c.setLineDash([20,18]);c.strokeStyle='#5faaa4';c.lineWidth=4;c.beginPath();
  STREET.loop.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.stroke();c.restore();
  box(c,b.x,b.y,b.w,b.h,wall,ink,7,2);box(c,b.x+14,b.y+14,b.w-28,b.h-28,wall,cream,5);
  box(c,b.x+640,b.y-3,120,16,'#6b7c7c',cream,2);
  royal(c,b.x+b.w/2,b.y+b.h/2+53,73);
  const front=b.y+b.h;box(c,STREET.entrance.x-45,front-5,90,13,gold,ink,1);
  shape(c,[[STREET.entrance.x-48,front+8],[STREET.entrance.x+48,front+8],[STREET.entrance.x+60,front+43],[STREET.entrance.x-60,front+43]],'#ac3549',ink,1);
  for(const side of [-1,1])oval(c,STREET.entrance.x+side*126,front,22,22,'#2d6b50');
}

function carpet(c:Paint){
  box(c,43,0,154,92,'#882c43',ink,1,2);box(c,49,0,142,87,'#a63e50','#d9b465',1);
  for(const x of [30,210]){
    line(c,x,5,x,77,'#c99b4e',3);
    for(const y of [30,66,102]){oval(c,x,y,10,3,'#8f733f');box(c,x-2,y-24,4,24,'#d4ac55',ink,1);oval(c,x,y-25,5,5,gold);}
  }
  paintStreetCrown(c,120,29,30,18);
  for(const y of [88,92])line(c,42,y,198,y,'#d1a467',1);
}
function paintParking(c:Paint){
  box(c,2498,988,169,198,'#acb5bf',ink,0);
  for(const x of [2503,2662])line(c,x,997,x,1182,'#e9cf78',3);
  line(c,2503,1182,2662,1182,'#e9cf78',3);
  c.font='bold 26px Arial';c.textAlign='center';c.fillStyle='#e8d18a';c.fillText('P',2582,1167);
}
function paintServiceProp(c:Paint,id:typeof STREET_SERVICE_PROPS[number]['id'],plan=false){
  if(id==='parked-taxi'){paintCar(c,'#d8ad4f',true,plan);return;}
  if(id==='delivery-cart'){
    for(const x of [25,119]){oval(c,x,96,7,7,'#30373b');oval(c,x,96,3,3,'#adb8bc');}
    box(c,12,79,121,12,'#6d7b7c',ink,2,2);line(c,127,82,127,22,'#37454a',5);line(c,127,22,114,22,'#37454a',5);
    for(const [x,y,w,h] of [[17,43,51,35],[72,38,48,40],[39,10,48,32]]){
      box(c,x,y,w,h,'#bc9263',ink,1.6,1);box(c,x+w*.43,y,w*.14,h,'#dec49b',ink,0);
      box(c,x+5,y+h-13,15,8,'#ebe0c8',ink,0);line(c,x+8,y+h-9,x+16,y+h-9,'#89775d',1);
    }
    oval(c,54,9,24,4,snow);
  }else{
    for(const [x,color] of [[9,'#526f66'],[77,'#59657b']] as const){
      box(c,x+4,25,55,63,color,ink,2,4);box(c,x,20,63,13,'#39484b',ink,2,3);
      for(const dx of [16,30,44])line(c,x+dx,39,x+dx,77,'#303f43',1);
      box(c,x+18,42,25,19,'#ddd6bc',ink,1,2);c.font='bold 13px Arial';c.fillStyle='#425b53';c.textAlign='center';c.fillText('↻',x+31,57);
      for(const dx of [13,47])oval(c,x+dx,91,5,6,'#30343a');
      oval(c,x+20,19,20,5,snow);oval(c,x+43,19,15,4,snow);
    }
  }
}
function paintServiceWall(c:Paint){
  const w=STREET.building.w;box(c,0,0,w,150,'#5d3640',ink,2);
  box(c,0,0,w,13,'#b9afa2',ink,1);line(c,3,3,w-3,3,snow,3);
  for(let x=20;x<w;x+=160)line(c,x,17,x,149,'#4b3037',1);
  box(c,640,18,122,126,'#39484c',ink,3,2);box(c,647,24,108,114,'#768384','#293b40',2);
  for(const x of [656,710]){box(c,x,32,37,55,'#657373',ink,1);for(let y=40;y<80;y+=7)line(c,x+4,y,x+32,y,'#3e5256',2);}
  line(c,700,26,700,138,'#3c4c4f',3);box(c,718,99,21,5,'#c1b994',ink,1);
  box(c,615,15,171,19,'#d9c79f',ink,1);
  c.font='bold 10px Arial';c.textAlign='center';c.fillStyle='#3e3939';c.fillText(t('СЛУЖЕБНЫЙ ВХОД'),700,28);
  for(const x of [80,1120]){
    box(c,x,47,138,65,'#8d9794',ink,2,3);for(let y=55;y<107;y+=8)line(c,x+9,y,x+129,y,'#44595c',3);
    line(c,x+145,15,x+145,130,'#283d42',8);line(c,x+145,15,x+145,130,'#8a9795',4);
  }
  box(c,353,68,94,63,'#848e85',ink,2,3);line(c,400,69,400,130,ink,1);
  shape(c,[[380,82],[389,99],[371,99]],'#e4c96c',ink,1);
  c.font='bold 8px Arial';c.fillStyle='#39413c';c.fillText('!',380,96);
  for(const x of [500,875,1370]){box(c,x,30,35,22,'#f2d98e',ink,2,2);line(c,x+3,56,x+32,56,'#dbc28b',3);}
}
function paintTaxiSign(c:Paint){
  box(c,39,36,6,108,'#566169',ink,2);box(c,12,5,60,55,'#315363',ink,2,4);box(c,17,10,50,45,'#eed57e',ink,1,2);
  c.font='bold 13px Arial';c.textAlign='center';c.fillStyle='#34323a';c.fillText(t('ТАКСИ'),42,29);
  c.font='bold 16px Arial';c.fillText('P',42,48);box(c,28,139,28,6,'#49565d',ink,1);
  oval(c,36,4,23,4,snow);
}

function paintCar(c:Paint,color:string,taxi:boolean,plan:boolean){
  if(plan){
    for(const x of [49,124])for(const y of [15,62])box(c,x,y,18,6,'#29282d',ink,1,2);
    box(c,20,18,148,46,color,ink,2,13);
    box(c,56,23,69,36,'#a7c9d0',ink,1.5,5);box(c,72,23,36,36,color,ink,1,3);
    box(c,157,25,5,8,'#ffe6a1',ink,0);box(c,157,48,5,8,'#ffe6a1',ink,0);
    if(taxi)box(c,85,33,13,16,'#ffe6a1',ink,1,2);
    return;
  }
  c.save();c.globalAlpha=.12;oval(c,91,74,78,6,ink);c.restore();
  for(const x of [52,132]){oval(c,x,67,12,12,'#29282d');oval(c,x,67,6,6,'#a5a8ac');oval(c,x,67,2,2,'#e2d7bc');}
  shape(c,[[23,60],[27,44],[47,39],[63,18],[112,18],[135,39],[158,46],[162,63],[145,66],[141,56],[123,56],[119,66],[66,66],[62,56],[43,56],[38,66],[25,65]],color,ink,2);
  shape(c,[[66,23],[108,23],[124,39],[54,39]],'#a8cbd4',ink,1.5);
  line(c,89,23,89,40,ink,2);line(c,94,44,94,62,ink,1);line(c,30,52,153,52,'#e8e1c6',1);
  box(c,98,45,8,2,'#d3d3c6',ink,0);box(c,155,46,6,8,'#ffe3a1',ink,1);box(c,24,47,4,7,'#c66865',ink,0);
  box(c,151,61,13,3,'#c7c3b3',ink,0);box(c,20,61,12,3,'#c7c3b3',ink,0);
  if(taxi){box(c,78,11,21,7,'#ffe4a0',ink,1,2);for(let n=0;n<6;n++)box(c,68+n*6,46,4,3,n%2?ink:'#e9dfc6',ink,0);}
  c.save();c.globalAlpha=.12;shape(c,[[161,47],[188,39],[188,66],[161,54]],'#ffe8ac',ink,0);c.restore();
}

export function createStreetArt(scene:Phaser.Scene){
  const make=(key:string,w:number,h:number,density:number,paint:(c:Paint)=>void)=>{
    if(scene.textures.exists(key))return;
    const texture=scene.textures.createCanvas(key,Math.ceil(w*density),Math.ceil(h*density))!;
    const c=texture.context;c.scale(density,density);c.lineCap='round';c.lineJoin='round';paint(c);texture.refresh();
  };
  make(STREET_ART.paving,200,160,2,paving);make(STREET_ART.floor,246,250,2,paintUpperFloor);
  make(STREET_ART.front,STREET.building.w,350,2,paintFront);
  make(STREET_ART.carpet,240,120,2,carpet);
  make(STREET_ART.rear,STREET.building.w,150,2,paintServiceWall);
  make(STREET_ART.taxiSign,84,148,2,paintTaxiSign);
  for(const prop of STREET_SERVICE_PROPS)make('street-detail-'+prop.id,prop.width,prop.height,2,c=>paintServiceProp(c,prop.id));
  make(STREET_ART.sign,STREET_SIGN.width,STREET_SIGN.height,2,c=>royal(c,STREET_SIGN.width/2,STREET_SIGN.baseline,44));
  make(STREET_ART.sheen,STREET_SIGN.width,STREET_SIGN.height,2,c=>{
    c.drawImage(scene.textures.get(STREET_ART.sign).getSourceImage() as HTMLCanvasElement,0,0,STREET_SIGN.width,STREET_SIGN.height);
    c.globalCompositeOperation='source-in';c.fillStyle='#fff2c7';c.fillRect(0,0,STREET_SIGN.width,STREET_SIGN.height);c.globalCompositeOperation='source-over';
  });
  make(STREET_ART.pine,128,184,2,c=>pine(c,64,164,1.17));
  make(STREET_ART.lamp,66,160,2,c=>lantern(c,33,151));
  make(STREET_ART.bench,144,84,2,c=>bench(c,72,70));
  make(STREET_ART.map,STREET.width,STREET.height,.75,paintStreetMap);
  for(const car of STREET_CARS){
    make('street-car-'+car.id,190,84,2,c=>paintCar(c,car.color,car.id==='street-gold-car',false));
    make('street-car-plan-'+car.id,190,84,2,c=>paintCar(c,car.color,car.id==='street-gold-car',true));
  }
  return scene.textures.get(STREET_ART.map).getSourceImage() as HTMLCanvasElement;
}
