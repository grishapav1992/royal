import Phaser from 'phaser';
import { RooftopRenderer } from '../../../src/game/RooftopRenderer';
import { ROOF,ROOF_OBSTACLES } from '../../../src/shared/rooftop';
import { FLOOR,BOUNDS,HALL_WALL } from '../../../src/shared/clubGeometry';
import { findPath,walkable,type Obstacle } from '../../../src/game/navigation';
import { characterTexture,CHARACTER_SCALE } from '../../../src/game/characters';
import { appearanceFromLegacy,serializeAppearance } from '../../../src/shared/appearance';

// Proposal only. This scene never registers a hall or changes the running game.
export const TOILET_ENTRY={x:760,y:410,w:220,h:170,approach:{x:870,y:650},trigger:{x:870,y:620}};
export const TOILET_ROOM={width:1320,height:ROOF.height,floor:{...FLOOR,width:1320-FLOOR.x*2},bounds:{...BOUNDS,right:1250},spawn:{x:660,y:1210},exit:{x:660,y:1300}};
const ink=0x302b35,cream=0xf3dcb1,gold=0xd4ae64,burgundy=0x713046,teal=0x315c64;
const sinks=[{x:160,y:265,w:130,h:125},{x:350,y:265,w:130,h:125}];
const stalls=[650,850,1050].map(x=>({x,y:220,w:180,h:190}));
const roomObstacles:Obstacle[]=[
  {x:0,y:0,w:1320,h:BOUNDS.top-1},{x:0,y:0,w:BOUNDS.left-1,h:1380},
  {x:1251,y:0,w:5000,h:1380},{x:0,y:1301,w:590,h:100},{x:730,y:1301,w:590,h:100},...sinks,...stalls,
  {x:130,y:920,w:200,h:60},{x:95,y:600,w:75,h:130},{x:500,y:400,w:60,h:65},
];

export function geometryChecks(){
  const roofObstacles=[...ROOF_OBSTACLES,TOILET_ENTRY];
  const overlap=ROOF_OBSTACLES.some(o=>TOILET_ENTRY.x<o.x+o.w&&TOILET_ENTRY.x+TOILET_ENTRY.w>o.x&&TOILET_ENTRY.y<o.y+o.h&&TOILET_ENTRY.y+TOILET_ENTRY.h>o.y);
  const roofPath=findPath(ROOF.spawn,TOILET_ENTRY.approach,roofObstacles);
  const perimeter=ROOF.loop.every((p,i)=>findPath(p,ROOF.loop[(i+1)%ROOF.loop.length],roofObstacles).length>0);
  const targets=[{x:225,y:450},{x:415,y:450},...stalls.map(p=>({x:p.x+p.w/2,y:p.y+p.h+65})),TOILET_ROOM.exit];
  const approaches=targets.map(p=>({point:p,walkable:walkable(p.x,p.y,roomObstacles,16),path:findPath(TOILET_ROOM.spawn,p,roomObstacles).length>0}));
  if(overlap||!roofPath.length||!perimeter||approaches.some(p=>!p.walkable||!p.path))throw Error('Reference geometry has an obstructed approach');
  return {roof:{width:ROOF.width,height:ROOF.height,deck:ROOF.deck,entry:TOILET_ENTRY,existingPropsUnmoved:true,noOverlap:!overlap,approachReachable:true,perimeterReachable:perimeter},room:{...TOILET_ROOM,proposed:true,approaches,obstacles:roomObstacles},projection:'Same camera fit and upright sprites as RoomScene.resizeView',character:{scale:CHARACTER_SCALE,width:96*CHARACTER_SCALE,height:144*CHARACTER_SCALE}};
}

export function startReference(mode:'roof'|'room',close:boolean){
  const size={width:1120,height:840};
  class ReferenceScene extends Phaser.Scene{
    create(){
      const frame=mode==='roof'?ROOF:TOILET_ROOM;
      if(mode==='roof'){new RooftopRenderer(this,()=>{});this.roofDoor();}else this.restroom();
      const point=mode==='roof'?TOILET_ENTRY.approach:close?{x:605,y:360}:TOILET_ROOM.spawn;
      const player=this.add.sprite(point.x,point.y,characterTexture(this,0,serializeAppearance(appearanceFromLegacy(0))),'down-6').setOrigin(.5,1).setScale(CHARACTER_SCALE).setDepth(point.y);
      this.add.ellipse(point.x,point.y-1,29,10,0x27202c,.15).setDepth(point.y-1);
      const fit=Math.min(size.width/(frame.width-40),size.height/(frame.height-HALL_WALL.viewTop-50));
      const zoom=close?Math.max(fit,Phaser.Math.Clamp(Math.min(size.width/1000,size.height/760),.8,1.3)):fit;
      const viewWidth=size.width/zoom,viewHeight=size.height/zoom;
      const camera=this.cameras.main.setZoom(zoom).setBounds(Math.min(0,(frame.width-viewWidth)/2),Math.min(HALL_WALL.viewTop,(frame.height+HALL_WALL.viewTop-viewHeight)/2),Math.max(frame.width,viewWidth),Math.max(frame.height-HALL_WALL.viewTop,viewHeight));
      camera.centerOn(close?player.x:frame.width/2,close?player.y:(frame.height+HALL_WALL.viewTop)/2);
      this.game.events.once('postrender',()=>{(window as any).__referenceReady=true;});
    }
    box(g:Phaser.GameObjects.Graphics,x:number,y:number,w:number,h:number,color:number,edge=ink,line=2){g.fillStyle(color).fillRect(x,y,w,h);if(line)g.lineStyle(line,edge).strokeRect(x,y,w,h);}
    label(x:number,y:number,text:string,size=15,color='#f3dcb1',depth=10){return this.add.text(x,y,text,{fontFamily:'Arial',fontSize:size,fontStyle:'bold',color}).setOrigin(.5).setDepth(depth);}
    roofDoor(){
      const p=TOILET_ENTRY,g=this.add.graphics().setDepth(p.y+p.h);
      this.box(g,p.x,p.y,p.w,p.h,burgundy,ink,4);this.box(g,p.x,p.y,p.w,17,cream,ink,3);
      this.box(g,p.x+42,p.y+34,136,132,0x293e4c,ink,4);this.box(g,p.x+50,p.y+42,120,121,0x78918f);
      for(let y=p.y+61;y<p.y+107;y+=9)g.lineStyle(3,0x3e5e65).lineBetween(p.x+62,y,p.x+158,y);
      this.box(g,p.x+143,p.y+125,19,5,gold,ink,1);this.box(g,p.x+24,p.y+20,p.w-48,24,0xf6cf58);
      this.label(p.x+p.w/2,p.y+32,'ТУАЛЕТ',15,'#292b36',p.y+p.h+1);
      g.fillStyle(0xf4f8fc).fillEllipse(p.x+63,p.y+2,118,14).fillEllipse(p.x+169,p.y+3,92,12);
      const steps=this.add.graphics().setDepth(.1);this.box(steps,p.x+57,p.y+p.h,106,53,0x394a58);
      for(let y=p.y+p.h+4;y<p.y+p.h+55;y+=10)steps.lineStyle(4,0xb9c6bc).lineBetween(p.x+60,y,p.x+160,y);
      for(const x of [p.x+52,p.x+168])steps.lineStyle(5,0xdec58a).lineBetween(x,p.y+p.h-3,x,p.y+p.h+57);
    }
    restroom(){
      const {floor}=TOILET_ROOM,g=this.add.graphics().setDepth(0);
      this.box(g,0,HALL_WALL.viewTop,1320,1380-HALL_WALL.viewTop,0x191d35,ink,0);
      this.box(g,floor.x,HALL_WALL.top,floor.width,HALL_WALL.height,0xead9b4,ink,0);
      for(let y=HALL_WALL.top;y<175;y+=55)for(let x=55;x<1265;x+=72)this.box(g,x,y,72,55,0xeadfc8,0xcabda3,1);
      this.box(g,55,110,1210,65,0x4f7974,ink,0);g.lineStyle(4,gold).lineBetween(55,110,1265,110);
      this.box(g,floor.x,floor.y,floor.width,floor.height,0xc4c5bd,ink,0);
      for(let y=floor.y;y<1320;y+=72)for(let x=floor.x;x<1265;x+=72){this.box(g,x,y,72,72,((Math.round((x-55)/72)+Math.round((y-175)/72))%2)?0xd4d1c2:0xbec4bf,0x9ea8a5,1);}
      for(const x of [40,1267]){this.box(g,x,HALL_WALL.top,14,1420,0x3c1829,ink,0);this.box(g,x+9,HALL_WALL.top,3,1420,gold,ink,0);}
      for(const [x,w]of [[40,550],[730,550]]){this.box(g,x,1320,w,17,0x271921,ink,0);this.box(g,x,1320,w,3,gold,ink,0);}
      // The south exit uses the same flat floor opening as the casino's ground-floor exit.
      this.box(g,590,1270,140,53,0x302637,ink,3);this.box(g,605,1277,110,39,0x315c64,ink,0);
      for(const x of [586,728]){this.box(g,x,1260,7,69,0xb38a53);this.box(g,x+2,1263,2,61,0xf5d369,ink,0);}
      this.label(660,1238,'НА КРЫШУ',16,'#6d533e',2);
      for(const p of sinks)this.sink(p.x,p.y);
      stalls.forEach((p,i)=>this.stall(p.x,p.y,i===2));
      const bin=this.add.graphics().setDepth(465);this.box(bin,500,405,60,60,0x485251);this.box(bin,495,401,70,10,0x303b3c);bin.lineStyle(3,0x8d9892).lineBetween(516,415,516,451);
      const radiator=this.add.graphics().setDepth(730);this.box(radiator,95,625,75,105,0xb8c0b8);for(let x=101;x<165;x+=12){this.box(radiator,x,615,8,108,0xe2e0ca,0x687e7d,1);}radiator.lineStyle(5,0x627c78).lineBetween(128,590,128,615);
      const bench=this.add.graphics().setDepth(980);for(const y of [924,942,960])this.box(bench,130,y,200,13,0xaa7451);for(const x of [146,305])this.box(bench,x,975,8,12,0x35434d);
      const vent=this.add.graphics().setDepth(1);this.box(vent,615,-34,90,55,0x647f7c);for(let y=-24;y<15;y+=8)vent.lineStyle(3,0x354e56).lineBetween(624,y,695,y);
      this.label(660,78,'ТУАЛЕТ',26,'#493c35',2);
    }
    sink(x:number,y:number){
      const g=this.add.graphics().setDepth(y+125);
      this.box(g,x+7,y-35,116,150,gold,ink,3);this.box(g,x+13,y-29,104,138,0x89a6aa,ink,1);
      g.lineStyle(3,0xccdfd4).lineBetween(x+27,y+91,x+93,y+6);
      this.box(g,x+51,y+99,28,26,0xd8d9c8,ink,2);this.box(g,x+6,y+78,118,28,0xf0ead3,ink,3);
      g.fillStyle(0xa4b7b3).fillEllipse(x+65,y+88,85,14);g.lineStyle(2,0x516e73).strokeEllipse(x+65,y+88,85,14);
      g.lineStyle(4,0x718b88).strokePoints([{x:x+65,y:y+81},{x:x+65,y:y+65},{x:x+76,y:y+65},{x:x+76,y:y+72}]);
      this.box(g,x-28,y+13,22,43,0xeee5cd,ink,2);g.fillStyle(0x7da9a6).fillEllipse(x-17,y+34,9,14);
      this.box(g,x+132,y+18,31,48,0xd2cbb8,ink,2);this.box(g,x+136,y+59,23,15,0xf8f0d5,ink,1);
    }
    stall(x:number,y:number,open:boolean){
      const g=this.add.graphics().setDepth(y+190).setPosition(x,y).setScale(1,.76);
      x=0;y=0;
      this.box(g,x,y,180,250,0x444b47,ink,4);this.box(g,x+7,y+7,166,236,0xd3d6c3,ink,0);
      if(open){
        this.box(g,x+14,y+16,152,223,0x9aa69d,ink,0);
        this.box(g,x+70,y+125,40,40,0xf0e8ce,ink,3);this.box(g,x+70,y+120,40,6,0xfff2d8);
        this.box(g,x+77,y+189,26,30,0xe2e1c9,ink,2);g.fillStyle(0xf3efd9).fillEllipse(x+90,y+175,64,32);g.lineStyle(3,ink).strokeEllipse(x+90,y+175,64,32);g.fillStyle(0x829d9b).fillEllipse(x+90,y+172,41,17);
        this.box(g,x+20,y+168,17,8,gold,ink,1);g.fillStyle(0xf4edda).fillEllipse(x+28,y+168,22,27);
      }else{
        this.box(g,x+13,y+12,154,221,burgundy,ink,3);this.box(g,x+24,y+22,132,185,0x843d50,ink,1);
        this.box(g,x+29,y+92,32,23,cream,ink,1);
        this.label(g.x+45,g.y+104*.76,'WC',13,'#302b35',g.depth+1);
        g.fillStyle(gold).fillCircle(x+143,y+142,6);g.fillStyle(0x8db191).fillCircle(x+143,y+122,3);
      }
      for(const dx of [0,172])this.box(g,x+dx,y+248,8,12,0x8b9991,ink,1);
    }
  }
  (window as any).__referenceReady=false;
  return new Phaser.Game({type:Phaser.CANVAS,width:size.width,height:size.height,parent:'game',backgroundColor:'#191d35',scene:ReferenceScene,audio:{noAudio:true},banner:false,render:{antialias:true,pixelArt:false}});
}
