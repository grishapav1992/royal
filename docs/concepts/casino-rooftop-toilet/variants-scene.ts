import Phaser from 'phaser';
import { CHARACTER_SCALE,characterTexture } from '../../../src/game/characters';
import { appearanceFromLegacy,serializeAppearance } from '../../../src/shared/appearance';
import { findPath,walkable,type Obstacle,type Point } from '../../../src/game/navigation';

type Facing='south'|'north'|'west';
type Cubicle={x:number;y:number;facing:Facing;open:boolean};
type Rect={x:number;y:number;w:number;h:number};
type Variant={id:string;title:string;description:string;floor:Rect;outline:Point[];windowX:number;spawn:Point;player:Point;counter:Rect;cubicles:Cubicle[];cabinet?:Rect;bin:Rect;radiator:Rect;colors:{floor:number[];wall:number;band:number;partition:number;counter:number}};
const ink=0x302f35,cream=0xf2ead3,gold=0xc9aa70;
const cell={w:100,h:140,wall:8,door:64,toilet:{x:33,y:18,w:34,h:58}};
const size={width:1120,height:840},zoom=1.08;
const row=(xs:number[],y:number,facing:Facing):Cubicle[]=>xs.map((x,i)=>({x,y,facing,open:i===xs.length-1}));

// Alternatives only: no live hall, movement, server transition or catalogue entry.
export const TOILET_VARIANTS:Variant[]=[
  {id:'01-rectangle',title:'Компактный прямоугольник',description:'Три кабинки у задней стены, две раковины на общей столешнице, прямой проход.',floor:{x:80,y:240,w:640,h:300},outline:[{x:80,y:240},{x:720,y:240},{x:720,y:540},{x:80,y:540}],windowX:104,spawn:{x:156,y:300},player:{x:400,y:470},counter:{x:235,y:248,w:174,h:44},cubicles:row([436,528,620],248,'south'),bin:{x:96,y:450,w:25,h:28},radiator:{x:89,y:345,w:18,h:64},colors:{floor:[0xd8d7c8,0xbecac1],wall:0xe8dfc9,band:0x54776e,partition:0x81958a,counter:0xa7ada0}},
  {id:'02-l-shape',title:'Г-образный с двумя кабинками',description:'Кабинки в коротком нижнем крыле, раковины у задней стены, хозяйственная ниша справа.',floor:{x:80,y:240,w:520,h:380},outline:[{x:80,y:240},{x:600,y:240},{x:600,y:520},{x:320,y:520},{x:320,y:620},{x:80,y:620}],windowX:104,spawn:{x:156,y:300},player:{x:395,y:415},counter:{x:250,y:248,w:220,h:44},cubicles:row([80,172],480,'north'),cabinet:{x:490,y:460,w:80,h:40},bin:{x:560,y:350,w:25,h:28},radiator:{x:89,y:360,w:18,h:64},colors:{floor:[0xe0d8c5,0xc6c6b8],wall:0xeee3cf,band:0x744251,partition:0x8d837d,counter:0xab9c88}},
  {id:'03-service-corridor',title:'Узкий служебный',description:'Три кабинки вдоль правой стены, вход в них из одного продольного прохода.',floor:{x:80,y:240,w:400,h:480},outline:[{x:80,y:240},{x:480,y:240},{x:480,y:720},{x:80,y:720}],windowX:340,spawn:{x:392,y:296},player:{x:220,y:510},counter:{x:100,y:248,w:174,h:44},cubicles:[330,422,514].map((y,i)=>({x:340,y,facing:'west',open:i===2})),cabinet:{x:90,y:650,w:95,h:45},bin:{x:95,y:420,w:25,h:28},radiator:{x:89,y:550,w:18,h:64},colors:{floor:[0xd1d6ce,0xb6c3bc],wall:0xe0e4d6,band:0x4b6970,partition:0x71898a,counter:0x939e98}},
];

function localPoint(p:Cubicle,u:number,v:number):Point{
  if(p.facing==='north')return {x:p.x+cell.w-u,y:p.y+cell.h-v};
  if(p.facing==='west')return {x:p.x+cell.h-v,y:p.y+u};
  return {x:p.x+u,y:p.y+v};
}
function localRect(p:Cubicle,r:Rect):Rect{
  const points=[localPoint(p,r.x,r.y),localPoint(p,r.x+r.w,r.y),localPoint(p,r.x,r.y+r.h),localPoint(p,r.x+r.w,r.y+r.h)];
  const x=Math.min(...points.map(v=>v.x)),y=Math.min(...points.map(v=>v.y));
  return {x,y,w:Math.max(...points.map(v=>v.x))-x,h:Math.max(...points.map(v=>v.y))-y};
}
function fixtureRects(p:Cubicle):Rect[]{
  return [
    {x:0,y:0,w:cell.w,h:8},{x:0,y:0,w:8,h:cell.h},{x:cell.w-8,y:0,w:8,h:cell.h},
    {x:0,y:cell.h-8,w:18,h:8},{x:cell.w-18,y:cell.h-8,w:18,h:8},
    p.open?{x:9,y:cell.h-46,w:4,h:38}:{x:18,y:cell.h-6,w:cell.door,h:4},cell.toilet,
  ];
}
function outlineEdges(v:Variant):Rect[]{
  return v.outline.map((a,i)=>{
    const b=v.outline[(i+1)%v.outline.length];
    return {x:Math.min(a.x,b.x)-4,y:Math.min(a.y,b.y)-4,w:Math.max(8,Math.abs(b.x-a.x)+8),h:Math.max(8,Math.abs(b.y-a.y)+8)};
  });
}
function obstacles(v:Variant):Obstacle[]{
  const {floor:f}=v;
  const outside:Obstacle[]=[{x:0,y:0,w:5000,h:f.y+4},{x:0,y:0,w:f.x+4,h:1300},{x:f.x+f.w-4,y:0,w:5000,h:1300},{x:0,y:f.y+f.h-4,w:5000,h:1300}];
  if(v.id==='02-l-shape')outside.push({x:316,y:516,w:5000,h:1300});
  return [...outside,...outlineEdges(v),v.counter,v.bin,v.radiator,...(v.cabinet?[v.cabinet]:[]),{x:v.windowX+26,y:244,w:55,h:18},...v.cubicles.flatMap(p=>fixtureRects(p).map(r=>localRect(p,r)))];
}
function sinkPoints(v:Variant){return [0,1].map(i=>({x:v.counter.x+v.counter.w*(i+.5)/2,y:v.counter.y+v.counter.h+42}));}

export function variantChecks(){
  return TOILET_VARIANTS.map(v=>{
    const blocked=obstacles(v),targets=[v.spawn,v.player,...sinkPoints(v),...v.cubicles.map(p=>localPoint(p,50,182)),...v.cubicles.filter(p=>p.open).map(p=>localPoint(p,50,134))];
    const approaches=targets.map(point=>({point,walkable:walkable(point.x,point.y,blocked,16),path:findPath(v.spawn,point,blocked).length>0}));
    if(approaches.some(p=>!p.walkable||!p.path))throw Error('Blocked variant '+v.id+': '+JSON.stringify(approaches));
    return {id:v.id,title:v.title,description:v.description,referenceOnly:true,floor:v.floor,outline:v.outline,windowX:v.windowX,counter:v.counter,cubicles:v.cubicles,cubicleSize:cell,characterScale:CHARACTER_SCALE,cameraZoom:zoom,doorClearance:cell.door,approaches,obstacles:blocked,contentsVisibleInAllCubicles:true};
  });
}

export function startVariant(id:string){
  const v=TOILET_VARIANTS.find(p=>p.id===id);if(!v)throw Error('Unknown toilet reference '+id);
  class VariantScene extends Phaser.Scene{
    box(g:Phaser.GameObjects.Graphics,x:number,y:number,w:number,h:number,color:number,line=1.5,edge=ink){g.fillStyle(color).fillRect(x,y,w,h);if(line)g.lineStyle(line,edge).strokeRect(x,y,w,h);}
    create(){
      this.room(v!);this.vanity(v!);v!.cubicles.forEach(p=>this.cubicle(p,v!));this.details(v!);
      const point=v!.player;
      this.add.ellipse(point.x,point.y-1,29,10,0x27202c,.16).setDepth(899);
      this.add.sprite(point.x,point.y,characterTexture(this,0,serializeAppearance(appearanceFromLegacy(0))),'down-6').setOrigin(.5,1).setScale(CHARACTER_SCALE).setDepth(900);
      this.cameras.main.setZoom(zoom).centerOn(v!.floor.x+v!.floor.w/2,(120+v!.floor.y+v!.floor.h)/2);
      this.game.events.once('postrender',()=>{(window as any).__referenceReady=true;});
    }
    room(v:Variant){
      const g=this.add.graphics().setDepth(0),f=v.floor;
      // One orthogonal floor plane; wall faces sit outside it, partition caps inside.
      const polygon=new Phaser.Geom.Polygon(v.outline);
      for(let y=f.y;y<f.y+f.h;y+=40)for(let x=f.x;x<f.x+f.w;x+=40){
        const w=Math.min(40,f.x+f.w-x),h=Math.min(40,f.y+f.h-y);
        if(Phaser.Geom.Polygon.Contains(polygon,x+w/2,y+h/2))this.box(g,x,y,w,h,v.colors.floor[((x-f.x)/40+(y-f.y)/40)%2===0?0:1],.8,0x9da99e);
      }
      this.box(g,f.x,120,f.w,120,v.colors.wall,0);
      for(let y=120;y<240;y+=30)for(let x=f.x;x<f.x+f.w;x+=40)this.box(g,x,y,Math.min(40,f.x+f.w-x),30,v.colors.wall,.7,0xc4c6b7);
      this.box(g,f.x,213,f.w,27,v.colors.band,0);this.box(g,f.x,210,f.w,3,gold,0);
      this.box(g,f.x-4,116,f.w+8,8,0xb6bcae,2);
      for(const edge of outlineEdges(v))this.box(g,edge.x,edge.y,edge.w,edge.h,v.colors.partition,1.5);
      this.window(v.windowX);
    }
    window(x:number){
      const g=this.add.graphics().setDepth(8),y=145;
      this.box(g,x,y,104,92,0xc1c9ba,2.5);this.box(g,x+7,y+7,90,78,0x273139,1);
      this.box(g,x+8,y+8,88,34,0x87a5a3,2);g.lineStyle(2,0xc5d7cd).lineBetween(x+24,y+30,x+45,y+14);
      this.box(g,x+6,y+40,92,7,0xb3bdac,2);this.box(g,x+45,y+41,14,3,0x6e7b74,0);
      this.box(g,x-8,y+89,120,8,cream,1.5);g.lineStyle(1.5,0xa89d86).lineBetween(x+20,y+94,x+33,y+94);
      this.box(g,x+26,244,55,18,0x9b8d76,1.5);this.box(g,x+24,244,59,5,0xc3b49a,1);
    }
    vanity(v:Variant){
      const p=v.counter,g=this.add.graphics().setDepth(10),cellWidth=p.w/2;
      this.box(g,p.x,p.y,p.w,p.h,v.colors.counter,2);
      this.box(g,p.x,p.y+p.h-5,p.w,5,0x747e75,1);
      for(let i=0;i<2;i++){
        const cx=p.x+(i+.5)*cellWidth;
        // Mirror on the back wall, basin in the horizontal counter directly below it.
        this.box(g,cx-31,152,62,75,gold,2);this.box(g,cx-27,156,54,67,0x8eaaa8,1);
        g.lineStyle(2,0xd0ded3).lineBetween(cx-18,204,cx+14,165);
        g.fillStyle(cream).fillEllipse(cx,p.y+23,55,29);g.lineStyle(1.5,ink).strokeEllipse(cx,p.y+23,55,29);
        g.fillStyle(0x9cb5ae).fillEllipse(cx,p.y+23,39,17);g.fillStyle(0x536f70).fillCircle(cx,p.y+23,2);
        this.box(g,cx-3,p.y+6,6,8,0xb9c8bf,1);g.lineStyle(3,0x526d71).lineBetween(cx,p.y+8,cx,p.y+16);
        this.box(g,cx+32,p.y+12,8,15,0xe4dfcb,1);this.box(g,cx+34,p.y+9,5,3,0x6e8982,0);
      }
      this.box(g,p.x+p.w+6,180,19,31,0xc7c7b6,1);this.box(g,p.x+p.w+9,205,13,12,cream,1);
    }
    cubicle(p:Cubicle,v:Variant){
      const g=this.add.graphics().setDepth(12);
      if(p.facing==='north')g.setPosition(p.x+cell.w,p.y+cell.h).setRotation(Math.PI);
      else if(p.facing==='west')g.setPosition(p.x+cell.h,p.y).setRotation(Math.PI/2);
      else g.setPosition(p.x,p.y);
      this.box(g,8,8,84,124,v.colors.floor[0],0);
      for(let y=8;y<132;y+=40)for(let x=8;x<92;x+=40)this.box(g,x,y,Math.min(40,92-x),Math.min(40,132-y),v.colors.floor[(Math.floor(x/40)+Math.floor(y/40))%2],.7,0x9da99e);
      this.box(g,33,18,34,16,cream,1.5);this.box(g,34,18,32,4,0xfff6df,1);this.box(g,55,25,5,2,0x7d9391,0);
      g.fillStyle(0xe6e5d1).fillEllipse(50,55,34,42);g.lineStyle(1.5,ink).strokeEllipse(50,55,34,42);
      g.fillStyle(0x8ba7a2).fillEllipse(50,54,21,28);g.lineStyle(3,0xf7f1dc).strokeEllipse(50,54,26,34);
      this.box(g,88,49,4,18,0x657b75,1);this.box(g,80,50,10,16,cream,1);this.box(g,82,65,7,9,0xfff6df,1);g.lineStyle(1,0xaaa89a).lineBetween(81,54,89,54);
      g.fillStyle(0x657e73).fillEllipse(20,74,12,14);g.lineStyle(1,ink).strokeEllipse(20,74,12,14);
      for(const r of fixtureRects(p).slice(0,5))this.box(g,r.x,r.y,r.w,r.h,v.colors.partition,1.5);
      if(p.open){this.box(g,9,94,4,38,0x713c4c,1);this.box(g,13,99,3,2,gold,0);}
      else{this.box(g,18,134,64,4,0x713c4c,1);this.box(g,71,134,6,2,gold,0);g.fillStyle(0xa7bc90).fillCircle(88,136,1.8);}
    }
    details(v:Variant){
      const g=this.add.graphics().setDepth(14),r=v.radiator,b=v.bin;
      this.box(g,r.x,r.y,r.w,r.h,0x788d81,1);for(let y=r.y+4;y<r.y+r.h-3;y+=8)this.box(g,r.x+2,y,r.w-4,4,0xd6d8c4,1);
      this.box(g,b.x,b.y,b.w,b.h,0x536a60,1.5);this.box(g,b.x-2,b.y-2,b.w+4,6,0x344d45,1);g.lineStyle(1.5,0x91a394).lineBetween(b.x+7,b.y+9,b.x+7,b.y+b.h-5);
      if(v.cabinet){const c=v.cabinet;this.box(g,c.x,c.y,c.w,c.h,0x798b7f,2);this.box(g,c.x+5,c.y+5,c.w-10,c.h-10,0xa0aa97,1);this.box(g,c.x+c.w/2-7,c.y+c.h-10,14,3,gold,0);}
      const drainX=v.id==='03-service-corridor'?225:v.id==='02-l-shape'?400:320,drainY=v.id==='03-service-corridor'?650:v.id==='02-l-shape'?470:486;
      this.box(g,drainX,drainY,38,15,0x8b9b91,1);for(let x=drainX+5;x<drainX+35;x+=6)g.lineStyle(1.5,0x4b6260).lineBetween(x,drainY+3,x,drainY+12);
    }
  }
  (window as any).__referenceReady=false;
  return new Phaser.Game({type:Phaser.CANVAS,width:size.width,height:size.height,parent:'game',backgroundColor:'#202536',scene:VariantScene,audio:{noAudio:true},banner:false,render:{antialias:true,pixelArt:false}});
}
