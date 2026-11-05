import type Phaser from 'phaser';
import { TOILET,TOILET_WINDOW,TOILET_HALL_DOOR,CARD_TOILET_DOOR,OCCUPIED_TOILET_CUBICLE,toiletCubicleOpen } from '../shared/toilet';
import {paintToiletResident,toiletResidentRigReady} from './toiletResidentArt';
import {toiletResidentPose} from './toiletResidentPose';
import {ToiletMerchant} from './ToiletMerchant';

type Paint=CanvasRenderingContext2D;
const ink='#302f35',cream='#f2ead3',gold='#c9aa70';
type WindowView={image:HTMLCanvasElement;x:number;y:number;w:number;h:number};
let toiletWindowView:HTMLCanvasElement|undefined;
function box(c:Paint,x:number,y:number,w:number,h:number,color:string,line=1.5,edge=ink){c.fillStyle=color;c.fillRect(x,y,w,h);if(line){c.lineWidth=line;c.strokeStyle=edge;c.strokeRect(x,y,w,h);}}
function line(c:Paint,x:number,y:number,x2:number,y2:number,color:string,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function oval(c:Paint,x:number,y:number,w:number,h:number,color:string,stroke='',width=1.5){c.beginPath();c.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}

export function paintServiceWindow(c:Paint,x:number,y:number,view?:WindowView){
  box(c,x,y,104,92,'#c1c9ba',2.5);box(c,x+7,y+7,90,78,'#273139',1);
  if(view){
    c.save();c.beginPath();c.rect(x+7,y+7,90,78);c.clip();
    c.drawImage(view.image,view.x,view.y,view.w,view.h,x+7,y+7,90,78);
    c.restore();
  }
  // The raised glazed sash stays translucent; the lower opening has no glass tint.
  c.save();c.globalAlpha=.24;c.fillStyle='#87a5a3';c.fillRect(x+8,y+8,88,34);c.restore();
  c.lineWidth=2;c.strokeStyle=ink;c.strokeRect(x+8,y+8,88,34);line(c,x+24,y+30,x+45,y+14,'#c5d7cd');
  box(c,x+6,y+40,92,7,'#b3bdac',2);box(c,x+45,y+41,14,3,'#6e7b74',0);
  box(c,x-8,y+89,120,8,cream,1.5);line(c,x+20,y+94,x+33,y+94,'#a89d86',1.5);
}
export function paintRoofToilet(c:Paint){
  box(c,0,0,180,160,'#684550',3);box(c,0,0,180,14,'#b2b9ac',2);
  if(!toiletWindowView){
    toiletWindowView=document.createElement('canvas');toiletWindowView.width=TOILET.width;toiletWindowView.height=TOILET.height;
    const interior=toiletWindowView.getContext('2d')!;paintToilet(interior);TOILET.cubicles.forEach(p=>paintDoor(interior,p,false));
    const resident=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];interior.save();interior.translate(resident.x,resident.y);paintToiletResident(interior,toiletResidentPose(0,true));interior.restore();
  }
  paintServiceWindow(c,38,28,{image:toiletWindowView,x:350,y:100,w:370,h:370*78/90});
  line(c,19,135,40,135,'#543b46');line(c,146,56,159,68,'#543b46');
  oval(c,48,1,88,10,'#f4f8fc');oval(c,131,2,92,9,'#f4f8fc');
}
export function paintRoofToiletStep(c:Paint){
  box(c,0,0,60,24,'#8d826b',2);box(c,0,0,60,5,'#b1a38b',1);
  for(const x of [8,48])box(c,x,6,4,16,'#6c675a',0);
  line(c,17,18,42,18,'#d1c2a1');
}
function paintCubicle(c:Paint,p:typeof TOILET.cubicles[number]){
  c.save();c.translate(p.x,p.y);
  for(let y=8;y<132;y+=40)for(let x=8;x<92;x+=40)box(c,x,y,Math.min(40,92-x),Math.min(40,132-y),['#d8d7c8','#becac1'][(Math.floor(x/40)+Math.floor(y/40))%2],.7,'#9da99e');
  box(c,33,18,34,16,cream,1.5);box(c,34,18,32,4,'#fff6df',1);box(c,55,25,5,2,'#7d9391',0);
  if(p.id!==OCCUPIED_TOILET_CUBICLE){oval(c,50,55,34,42,'#e6e5d1',ink);oval(c,50,54,26,34,'#f7f1dc');oval(c,50,54,21,28,'#8ba7a2');}
  const paperY=p.id===OCCUPIED_TOILET_CUBICLE?9:0;
  box(c,88,49+paperY,4,18,'#657b75',1);box(c,80,50+paperY,10,16,cream,1);box(c,82,65+paperY,7,9,'#fff6df',1);line(c,81,54+paperY,89,54+paperY,'#aaa89a',1);
  oval(c,20,74,12,14,'#657e73',ink,1);
  for(const [x,y,w,h]of [[0,0,100,8],[0,0,8,140],[92,0,8,140],[0,132,18,8],[82,132,18,8]])box(c,x,y,w,h,'#81958a');
  c.restore();
}
function paintToilet(c:Paint,roofView?:HTMLCanvasElement){
  box(c,0,0,TOILET.width,TOILET.height,'#202536',0);
  const f=TOILET.floor;
  for(let y=f.y;y<f.y+f.h;y+=40)for(let x=f.x;x<f.x+f.w;x+=40)box(c,x,y,Math.min(40,f.x+f.w-x),Math.min(40,f.y+f.h-y),['#d8d7c8','#becac1'][((x-f.x)/40+(y-f.y)/40)%2],.8,'#9da99e');
  for(let y=120;y<240;y+=30)for(let x=f.x;x<f.x+f.w;x+=40)box(c,x,y,40,30,'#e8dfc9',.7,'#c4c6b7');
  box(c,f.x,213,f.w,27,'#54776e',0);box(c,f.x,210,f.w,3,gold,0);box(c,f.x-4,116,f.w+8,8,'#b6bcae',2);
  for(const [x,y,w,h]of [[76,236,648,8],[76,236,8,308],[716,236,8,308],[76,536,648,8]])box(c,x,y,w,h,'#81958a');
  paintServiceWindow(c,TOILET.window.x,TOILET.window.y,roofView?{image:roofView,x:1040,y:150,w:680,h:680*78/90}:undefined);
  const s=TOILET.step;box(c,s.x,s.y,s.w,s.h,'#9b8d76');box(c,s.x-2,s.y,s.w+4,5,'#c3b49a',1);
  const p=TOILET.counter;box(c,p.x,p.y,p.w,p.h,'#a7ada0',2);box(c,p.x,p.y+p.h-5,p.w,5,'#747e75',1);
  for(let i=0;i<2;i++){
    const cx=p.x+(i+.5)*p.w/2;
    box(c,cx-31,152,62,75,gold,2);box(c,cx-27,156,54,67,'#8eaaa8',1);line(c,cx-18,204,cx+14,165,'#d0ded3');
    oval(c,cx,p.y+23,55,29,cream,ink);oval(c,cx,p.y+23,39,17,'#9cb5ae');oval(c,cx,p.y+23,4,4,'#536f70');
    box(c,cx-3,p.y+6,6,8,'#b9c8bf',1);line(c,cx,p.y+8,cx,p.y+16,'#526d71',3);
    box(c,cx+32,p.y+12,8,15,'#e4dfcb',1);box(c,cx+34,p.y+9,5,3,'#6e8982',0);
  }
  box(c,p.x+p.w+6,180,19,31,'#c7c7b6',1);box(c,p.x+p.w+9,205,13,12,cream,1);
  TOILET.cubicles.forEach(p=>paintCubicle(c,p));
  const r=TOILET.radiator,b=TOILET.bin;
  box(c,r.x,r.y,r.w,r.h,'#788d81',1);for(let y=r.y+4;y<r.y+r.h-3;y+=8)box(c,r.x+2,y,r.w-4,4,'#d6d8c4',1);
  box(c,b.x,b.y,b.w,b.h,'#536a60');box(c,b.x-2,b.y-2,b.w+4,6,'#344d45',1);line(c,b.x+7,b.y+9,b.x+7,b.y+b.h-5,'#91a394',1.5);
  box(c,320,486,38,15,'#8b9b91',1);for(let x=325;x<355;x+=6)line(c,x,489,x,498,'#4b6260',1.5);
  paintHallExit(c);
}

/** A cut-away near wall exposes the threshold and a little of the warm salon. */
function paintHallExit(c:Paint){
  const x=TOILET_HALL_DOOR.entry.x;
  box(c,x-46,529,92,52,'#713c4c',0);
  box(c,x-36,542,72,36,'#8b4658',0);line(c,x-31,549,x+31,549,gold,1);
  box(c,x-46,532,92,8,'#e0d0ab',1);line(c,x-40,534,x+40,534,'#fff1d0',1);
  for(const side of [-1,1]){box(c,x+side*48-5,521,10,25,'#55786d',1.5);box(c,x+side*48-3,522,6,5,cream,1);}
  box(c,x+38,482,6,49,'#713c4c',1.5);box(c,x+35,490,4,8,gold,1);
  box(c,x-79,540,24,18,'#bda477',1);c.fillStyle=ink;c.font='bold 11px Arial';c.textAlign='center';c.fillText('03',x-67,553);
}

/** The matching salon doorway keeps the same upper-wall scale as the floor doors. */
export function drawCardToiletDoor(scene:Phaser.Scene,enter:()=>void){
  const key='card-salon-toilet-door-v1';
  if(!scene.textures.exists(key)){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=348;
    const c=canvas.getContext('2d')!;c.scale(2,2);
    box(c,4,8,120,162,'#382630',2);box(c,9,13,110,156,'#c4a56a',2);box(c,16,20,96,146,'#4e6c61',2);
    c.save();c.beginPath();c.rect(21,25,86,137);c.clip();
    for(let y=25;y<164;y+=25)for(let x=21;x<109;x+=29)box(c,x,y,29,25,['#d8d7c8','#becac1'][(Math.floor((x-21)/29)+Math.floor((y-25)/25))%2],.6,'#9da99e');
    box(c,23,42,80,9,'#54776e',0);box(c,24,54,18,35,cream,1);oval(c,33,76,14,12,'#94aaa4',ink,1);
    box(c,76,25,28,137,'#713c4c',2);box(c,79,31,20,115,'#844658',1);box(c,77,97,7,4,gold,1);
    c.restore();
    box(c,10,162,108,8,cream,1.5);line(c,16,164,112,164,'#fff1d0',1);
    box(c,44,28,34,22,'#d9bf87',1);c.fillStyle=ink;c.font='bold 14px Arial';c.textAlign='center';c.fillText('WC',61,44);
    scene.textures.addCanvas(key,canvas);
  }
  const door=CARD_TOILET_DOOR;
  scene.add.image(door.entry.x-64,5,key).setOrigin(0).setDisplaySize(128,174).setDepth(225);
  scene.add.zone(door.click.x,door.click.y,128,180).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',enter);
}
function paintDoor(c:Paint,p:typeof TOILET.cubicles[number],open:boolean){
  if(open){box(c,p.x+9,p.y+72,4,64,'#713c4c',1);box(c,p.x+13,p.y+77,3,2,gold,0);}
  else{box(c,p.x+18,p.y+134,64,4,'#713c4c',1);box(c,p.x+71,p.y+134,6,2,gold,0);oval(c,p.x+88,p.y+136,3.6,3.6,p.id===OCCUPIED_TOILET_CUBICLE?'#c95b51':'#a7bc90');}
}

export class ToiletRenderer{
  readonly merchant:ToiletMerchant;
  readonly mapCanvas:HTMLCanvasElement;
  private base:HTMLCanvasElement;
  private doors:Phaser.GameObjects.Graphics;
  private open=[false,false,false];
  private resident:Phaser.Textures.CanvasTexture;
  private elapsed=0;
  private lastFrame=-1;
  private reducedMotion=false;
  private pose=toiletResidentPose(0,true);
  constructor(scene:Phaser.Scene,leave:()=>void,roofView?:HTMLCanvasElement,leaveToHall?:()=>void,approachMerchant:()=>void=()=>{}){
    this.base=document.createElement('canvas');this.base.width=TOILET.width;this.base.height=TOILET.height;
    paintToilet(this.base.getContext('2d')!,roofView);
    const key='casino-toilet-rectangle-v2';if(!scene.textures.exists(key))scene.textures.addCanvas(key,this.base);
    scene.add.image(0,0,key).setOrigin(0).setDepth(0);
    this.mapCanvas=document.createElement('canvas');this.mapCanvas.width=TOILET.width;this.mapCanvas.height=TOILET.height;
    const residentKey='casino-toilet-resident-v2',p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];
    this.resident=scene.textures.exists(residentKey)?scene.textures.get(residentKey) as Phaser.Textures.CanvasTexture:scene.textures.createCanvas(residentKey,300,420)!;
    this.drawResident();scene.add.image(p.x,p.y,residentKey).setOrigin(0).setDisplaySize(100,140).setDepth(14);
    this.doors=scene.add.graphics().setDepth(15);
    this.merchant=new ToiletMerchant(scene,approachMerchant);this.drawDoors();
    scene.add.zone(TOILET_WINDOW.click.x,TOILET_WINDOW.click.y,120,110).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',leave);
    if(leaveToHall)scene.add.zone(TOILET_HALL_DOOR.click.x,TOILET_HALL_DOOR.click.y,120,80).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',leaveToHall);
  }
  private drawDoors(){
    const g=this.doors;g.clear();
    TOILET.cubicles.forEach((p,i)=>{
      const open=this.open[i];
      g.fillStyle(0x713c4c).lineStyle(1,0x302f35);
      if(open){g.fillRect(p.x+9,p.y+72,4,64).strokeRect(p.x+9,p.y+72,4,64);g.fillStyle(0xc9aa70).fillRect(p.x+13,p.y+77,3,2);}
      else{g.fillRect(p.x+18,p.y+134,64,4).strokeRect(p.x+18,p.y+134,64,4);g.fillStyle(0xc9aa70).fillRect(p.x+71,p.y+134,6,2);g.fillStyle(p.id===OCCUPIED_TOILET_CUBICLE?0xc95b51:0xa7bc90).fillCircle(p.x+88,p.y+136,1.8);}
    });
    this.drawMap();
  }
  private drawMap(){
    const c=this.mapCanvas.getContext('2d')!,p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];c.drawImage(this.base,0,0);
    TOILET.cubicles.forEach((p,i)=>paintDoor(c,p,this.open[i]));c.drawImage(this.resident.canvas,p.x,p.y,100,140);
    this.merchant?.drawMap(c);
  }
  private drawResident(){
    const c=this.resident.context;c.clearRect(0,0,300,420);c.save();c.scale(3,3);paintToiletResident(c,this.pose);c.restore();this.resident.refresh();this.drawMap();
  }
  update(people:readonly {x:number;y:number;moving?:boolean}[],delta=0,reducedMotion=false,available=true){
    if(people[0]&&this.merchant.update(delta,people[0],reducedMotion,available))this.drawMap();
    const open=TOILET.cubicles.map(p=>toiletCubicleOpen(p.id,people));
    if(open.some((value,i)=>value!==this.open[i])){this.open=open;this.drawDoors();}
    if(reducedMotion!==this.reducedMotion){this.reducedMotion=reducedMotion;if(reducedMotion)this.elapsed=0;this.lastFrame=-1;}
    if(!reducedMotion)this.elapsed+=Math.min(100,Math.max(0,delta));
    const frame=reducedMotion?0:Math.floor(this.elapsed*12/1000);
    if(frame!==this.lastFrame){this.lastFrame=frame;this.pose=toiletResidentPose(this.elapsed,reducedMotion);this.drawResident();}
  }
  getState(){const p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];return {variant:1,merchant:this.merchant.getState(),openDoors:[...this.open],occupiedCubicle:p.id,floor:TOILET.floor,resident:{...this.pose,artVersion:2,artLoaded:toiletResidentRigReady(),elapsedMs:this.elapsed,frame:this.lastFrame,cubicle:p.id,interactive:false,reducedMotion:this.reducedMotion,bounds:{x:p.x+9,y:p.y+9,w:82,h:123}}};}
}
