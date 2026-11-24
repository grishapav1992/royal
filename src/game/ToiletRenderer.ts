import type Phaser from 'phaser';
import { TOILET,TOILET_WINDOW,TOILET_HALL_DOOR,CARD_TOILET_DOOR,TOILET_MERCHANT,OCCUPIED_TOILET_CUBICLE,toiletCubicleOpen } from '../shared/toilet';
import {paintToiletResident,toiletResidentRigReady} from './toiletResidentArt';
import {toiletResidentPose} from './toiletResidentPose';
import {ToiletMerchant} from './ToiletMerchant';

type Paint=CanvasRenderingContext2D;
const ink='#202b30',cream='#f4ecda',gold='#c69c58',brassLight='#f2d89f';
const backdrop='#191d35',artScale=2;
const floorTiles=['#839b9e','#869ea0','#8aa0a1','#829a9d'];
type Cubicle=typeof TOILET.cubicles[number];
type WindowView={image:HTMLCanvasElement;x:number;y:number;w:number;h:number};
let toiletWindowView:HTMLCanvasElement|undefined;
function box(c:Paint,x:number,y:number,w:number,h:number,color:string,line=1.5,edge=ink){c.fillStyle=color;c.fillRect(x,y,w,h);if(line){c.lineWidth=line;c.strokeStyle=edge;c.strokeRect(x,y,w,h);}}
function line(c:Paint,x:number,y:number,x2:number,y2:number,color:string,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function oval(c:Paint,x:number,y:number,w:number,h:number,color:string,stroke='',width=1.5){c.beginPath();c.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}

function paintedCanvas(w:number,h:number,paint:(c:Paint)=>void){
  const canvas=document.createElement('canvas');
  canvas.width=w*artScale;canvas.height=h*artScale;
  const c=canvas.getContext('2d')!;
  c.scale(artScale,artScale);
  paint(c);
  return canvas;
}

function verticalFill(c:Paint,x:number,y:number,w:number,h:number,top:string,bottom:string){
  const fill=c.createLinearGradient(x,y,x,y+h);
  fill.addColorStop(0,top);fill.addColorStop(1,bottom);
  c.fillStyle=fill;c.fillRect(x,y,w,h);
}

function paintTiles(c:Paint,x:number,y:number,w:number,h:number,tileW:number,tileH:number,colors:readonly string[],grout:string){
  box(c,x,y,w,h,grout,0);
  for(let row=0;row*tileH<h;row++){
    const offset=row%2===0?0:tileW/2;
    const ty=row*tileH,height=Math.min(tileH,h-ty);
    for(let column=0,tx=-offset;tx<w;column++,tx+=tileW){
      const left=Math.max(0,tx),width=Math.min(w,tx+tileW)-left;
      box(c,x+left,y+ty,width-1,height-1,colors[(row*7+column*5)%colors.length],0);
    }
  }
}

export function paintServiceWindow(c:Paint,x:number,y:number,view?:WindowView){
  box(c,x+4,y+4,104,92,'#1420253f',0);
  box(c,x,y,104,92,'#35535a',2);
  box(c,x+3,y+3,98,86,'#ab8652',1);
  box(c,x+7,y+7,90,78,'#182a3a',1);
  if(view)c.drawImage(view.image,view.x,view.y,view.w,view.h,x+7,y+7,90,78);
  // Only the upper sash is glazed.
  verticalFill(c,x+8,y+8,88,34,'#a5cfdb2b','#547e963e');
  c.lineWidth=1.5;c.strokeStyle=ink;c.strokeRect(x+8,y+8,88,34);
  line(c,x+15,y+32,x+39,y+12,'#e1f3eb90',1.5);
  line(c,x+22,y+34,x+46,y+14,'#e1f3eb50',1);
  box(c,x+6,y+40,92,7,'#4c6870',1.5);
  box(c,x+44,y+41,16,3,brassLight,0);
  box(c,x-4,y+87,112,7,'#d7c6a9',1.5);
  line(c,x,y+88,x+103,y+88,cream,1);
}
export function paintRoofToilet(c:Paint){
  box(c,0,0,180,160,'#684550',3);box(c,0,0,180,14,'#b2b9ac',2);
  if(!toiletWindowView){
    toiletWindowView=paintedCanvas(369,320,interior=>{
      interior.translate(-351,-100);
      paintToilet(interior);
      const resident=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];
      interior.save();interior.translate(resident.x,resident.y);
      paintToiletResident(interior,toiletResidentPose(0,true));interior.restore();
      TOILET.cubicles.forEach(p=>paintDoor(interior,p,false));
    });
  }
  paintServiceWindow(c,38,28,{image:toiletWindowView,x:0,y:0,w:toiletWindowView.width,h:toiletWindowView.height});
  line(c,19,135,40,135,'#543b46');line(c,146,56,159,68,'#543b46');
  oval(c,48,1,88,10,'#f4f8fc');oval(c,131,2,92,9,'#f4f8fc');
}
export function paintRoofToiletStep(c:Paint){
  box(c,0,0,60,24,'#8d826b',2);box(c,0,0,60,5,'#b1a38b',1);
  for(const x of [8,48])box(c,x,6,4,16,'#6c675a',0);
  line(c,17,18,42,18,'#d1c2a1');
}
function paintCubicle(c:Paint,p:Cubicle){
  const occupied=p.id===OCCUPIED_TOILET_CUBICLE;
  c.save();c.translate(p.x,p.y);
  paintTiles(c,8,8,84,124,28,31,['#7b9394','#829a9b','#789092'],'#697f82');
  verticalFill(c,8,8,84,36,'#182f3970','#182f3900');
  box(c,34,21,34,16,'#3b50575c',0);
  box(c,33,18,34,16,'#d9ddd1',1.5);
  box(c,33,18,34,5,cream,1);
  box(c,55,25,5,2,'#59797e',0);
  if(!occupied){
    oval(c,52,58,37,43,'#233c4745');
    oval(c,50,54,34,42,'#e0e4db',ink);
    oval(c,50,53,27,34,'#fffaf0');
    oval(c,50,53,21,27,'#557e87');
    line(c,46,46,54,46,'#c1e1dc',1);
  }
  const paperX=occupied?73:79,paperY=occupied?82:51;
  box(c,paperX+4,paperY-2,88-paperX,17,'#465b62',1);
  box(c,paperX,paperY,10,14,cream,1);
  box(c,paperX+2,paperY+11,7,9,'#fffae9',1);
  for(const [x,y,w,h] of [[0,0,100,8],[0,0,8,140],[92,0,8,140],[0,132,18,8],[82,132,18,8]]){
    box(c,x,y,w,h,'#42636b',1.5);
    line(c,x+1,y+1,x+w-1,y+1,'#a0b7ad',1);
  }
  c.restore();
}

function paintRoomShell(c:Paint){
  const f=TOILET.floor;
  box(c,0,0,TOILET.width,TOILET.height,backdrop,0);
  box(c,f.x-10,TOILET.wallTop+6,f.w+20,f.y+f.h-TOILET.wallTop+9,'#12182c',0);
  paintTiles(c,f.x,f.y,f.w,f.h,56,28,floorTiles,'#6b8488');
  verticalFill(c,f.x,f.y,f.w,49,'#18334152','#18334100');
  line(c,f.x+12,f.y+14,f.x+12,f.y+f.h-14,'#59787f',2);
  line(c,f.x+f.w-12,f.y+14,f.x+f.w-12,f.y+f.h-14,'#59787f',2);
  line(c,f.x+12,f.y+f.h-14,f.x+f.w-12,f.y+f.h-14,'#59787f',2);

  const plinth=194;
  paintTiles(c,f.x,TOILET.wallTop,f.w,plinth-TOILET.wallTop,52,25,['#c7c7b5','#cecebd','#c9cab9'],'#a9afa4');
  paintTiles(c,f.x,plinth,f.w,f.y-plinth,32,23,['#3d626a','#40676e','#416870'],'#2d4d56');
  box(c,f.x,plinth-2,f.w,3,gold,0);
  box(c,f.x-4,TOILET.wallTop-4,f.w+8,8,'#718b8e',1.5);
  line(c,f.x-3,TOILET.wallTop-3,f.x+f.w+3,TOILET.wallTop-3,'#b7c8bb',1);

  for(const [x,y,w,h] of [[76,236,648,8],[76,236,8,308],[716,236,8,308],[76,536,648,8]]){
    box(c,x,y,w,h,'#4c6a72',1.5);
    line(c,x+1,y+1,x+w-1,y+1,'#8fa6a5',1);
  }
}

function paintSinkStation(c:Paint){
  const p=TOILET.counter;
  box(c,p.x+4,p.y+5,p.w,p.h,'#263e4955',0);
  box(c,p.x,p.y,p.w,p.h,'#344e5a',2);
  verticalFill(c,p.x+1,p.y+1,p.w-2,p.h-8,'#a3ae9f','#7d9793');
  line(c,p.x+2,p.y+p.h-7,p.x+p.w-2,p.y+p.h-7,'#bfba9d',1);
  for(let i=0;i<2;i++){
    const cx=p.x+(i+.5)*p.w/2;
    box(c,cx-28,148,60,78,'#192d3543',0);
    box(c,cx-30,145,60,78,'#293c44',2);
    box(c,cx-28,147,56,74,gold,1);
    verticalFill(c,cx-25,150,50,68,'#85afb3','#406a7b');
    line(c,cx-19,175,cx+3,152,'#dbeddf88',1.5);
    line(c,cx-19,181,cx+9,152,'#dbeddf46',1);
    box(c,cx-20,140,40,4,brassLight,1,'#6d6653');

    oval(c,cx+1,p.y+26,53,27,'#2239445e');
    oval(c,cx,p.y+23,51,25,cream,ink);
    oval(c,cx,p.y+23,36,16,'#b6cdca');
    oval(c,cx,p.y+24,4,3,'#506c70');
    box(c,cx-3,p.y+6,6,9,'#dbe5dc',1);
    line(c,cx,p.y+10,cx,p.y+16,'#5b7b84',2);
    box(c,cx+31,p.y+12,7,14,'#e9dfc8',1);
    box(c,cx+32,p.y+9,5,3,'#4e6d70',0);
  }
  box(c,p.x+p.w+8,178,15,28,'#36545e',1.5);
  box(c,p.x+p.w+10,201,11,7,cream,1);
}

function paintToilet(c:Paint,roofView?:HTMLCanvasElement){
  paintRoomShell(c);
  paintServiceWindow(c,TOILET.window.x,TOILET.window.y,roofView?{image:roofView,x:1040,y:150,w:680,h:680*78/90}:undefined);
  const s=TOILET.step;
  box(c,s.x+3,s.y+3,s.w,s.h,'#21384358',0);
  box(c,s.x,s.y,s.w,s.h,'#4a6672',1.5);
  box(c,s.x-2,s.y,s.w+4,5,'#c9b78c',1);
  line(c,s.x+5,s.y+9,s.x+s.w-5,s.y+9,'#91afb0',1);
  paintSinkStation(c);

  for(const p of TOILET.cubicles){
    const cx=p.x+p.w/2;
    box(c,cx-18,161,36,18,'#9b795a4f',0);
    box(c,cx-15,158,30,17,'#38565f',1.5);
    box(c,cx-11,161,22,10,brassLight,0);
    line(c,cx-13,175,cx+13,175,gold,1.5);
    box(c,p.x,p.y+p.h,Math.min(p.w,TOILET.floor.x+TOILET.floor.w-p.x),5,'#203c4950',0);
    paintCubicle(c,p);
  }
  const r=TOILET.radiator,b=TOILET.bin;
  box(c,r.x,r.y,r.w,r.h,'#415d67',1.5);
  for(let y=r.y+5;y<r.y+r.h-4;y+=8)line(c,r.x+4,y,r.x+r.w-4,y,'#b4c7bf',2);
  box(c,b.x+2,b.y+3,b.w,b.h,'#2d4e5e55',0);
  box(c,b.x,b.y,b.w,b.h,'#3f5d69',1.5);
  box(c,b.x-1,b.y-1,b.w+2,5,'#223b47',1);
  line(c,b.x+6,b.y+8,b.x+6,b.y+b.h-5,'#829d9d',1.5);

  const shop=TOILET_MERCHANT;
  box(c,shop.x-28,shop.y-18,56,38,'#496773',1,'#46606a');
  box(c,shop.x-24,shop.y-14,48,30,'#597680',1,'#91a39f');
  paintHallExit(c);
}

/** The cutaway exposes the doorway and a short stretch of the card salon carpet. */
function paintHallExit(c:Paint){
  const x=TOILET_HALL_DOOR.entry.x;
  box(c,x-53,530,106,43,'#221b2c',1.5);
  box(c,x-46,531,92,38,'#693e50',1.5);
  box(c,x-39,541,78,25,'#84505c',1,'#ad805b');
  line(c,x-35,545,x+35,545,'#ad805b',1);
  box(c,x-46,529,92,10,'#c6af7c',1.5);
  line(c,x-43,530,x+43,530,brassLight,1);
  for(const side of [-1,1]){
    box(c,x+side*48-5,521,10,25,'#304d58',1.5);
    box(c,x+side*48-3,522,6,5,gold,1);
  }
  box(c,x+38,482,6,49,'#693e50',1.5);
  line(c,x+41,485,x+41,526,'#ad805b',1);
  box(c,x+35,490,4,8,gold,1);
}

/** The matching salon doorway keeps the same upper-wall scale as the floor doors. */
export function drawCardToiletDoor(scene:Phaser.Scene,enter:()=>void){
  const key='card-salon-toilet-door-v2';
  if(!scene.textures.exists(key)){
    const canvas=paintedCanvas(128,174,c=>{
      box(c,4,8,120,162,'#382630',2);box(c,9,13,110,156,'#c4a56a',2);box(c,16,20,96,146,'#4e6c61',2);
      c.save();c.beginPath();c.rect(21,25,86,137);c.clip();
      paintTiles(c,21,25,86,137,29,20,floorTiles,'#6b8488');
      box(c,23,42,80,9,'#3d626a',0);box(c,24,54,18,35,cream,1);oval(c,33,76,14,12,'#94aaa4',ink,1);
      box(c,76,25,28,137,'#713c4c',2);box(c,79,31,20,115,'#844658',1);box(c,77,97,7,4,gold,1);
      c.restore();
      box(c,10,162,108,8,cream,1.5);line(c,16,164,112,164,'#fff1d0',1);
      box(c,44,28,34,22,'#d9bf87',1);c.fillStyle=ink;c.font='bold 14px Arial';c.textAlign='center';c.fillText('WC',61,44);
    });
    scene.textures.addCanvas(key,canvas);
  }
  const door=CARD_TOILET_DOOR;
  scene.add.image(door.entry.x-64,5,key).setOrigin(0).setDisplaySize(128,174).setDepth(225);
  scene.add.zone(door.click.x,door.click.y,128,180).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',enter);
}
function paintDoor(c:Paint,p:Cubicle,open:boolean){
  if(open){
    box(c,p.x+10,p.y+73,7,64,'#152d3952',0);
    box(c,p.x+9,p.y+72,4,64,'#6b4254',1);
    line(c,p.x+11,p.y+74,p.x+11,p.y+132,'#a67879',1);
    box(c,p.x+13,p.y+78,4,3,brassLight,0);
  }else{
    box(c,p.x+18,p.y+132,64,7,'#6b4254',1.5);
    line(c,p.x+20,p.y+133,p.x+80,p.y+133,'#a67879',1);
    box(c,p.x+69,p.y+134,8,3,brassLight,0);
  }
  oval(c,p.x+88,p.y+136,5,5,p.id===OCCUPIED_TOILET_CUBICLE?'#f39b7e':'#b8d7a4',ink,1);
}

export class ToiletRenderer{
  readonly merchant:ToiletMerchant;
  readonly mapCanvas:HTMLCanvasElement;
  private mapBase:HTMLCanvasElement;
  private doors:{image:Phaser.GameObjects.Image;open:string;closed:string}[];
  private open=[false,false,false];
  private resident:Phaser.Textures.CanvasTexture;
  private elapsed=0;
  private lastFrame=-1;
  private reducedMotion=false;
  private pose=toiletResidentPose(0,true);
  constructor(scene:Phaser.Scene,leave:()=>void,roofView?:HTMLCanvasElement,leaveToHall?:()=>void,approachMerchant:()=>void=()=>{}){
    const key='casino-toilet-interior-v3';
    if(!scene.textures.exists(key))scene.textures.addCanvas(key,paintedCanvas(TOILET.width,TOILET.height,c=>paintToilet(c,roofView)));
    const base=scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
    scene.add.image(0,0,key).setOrigin(0).setDisplaySize(TOILET.width,TOILET.height).setDepth(0);
    this.mapCanvas=document.createElement('canvas');
    this.mapCanvas.width=TOILET.width;this.mapCanvas.height=TOILET.height;
    this.mapBase=this.mapCanvas.cloneNode() as HTMLCanvasElement;
    this.mapBase.getContext('2d')!.drawImage(base,0,0,TOILET.width,TOILET.height);
    const residentKey='casino-toilet-resident-v2',p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];
    this.resident=scene.textures.exists(residentKey)?scene.textures.get(residentKey) as Phaser.Textures.CanvasTexture:scene.textures.createCanvas(residentKey,300,420)!;
    this.drawResident();scene.add.image(p.x,p.y,residentKey).setOrigin(0).setDisplaySize(p.w,p.h).setDepth(14);
    this.doors=TOILET.cubicles.map(p=>{
      const doorTexture=(open:boolean)=>{
        const key='casino-toilet-cubicle-v3-'+p.id+'-'+open;
        if(!scene.textures.exists(key))scene.textures.addCanvas(key,paintedCanvas(p.w,p.h,c=>{
          c.translate(-p.x,-p.y);paintDoor(c,p,open);
        }));
        return key;
      };
      const closed=doorTexture(false),open=doorTexture(true);
      const image=scene.add.image(p.x,p.y,closed).setOrigin(0).setDisplaySize(p.w,p.h).setDepth(15);
      return {image,open,closed};
    });
    this.merchant=new ToiletMerchant(scene,approachMerchant);this.drawDoors();
    scene.add.zone(TOILET_WINDOW.click.x,TOILET_WINDOW.click.y,120,110).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',leave);
    if(leaveToHall)scene.add.zone(TOILET_HALL_DOOR.click.x,TOILET_HALL_DOOR.click.y,120,80).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',leaveToHall);
  }
  private drawDoors(){
    this.doors.forEach((door,i)=>door.image.setTexture(this.open[i]?door.open:door.closed));
    this.drawMap();
  }
  private drawMap(){
    const c=this.mapCanvas.getContext('2d')!,p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];
    c.drawImage(this.mapBase,0,0);
    c.drawImage(this.resident.canvas,p.x,p.y,p.w,p.h);
    TOILET.cubicles.forEach((p,i)=>paintDoor(c,p,this.open[i]));
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
