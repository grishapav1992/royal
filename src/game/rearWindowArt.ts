import type Phaser from 'phaser';
import { REAR_WINDOW } from './rearWindowLife';

type Paint=CanvasRenderingContext2D;
const ink='#382e32',cream='#f3dcb1',gold='#d4ae64';
function box(c:Paint,x:number,y:number,w:number,h:number,color:string,stroke=ink,line=1.5){c.fillStyle=color;c.fillRect(x,y,w,h);if(line){c.strokeStyle=stroke;c.lineWidth=line;c.strokeRect(x,y,w,h);}}
function line(c:Paint,x:number,y:number,x2:number,y2:number,color:string,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function oval(c:Paint,x:number,y:number,rx:number,ry:number,color:string){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();}
function closed(c:Paint){
  const {w,h}=REAR_WINDOW.glass;box(c,0,0,w,h,'#39414b',ink,0);
  for(let y=4;y<h;y+=11){box(c,0,y,w,8,'#545660',ink,0);line(c,0,y+8,w,y+8,'#2f3440',1);}
  line(c,23,0,23,h,'#8b8279',1);line(c,w-23,0,w-23,h,'#8b8279',1);
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
  return {frame:make('casino-rear-window-frame',REAR_WINDOW.width,REAR_WINDOW.height,frame),closed:make('casino-rear-window-closed-v2',REAR_WINDOW.glass.w,REAR_WINDOW.glass.h,closed)};
}
