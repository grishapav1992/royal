import Phaser from 'phaser';
import { RooftopRenderer } from '../../../src/game/RooftopRenderer';
import { ROOF,ROOF_OBSTACLES } from '../../../src/shared/rooftop';
import { FLOOR,BOUNDS,HALL_WALL } from '../../../src/shared/clubGeometry';
import { findPath,walkable,type Obstacle } from '../../../src/game/navigation';
import { characterTexture,CHARACTER_SCALE } from '../../../src/game/characters';
import { appearanceFromLegacy,serializeAppearance } from '../../../src/shared/appearance';

// Proposal only. This scene never registers a hall or changes the running game.
export const TOILET_ENTRY={x:760,y:410,w:180,h:160,kind:'open-service-window',step:{x:820,y:575,w:60,h:24},approach:{x:850,y:665},trigger:{x:850,y:620}};
export const TOILET_ROOM={width:740,height:610,floor:{...FLOOR,width:630,height:375},bounds:{...BOUNDS,right:670,bottom:530},spawn:{x:150,y:260},exit:{x:150,y:260},window:{x:110,y:46,w:104,h:92},step:{x:120,y:185,w:60,h:35}};
const ink=0x302b35,cream=0xf3dcb1,gold=0xd4ae64,burgundy=0x713046,teal=0x315c64;
const sinks=[{x:100,y:350,w:84,h:80},{x:230,y:350,w:84,h:80}];
const stalls=[355,460,565].map((x,i)=>({x,y:220,w:87,h:94,open:i===2}));
const stallWalls:Obstacle[]=stalls.flatMap(p=>[
  {x:p.x,y:p.y,w:p.w,h:6},
  {x:p.x,y:p.y,w:6,h:p.h},{x:p.x+p.w-6,y:p.y,w:6,h:p.h},
  {x:p.x,y:p.y+p.h-6,w:19,h:6},{x:p.x+p.w-19,y:p.y+p.h-6,w:19,h:6},
  p.open?{x:p.x+7,y:p.y+p.h-36,w:3,h:30}:{x:p.x+19,y:p.y+p.h-5,w:p.w-38,h:4},
  {x:p.x+28,y:p.y+15,w:31,h:52},
]);
const bin={x:590,y:450,w:42,h:48},radiator={x:85,y:465,w:32,h:55};
const roomObstacles:Obstacle[]=[
  {x:0,y:0,w:TOILET_ROOM.width,h:BOUNDS.top-1},{x:0,y:0,w:BOUNDS.left-1,h:TOILET_ROOM.height},
  {x:TOILET_ROOM.bounds.right+1,y:0,w:5000,h:TOILET_ROOM.height},
  {x:0,y:TOILET_ROOM.bounds.bottom+1,w:TOILET_ROOM.width,h:100},...sinks,...stallWalls,
  bin,radiator,TOILET_ROOM.step,
];

export function geometryChecks(){
  const roofObstacles=[...ROOF_OBSTACLES,TOILET_ENTRY,TOILET_ENTRY.step];
  const overlap=[TOILET_ENTRY,TOILET_ENTRY.step].some(p=>ROOF_OBSTACLES.some(o=>p.x<o.x+o.w&&p.x+p.w>o.x&&p.y<o.y+o.h&&p.y+p.h>o.y));
  const roofPath=findPath(ROOF.spawn,TOILET_ENTRY.approach,roofObstacles);
  const perimeter=ROOF.loop.every((p,i)=>findPath(p,ROOF.loop[(i+1)%ROOF.loop.length],roofObstacles).length>0);
  const targets=[...sinks.map(p=>({x:p.x+p.w/2,y:p.y+p.h+50})),...stalls.map(p=>({x:p.x+p.w/2,y:p.y+p.h+50})),...stalls.filter(p=>p.open).map(p=>({x:p.x+p.w/2,y:p.y+p.h-4})),TOILET_ROOM.exit];
  const approaches=targets.map(p=>({point:p,walkable:walkable(p.x,p.y,roomObstacles,16),path:findPath(TOILET_ROOM.spawn,p,roomObstacles).length>0}));
  const roofApproaches=[TOILET_ENTRY.approach,TOILET_ENTRY.trigger].every(p=>walkable(p.x,p.y,roofObstacles,16)&&findPath(ROOF.spawn,p,roofObstacles).length>0);
  if(overlap||!roofPath.length||!roofApproaches||!perimeter||approaches.some(p=>!p.walkable||!p.path))throw Error('Reference geometry has an obstructed approach: '+JSON.stringify({overlap,roofApproaches,perimeter,approaches}));
  return {roof:{width:ROOF.width,height:ROOF.height,deck:ROOF.deck,entry:TOILET_ENTRY,existingPropsUnmoved:true,noOverlap:!overlap,approachReachable:roofApproaches,perimeterReachable:perimeter},room:{...TOILET_ROOM,proposed:true,stalls,stallView:'Top-down floor plan with visible fixtures in every cubicle and thin partition caps',sinks,approaches,obstacles:roomObstacles,floorArea:TOILET_ROOM.floor.width*TOILET_ROOM.floor.height,previousFloorArea:1210*1145},projection:'Same camera fit and upright sprites as RoomScene.resizeView',character:{scale:CHARACTER_SCALE,width:96*CHARACTER_SCALE,height:144*CHARACTER_SCALE}};
}

export function startReference(mode:'roof'|'room',close:boolean){
  const size={width:1120,height:840};
  class ReferenceScene extends Phaser.Scene{
    create(){
      const frame=mode==='roof'?ROOF:TOILET_ROOM;
      if(mode==='roof'){new RooftopRenderer(this,()=>{});this.roofWindow();}else this.restroom();
      const point=mode==='roof'?TOILET_ENTRY.approach:close?{x:425,y:420}:TOILET_ROOM.spawn;
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
    serviceWindow(g:Phaser.GameObjects.Graphics,x:number,y:number){
      this.box(g,x,y,104,92,0xbfc6b8,ink,3);this.box(g,x+7,y+7,90,78,0x242e36,ink,1);
      this.box(g,x+8,y+8,88,34,0x82a2a2,ink,2);
      g.lineStyle(2,0xc0d3ca).lineBetween(x+24,y+30,x+45,y+14);
      this.box(g,x+6,y+40,92,7,0xb3bdac,ink,2);this.box(g,x+45,y+41,14,3,0x6e7b74,ink,0);
      for(const dx of [4,98])g.lineStyle(2,0x697d78).lineBetween(x+dx,y+46,x+dx,y+86);
      this.box(g,x-8,y+89,120,9,cream,ink,2);
      g.lineStyle(2,0xa89d86).lineBetween(x+20,y+94,x+33,y+94).lineBetween(x+71,y+92,x+84,y+92);
    }
    roofWindow(){
      const p=TOILET_ENTRY,g=this.add.graphics().setDepth(p.y+p.h);
      this.box(g,p.x,p.y,p.w,p.h,0x684550,ink,3);this.box(g,p.x,p.y,p.w,14,0xb2b9ac,ink,2);
      this.serviceWindow(g,p.x+38,p.y+28);
      g.lineStyle(2,0x543b46).lineBetween(p.x+19,p.y+135,p.x+40,p.y+135).lineBetween(p.x+146,p.y+56,p.x+159,p.y+68);
      g.fillStyle(0xf4f8fc).fillEllipse(p.x+48,p.y+1,88,10).fillEllipse(p.x+131,p.y+2,92,9);
      const step=this.add.graphics().setDepth(p.step.y+p.step.h);
      this.box(step,p.step.x,p.step.y,p.step.w,p.step.h,0x8d826b,ink,2);
      this.box(step,p.step.x-3,p.step.y,66,5,0xb1a38b,ink,1);
      for(const x of [p.step.x+8,p.step.x+48])this.box(step,x,p.step.y+6,4,16,0x6c675a,ink,0);
      step.lineStyle(2,0xd1c2a1).lineBetween(p.step.x+17,p.step.y+18,p.step.x+42,p.step.y+18);
    }
    restroom(){
      const {floor,width,height}=TOILET_ROOM,g=this.add.graphics().setDepth(0),right=floor.x+floor.width,bottom=floor.y+floor.height;
      this.box(g,0,HALL_WALL.viewTop,width,height-HALL_WALL.viewTop,0x191d35,ink,0);
      this.box(g,floor.x,HALL_WALL.top,floor.width,HALL_WALL.height,0xead9b4,ink,0);
      for(let y=HALL_WALL.top;y<floor.y;y+=55)for(let x=floor.x;x<right;x+=72)this.box(g,x,y,Math.min(72,right-x),55,0xeadfc8,0xcabda3,1);
      this.box(g,floor.x,110,floor.width,65,0x4f7974,ink,0);g.lineStyle(4,gold).lineBetween(floor.x,110,right,110);
      this.box(g,floor.x,floor.y,floor.width,floor.height,0xc4c5bd,ink,0);
      for(let y=floor.y;y<bottom;y+=72)for(let x=floor.x;x<right;x+=72){this.box(g,x,y,Math.min(72,right-x),Math.min(72,bottom-y),((Math.round((x-floor.x)/72)+Math.round((y-floor.y)/72))%2)?0xd4d1c2:0xbec4bf,0x9ea8a5,1);}
      for(const x of [40,right+2]){this.box(g,x,HALL_WALL.top,14,bottom-HALL_WALL.top,0x3c1829,ink,0);this.box(g,x+9,HALL_WALL.top,3,bottom-HALL_WALL.top,gold,ink,0);}
      this.box(g,40,bottom,right-24,17,0x271921,ink,0);this.box(g,40,bottom,right-24,3,gold,ink,0);
      const window=this.add.graphics().setDepth(1);this.serviceWindow(window,TOILET_ROOM.window.x,TOILET_ROOM.window.y);
      const step=this.add.graphics().setDepth(TOILET_ROOM.step.y+TOILET_ROOM.step.h);
      this.box(step,120,185,60,10,0xb4a18a);for(const x of [124,168])this.box(step,x,195,8,25,0x7e7768);
      for(const p of sinks)this.sink(p.x,p.y);
      stalls.forEach(p=>this.stall(p));
      const trash=this.add.graphics().setDepth(bin.y+bin.h);this.box(trash,bin.x,bin.y,bin.w,bin.h,0x485251);this.box(trash,bin.x-3,bin.y-3,bin.w+6,7,0x303b3c);trash.lineStyle(2,0x8d9892).lineBetween(bin.x+12,bin.y+10,bin.x+12,bin.y+37);
      const heat=this.add.graphics().setDepth(radiator.y+radiator.h);this.box(heat,radiator.x,radiator.y+6,radiator.w,radiator.h-6,0xb8c0b8);for(let x=radiator.x+4;x<radiator.x+radiator.w-3;x+=9)this.box(heat,x,radiator.y,6,radiator.h-5,0xe2e0ca,0x687e7d,1);heat.lineStyle(3,0x627c78).lineBetween(105,450,105,465);
      const vent=this.add.graphics().setDepth(1);this.box(vent,590,-20,66,40,0x647f7c);for(let y=-13;y<16;y+=6)vent.lineStyle(2,0x354e56).lineBetween(596,y,650,y);
      this.label(width/2,78,'ТУАЛЕТ',21,'#493c35',2);
    }
    sink(x:number,y:number){
      const g=this.add.graphics().setDepth(y+80).setPosition(x,y).setScale(.64);
      x=0;y=0;
      this.box(g,x+7,y-35,116,150,gold,ink,3);this.box(g,x+13,y-29,104,138,0x89a6aa,ink,1);
      g.lineStyle(3,0xccdfd4).lineBetween(x+27,y+91,x+93,y+6);
      this.box(g,x+51,y+99,28,26,0xd8d9c8,ink,2);this.box(g,x+6,y+78,118,28,0xf0ead3,ink,3);
      g.fillStyle(0xa4b7b3).fillEllipse(x+65,y+88,85,14);g.lineStyle(2,0x516e73).strokeEllipse(x+65,y+88,85,14);
      g.lineStyle(4,0x718b88).strokePoints([{x:x+65,y:y+81},{x:x+65,y:y+65},{x:x+76,y:y+65},{x:x+76,y:y+72}]);
      this.box(g,x-28,y+13,22,43,0xeee5cd,ink,2);g.fillStyle(0x7da9a6).fillEllipse(x-17,y+34,9,14);
      this.box(g,x+132,y+18,31,48,0xd2cbb8,ink,2);this.box(g,x+136,y+59,23,15,0xf8f0d5,ink,1);
    }
    stall(p:typeof stalls[number]){
      const {x,y,w,h,open}=p,g=this.add.graphics().setDepth(y+h);
      // Cutaway floor plan: the near door never covers the contents from above.
      this.box(g,x+6,y+6,w-12,h-12,0xd5d3c4,ink,0);
      for(let dy=6;dy<h-6;dy+=22)for(let dx=6;dx<w-6;dx+=25){
        this.box(g,x+dx,y+dy,Math.min(25,w-6-dx),Math.min(22,h-6-dy),((Math.floor(dx/25)+Math.floor(dy/22))%2)?0xc2ccc3:0xd5d3c4,0xadb9af,.7);
      }
      this.box(g,x+28,y+15,31,14,0xf3eed9,ink,1.5);this.box(g,x+29,y+15,29,4,0xfff6df,ink,1);
      this.box(g,x+48,y+21,5,2,0x7d9391,ink,0);
      g.fillStyle(0xe6e5d1).fillEllipse(x+43.5,y+50,31,36);
      g.lineStyle(1.5,ink).strokeEllipse(x+43.5,y+50,31,36);
      g.fillStyle(0x809f9d).fillEllipse(x+43.5,y+49,19,24);
      g.lineStyle(3,0xf7f1dc).strokeEllipse(x+43.5,y+49,24,29);
      g.lineStyle(1,0xc4d5ca).lineBetween(x+39,y+49,x+46,y+49);
      this.box(g,x+76,y+43,4,15,0x697e77,ink,1);
      this.box(g,x+70,y+44,8,13,0xf3edda,ink,1);g.lineStyle(1,0x9c9d90).lineBetween(x+71,y+47,x+77,y+47);
      this.box(g,x+72,y+56,6,6,0xfff6e2,ink,.7);
      g.fillStyle(0x617a70).fillEllipse(x+15,y+60,10,12);g.lineStyle(1,ink).strokeEllipse(x+15,y+60,10,12);
      for(const [dx,dy,dw,dh]of [[0,0,w,6],[0,0,6,h],[w-6,0,6,h],[0,h-6,19,6],[w-19,h-6,19,6]]){
        this.box(g,x+dx,y+dy,dw,dh,0x7b9388,ink,1.5);
      }
      if(open){
        this.box(g,x+7,y+h-36,3,30,burgundy,ink,1);
        g.fillStyle(gold).fillCircle(x+11,y+h-31,1.5);
      }else{
        this.box(g,x+19,y+h-5,w-38,4,burgundy,ink,1);
        this.box(g,x+w-27,y+h-5,5,2,gold,ink,0);
        g.fillStyle(0x8db191).fillCircle(x+w-16,y+h-3,1.5);
      }
    }
  }
  (window as any).__referenceReady=false;
  return new Phaser.Game({type:Phaser.CANVAS,width:size.width,height:size.height,parent:'game',backgroundColor:'#191d35',scene:ReferenceScene,audio:{noAudio:true},banner:false,render:{antialias:true,pixelArt:false}});
}
