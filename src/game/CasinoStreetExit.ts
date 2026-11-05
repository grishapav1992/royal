import type Phaser from 'phaser';

type Paint=CanvasRenderingContext2D;
type ExitDoor={entry:{x:number;y:number};click:{x:number;y:number}};
const ink='#392e30',gold='#d1ae68',cream='#efdbad';
function box(c:Paint,x:number,y:number,w:number,h:number,color:string,stroke=0){c.fillStyle=color;c.fillRect(x,y,w,h);if(stroke){c.strokeStyle=ink;c.lineWidth=stroke;c.strokeRect(x,y,w,h);}}
function line(c:Paint,x:number,y:number,x2:number,y2:number,color:string,width=1){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function oval(c:Paint,x:number,y:number,w:number,h:number,color:string){c.beginPath();c.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);c.fillStyle=color;c.fill();}

/** The near wall opens onto the same snowy paving seen outside the front entrance. */
function paintGround(c:Paint){
  box(c,34,108,132,57,'#bfc4cc');
  for(const y of [109,137,164])line(c,34,y,166,y,'#a2a9b4');
  line(c,79,109,79,137,'#a2a9b4');line(c,129,109,129,137,'#a2a9b4');line(c,54,137,54,164,'#a2a9b4');line(c,106,137,106,164,'#a2a9b4');line(c,155,137,155,164,'#a2a9b4');
  oval(c,39,151,22,7,'#f4f8f9');oval(c,162,157,23,6,'#f4f8f9');
  box(c,43,34,114,68,'#592334',1.5);box(c,48,39,104,58,'#752f44');
  c.strokeStyle=gold;c.lineWidth=1;c.strokeRect(49,40,102,56);c.strokeRect(53,44,94,48);
  for(let x=59;x<149;x+=7)line(c,x,96,x,101,'#4c2331',.7);
  c.fillStyle=gold;c.beginPath();c.moveTo(87,61);c.lineTo(83,49);c.lineTo(94,54);c.lineTo(100,45);c.lineTo(106,54);c.lineTo(117,49);c.lineTo(113,61);c.closePath();c.fill();
  c.font='bold 14px Georgia';c.textAlign='center';c.fillText('ROYAL',100,79);
  box(c,34,103,132,8,'#d5c7a6',1);box(c,36,103,128,2,'#fbebc7');line(c,40,108,160,108,'#ac9470');
  box(c,36,111,128,5,'#9ba3a9');line(c,40,114,160,114,'#e8edf0');
}
function paintFrame(c:Paint){
  for(const right of [false,true]){
    const x=right?166:20;
    box(c,x,64,14,59,cream,1.5);box(c,x+2,67,3,52,'#fff0c9');box(c,x+10,67,3,52,'#bda374');
    box(c,x-3,118,20,8,'#d6bc88',1);box(c,x-3,62,20,6,'#f6e5bd',1);
    // Open glazed leaves sit beside the passage instead of covering its floor.
    const leaf=right?155:35;box(c,leaf,77,10,29,'#617b7e',1.5);box(c,leaf+2,80,6,22,'#a5c3c0');
    line(c,leaf+3,84,leaf+6,81,'#dce4d7',1);line(c,leaf+4,96,leaf+4,102,gold,2);
    const lamp=right?188:12;
    oval(c,lamp,61,20,28,'#f6da8330');box(c,lamp-4,52,8,15,'#443c36',1);box(c,lamp-2,54,4,10,'#ffe5a0');box(c,lamp-5,50,10,3,'#4a3b32');box(c,lamp-3,67,6,3,gold);
  }
  // End caps join the existing burgundy wall and its gold lower molding.
  box(c,16,108,19,18,'#3c1829');box(c,166,108,19,18,'#3c1829');
  box(c,16,108,19,3,gold);box(c,166,108,19,3,gold);
}
export function drawCasinoStreetExit(scene:Phaser.Scene,door:ExitDoor,leave:()=>void){
  const origin={x:door.entry.x-100,y:door.entry.y-88};
  for(const [layer,paint,depth]of [['ground',paintGround,3],['frame',paintFrame,door.entry.y+38]] as const){
    const key='casino-street-exit-open-v1-'+layer;
    if(!scene.textures.exists(key)){
      const canvas=document.createElement('canvas');canvas.width=600;canvas.height=510;
      const c=canvas.getContext('2d')!;c.scale(3,3);paint(c);scene.textures.addCanvas(key,canvas);
    }
    scene.add.image(origin.x,origin.y,key).setOrigin(0).setDisplaySize(200,170).setDepth(depth);
  }
  scene.add.zone(door.click.x,door.click.y+5,150,100).setDepth(680).setInteractive({useHandCursor:true}).on('pointerdown',leave);
}
