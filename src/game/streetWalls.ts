import type Phaser from 'phaser';
import { STREET } from '../shared/street';

/** Opaque exterior elevations. Rear details keep the original world anchors. */
export function createStreetWall(scene:Phaser.Scene,side:'rear'|'left'|'right'){
  const width=side==='rear'?STREET.building.w:STREET.building.h,key='street-exterior-'+side;
  if(scene.textures.exists(key))return key;
  const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=700;
  const c=canvas.getContext('2d')!;c.scale(2,2);
  const box=(x:number,y:number,w:number,h:number,color:string,stroke='#342731')=>{c.fillStyle=color;c.fillRect(x,y,w,h);c.strokeStyle=stroke;c.lineWidth=2;c.strokeRect(x,y,w,h);};
  const line=(x:number,y:number,x2:number,y2:number,color:string,w=2)=>{c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=w;c.stroke();};
  box(0,0,width,350,side==='rear'?'#65303f':'#681a32');
  for(let x=0;x<width;x+=160)line(x,0,x,347,'#532836',1);
  box(0,338,width,12,'#aa9c8b');line(0,339,width,339,'#ddd0b5',3);
  const vent=(x:number)=>{box(x-69,234,138,65,'#8d9794');for(let y=243;y<294;y+=8)line(x-60,y,x+60,y,'#44595c',3);};
  const lamp=(x:number)=>{box(x-17,187,34,22,'#e4ca87');line(x-17,212,x+17,212,'#a79165',3);};
  const pipe=(x:number)=>{line(x,0,x,318,'#293c42',9);line(x,0,x,318,'#87948d',5);for(const y of [65,175,285])box(x-7,y,14,7,'#536761');line(x,318,x-13,330,'#536761',7);};
  if(side==='rear'){
    const local=(worldOffset:number)=>width-worldOffset;
    const door=local(700);box(door-61,178,122,160,'#384c50');box(door-54,184,108,148,'#768384');
    for(const dx of [-27,27]){box(door+dx-18,194,36,75,'#657373');for(let y=202;y<262;y+=8)line(door+dx-13,y,door+dx+13,y,'#3e5256');}
    line(door,184,door,332,'#3c4c4f',3);box(door+18,294,20,5,'#c1b994');
    vent(local(149));vent(local(1189));pipe(local(225));pipe(local(1265));
    for(const x of [517,892,1387])lamp(local(x));
  }else{
    for(const x of [12,width-12]){box(x-10,0,20,338,'#e7cda3');box(x-15,325,30,13,'#cfb487');}
    vent(side==='right'?135:width-135);pipe(side==='right'?width-45:45);lamp(width/2);
    for(const x of [95,245]){box(x,20,72,105,'#b69a65');box(x+5,25,62,94,'#f3d479');line(x+36,25,x+36,118,'#4b4140',3);line(x+5,72,x+67,72,'#4b4140',3);}
    box(0,140,width,12,'#e7cda3');
  }
  scene.textures.addCanvas(key,canvas);return key;
}
