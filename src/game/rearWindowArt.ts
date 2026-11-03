import type Phaser from 'phaser';
import { REAR_WINDOW } from './rearWindowLife';

type Paint=CanvasRenderingContext2D;
const ink='#382e32',cream='#f3dcb1',gold='#d4ae64';
function box(c:Paint,x:number,y:number,w:number,h:number,color:string,stroke=ink,line=1.5){c.fillStyle=color;c.fillRect(x,y,w,h);if(line){c.strokeStyle=stroke;c.lineWidth=line;c.strokeRect(x,y,w,h);}}
function line(c:Paint,x:number,y:number,x2:number,y2:number,color:string,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function oval(c:Paint,x:number,y:number,rx:number,ry:number,color:string){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();}
function room(c:Paint,kind:number){
  const {w,h}=REAR_WINDOW.glass;
  box(c,0,0,w,h,'#ddb982',ink,0);box(c,0,90,w,h-90,'#713947',ink,0);
  line(c,0,12,w,12,'#f5d998',5);line(c,0,88,w,88,gold,3);
  for(let x=10;x<w;x+=27){c.beginPath();c.moveTo(x,29);c.lineTo(x+4,36);c.lineTo(x,43);c.lineTo(x-4,36);c.closePath();c.fillStyle='#bd915f';c.fill();}
  box(c,0,h-24,w,24,'#8e4b51',ink,0);line(c,0,h-22,w,h-22,'#d4aa6b',2);
  if(kind===0){
    for(const x of [10,106]){
      box(c,x,67,39,74,'#413d48');box(c,x+3,70,33,9,gold);box(c,x+5,82,29,35,'#3a6063');
      box(c,x+8,89,23,18,'#e3c98a',ink,1);
      for(let n=0;n<3;n++){box(c,x+9+n*7,91,5,13,'#f5e8bc',ink,.6);oval(c,x+11+n*7,97,1.7,2.5,n%2?'#a7454d':'#4d7d73');}
      box(c,x+3,121,33,8,'#ae8756');oval(c,x+28,125,2,2,'#f5dc8f');box(c,x+5,133,29,7,'#272e3a');
    }
  }else if(kind===1){
    box(c,9,104,105,31,'#542c3c');box(c,14,99,95,28,'#a75d62');
    for(const x of [16,62])box(c,x,122,45,12,'#b36a6e');
    for(const x of [18,100])box(c,x,137,5,10,'#44343b');
    line(c,133,53,133,139,'#70533d',4);box(c,122,134,22,5,'#715340');
    c.beginPath();c.moveTo(123,45);c.lineTo(143,45);c.lineTo(151,66);c.lineTo(115,66);c.closePath();c.fillStyle='#f5d78f';c.fill();c.strokeStyle=ink;c.stroke();
  }else{
    box(c,28,30,100,56,gold);box(c,33,35,90,46,'#678485');
    line(c,43,75,76,42,'#b5c6b4',2);line(c,85,75,112,48,'#9cb7ad',2);
    box(c,0,117,w,30,'#916449');box(c,0,111,w,8,'#dfba78');
    for(const x of [15,40,105,131]){box(c,x,94,7,16,x%2?'#4c7b65':'#a4644e');box(c,x+2,88,3,7,'#c8b884',ink,.7);}
    for(const x of [30,111]){line(c,x,140,x,159,'#3c383d',4);box(c,x-10,135,20,7,'#563746');}
  }
  line(c,76,0,76,26,'#76573c',2);oval(c,76,30,12,7,'#ffe4a1');oval(c,76,28,5,4,'#fff1c3');
}
function frame(c:Paint){
  const {glass:g}=REAR_WINDOW;
  box(c,10,7,176,180,'#ad8a5a',ink,3);box(c,14,11,168,174,cream,'#73583e',2);
  c.clearRect(g.x,g.y,g.w,g.h);
  c.fillStyle='#f4d28b14';c.fillRect(g.x,g.y,g.w,g.h);
  for(const mirror of [false,true]){
    c.save();if(mirror){c.translate(196,0);c.scale(-1,1);}
    c.beginPath();c.moveTo(20,18);c.lineTo(57,18);c.quadraticCurveTo(51,49,27,65);c.lineTo(20,65);c.closePath();c.fillStyle='#884252';c.fill();c.strokeStyle='#5e303f';c.lineWidth=1.5;c.stroke();
    line(c,25,22,27,57,'#b56b70',2);line(c,34,21,32,49,'#a55b67',2);c.restore();
  }
  line(c,98,19,98,181,'#493b33',6);line(c,97,20,97,180,'#ddbd7e',2);
  line(c,21,68,175,68,'#493b33',5);line(c,21,67,175,67,'#ddbd7e',1.5);
  line(c,124,35,147,23,'#fff0c36b',3);line(c,138,39,161,27,'#fff0c340',2);
  box(c,4,186,188,12,'#e5c799','#654e3e',2);line(c,8,189,188,189,'#ffebc5',3);box(c,11,199,174,5,'#ad8b66',ink,1);
  for(const [x,rx]of [[31,23],[64,18],[142,30],[171,14]])oval(c,x,184,rx,3,'#f5f8f7');
}
export function rearWindowArt(scene:Phaser.Scene){
  const make=(key:string,w:number,h:number,paint:(c:Paint)=>void)=>{
    if(!scene.textures.exists(key)){const canvas=document.createElement('canvas');canvas.width=w*2;canvas.height=h*2;const c=canvas.getContext('2d')!;c.scale(2,2);paint(c);scene.textures.addCanvas(key,canvas);}return key;
  };
  return {frame:make('casino-rear-window-frame',REAR_WINDOW.width,REAR_WINDOW.height,frame),rooms:[0,1,2].map(kind=>make('casino-rear-window-room-'+kind,REAR_WINDOW.glass.w,REAR_WINDOW.glass.h,c=>room(c,kind)))};
}
