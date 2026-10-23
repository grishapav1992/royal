import { activityHall, type HallId } from '../shared/world';
import Phaser from 'phaser';
import { ACTIVITIES, type ActivityId } from '../shared/activities';
export function drawActivities(scene:Phaser.Scene,open:(id:ActivityId)=>void,hall:HallId){
  const make=(key:string,w:number,h:number,paint:(c:CanvasRenderingContext2D)=>void)=>{
    if(scene.textures.exists(key))return key;
    const t=scene.textures.createCanvas(key,w*3,h*3)!;t.context.scale(3,3);paint(t.context);t.refresh();return key;
  };
  const hockey=make('social-hockey',100,116,c=>{
    c.fillStyle='#080f1c';c.fillRect(8,85,8,31);c.fillRect(84,85,8,31);
    const g='#d95244';
    c.fillStyle=g;c.beginPath();c.roundRect(0,0,100,103,8);c.fill();
    c.fillStyle='#f7efd8';c.beginPath();c.roundRect(8,7,84,85,5);c.fill();
    c.strokeStyle='#37869b';c.lineWidth=2;c.strokeRect(13,11,74,76);c.beginPath();c.moveTo(9,49);c.lineTo(91,49);c.stroke();c.beginPath();c.arc(50,49,14,0,7);c.stroke();
    for(let x=17;x<87;x+=7)for(let y=14;y<87;y+=7){c.fillStyle='#48738955';c.fillRect(x,y,.6,.6);}
    c.fillStyle='#0f283e';c.fillRect(35,4,30,4);c.fillRect(35,88,30,4);
    for(const [x,y,color] of [[35,24,'#bb5f79'],[65,70,'#55b9d3']] as const){c.fillStyle='#20394766';c.beginPath();c.ellipse(x,y+4,10,6,0,0,7);c.fill();c.fillStyle=color;c.beginPath();c.ellipse(x,y,9,6,0,0,7);c.fill();c.fillStyle='#e4faff';c.beginPath();c.ellipse(x,y-3,4,3,0,0,7);c.fill();}
    c.fillStyle='#22364a';c.beginPath();c.ellipse(52,46,4,3,0,0,7);c.fill();c.fillStyle='#fff2cb';c.font='5px sans-serif';c.fillText('AIR HOCKEY',30,100);
  });
  if(hall==='tables')scene.add.image(ACTIVITIES.hockey.bounds.x-5,ACTIVITIES.hockey.bounds.y-7,hockey).setOrigin(0).setDisplaySize(100,116).setDepth(ACTIVITIES.hockey.bounds.y+103);
  const piano=make('social-piano',120,91,c=>{
    c.fillStyle='#131722';for(const x of [14,96])c.fillRect(x,56,6,20);
    const g='#363c3a';
    c.fillStyle=g;c.beginPath();c.moveTo(7,59);c.lineTo(7,27);c.bezierCurveTo(7,0,59,-4,69,11);c.bezierCurveTo(80,28,112,12,112,41);c.lineTo(112,63);c.closePath();c.fill();
    c.strokeStyle='#292c29';c.lineWidth=2;c.stroke();c.fillStyle='#0b101a';c.fillRect(8,48,103,21);
    for(let i=0;i<21;i++){c.fillStyle='#ede8da';c.fillRect(11+i*4.6,53,4,12);if(![2,6].includes(i%7)){c.fillStyle='#141a26';c.fillRect(14+i*4.6,53,2.6,7);}}
    c.fillStyle='#d4b783';c.font='5px serif';c.fillText('ROYAL',47,45);
    c.strokeStyle='#d8cba733';c.beginPath();c.moveTo(18,30);c.bezierCurveTo(21,8,52,10,57,15);c.stroke();
    c.fillStyle='#86694e';c.fillRect(42,76,38,11);c.fillStyle='#342b29';c.fillRect(46,85,4,6);c.fillRect(72,85,4,6);
  });
  if(hall==='arcade')scene.add.image(65,251,piano).setOrigin(0).setDisplaySize(120,91).setDepth(322);
  const chess=make('social-chess',108,64,c=>{
    c.fillStyle='#433127';c.beginPath();c.roundRect(0,0,108,64,7);c.fill();
    c.fillStyle='#ad855b';c.fillRect(5,4,98,54);
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      const x=19+col*8.5,y=7+row*6;c.fillStyle=(row+col)%2?'#6a5241':'#e6d6ae';c.fillRect(x,y,8.5,6);
      if(row<2||row>5){c.fillStyle='#0006';c.beginPath();c.ellipse(x+4.5,y+4.5,3,1.5,0,0,7);c.fill();c.fillStyle=row<2?'#20232b':'#fff1d6';c.beginPath();c.ellipse(x+4,y+3,2.6,1.7,0,0,7);c.fill();c.fillRect(x+2.8,y,2.4,3);c.beginPath();c.arc(x+4,y,1.7,0,7);c.fill();}
    }
  });
  if(hall==='tables')scene.add.image(ACTIVITIES.chess.bounds.x-1,ACTIVITIES.chess.bounds.y-2,chess).setOrigin(0).setDisplaySize(108,64).setDepth(ACTIVITIES.chess.bounds.y+64);
  const combat=make('social-mortal-kombat',104,143,c=>{
    c.fillStyle='#201d29';c.beginPath();c.roundRect(0,0,104,143,8);c.fill();
    c.fillStyle='#b99b56';c.fillRect(3,4,98,22);c.fillStyle='#140f17';c.font='bold 10px sans-serif';c.fillText('MORTAL KOMBAT',7,19);
    c.fillStyle='#182a34';c.fillRect(10,33,84,60);c.fillStyle='#77b9c8';c.fillRect(30,46,11,28);c.fillStyle='#cdb59a';c.fillRect(65,46,11,28);
    c.fillStyle='#6c5c70';c.fillRect(5,101,94,20);
    for(const x of [27,69]){c.fillStyle='#19111c';c.fillRect(x,97,3,13);c.fillStyle='#d97960';c.beginPath();c.arc(x+1,96,5,0,7);c.fill();}
    c.fillStyle='#e8cb7d';c.font='8px sans-serif';c.fillText('PVP  /  5%',31,134);
  });
  if(hall==='tables')scene.add.image(1408,332,combat).setOrigin(0).setDepth(475);
  for(const id of ['mortal-kombat','hockey','pool','chess','piano'] as const){
    if(activityHall(id)!==hall)continue;
    const bounds=id==='pool'?{x:454,y:344,w:216,h:140}:ACTIVITIES[id].bounds;
    scene.add.zone(bounds.x+bounds.w/2,bounds.y+bounds.h/2,bounds.w,bounds.h).setDepth(bounds.y+bounds.h+2).setInteractive({useHandCursor:true}).on('pointerdown',()=>open(id));
  }
}
