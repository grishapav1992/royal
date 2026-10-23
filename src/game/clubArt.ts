import { t as translateText } from '../i18n/index';
import Phaser from 'phaser';
import { CLUB_ZONES, LOUNGES, LUELON_NEW_ZONE, clubPlants, clubColumns } from '../shared/clubLayout';
import { SEATS, type HallId } from '../shared/world';
import { WORLD, FLOOR } from '../shared/clubGeometry';
import { CAT_HOME } from '../shared/catHome';
import { drawCatHome } from './catHomeArt';
import { HALL_WINDOWS, HALL_WINDOW_XS } from './hallWindows';
import { ARCADE_HOUSE_GAMES, ARCADE_CABINET_POSITIONS } from '../shared/arcadeCatalog';

export function drawClubFloor(scene: Phaser.Scene, hall: HallId, onSeat: (id:string)=>void, onNewZone?:()=>void) {
  const g=scene.make.graphics({x:0,y:0},false);
  g.translateCanvas(-FLOOR.x,-FLOOR.y);
  for(const zone of CLUB_ZONES[hall]) {
    g.fillStyle(0x151c27,.3).fillRoundedRect(zone.x-4,zone.y-4,zone.w+8,zone.h+8,26);
    g.fillStyle(zone.color,.85).fillRoundedRect(zone.x,zone.y,zone.w,zone.h,22);
    g.lineStyle(2,0xb59a68,.65).strokeRoundedRect(zone.x+9,zone.y+9,zone.w-18,zone.h-18,18);
    scene.add.text(zone.x+zone.w/2,hall==='arcade'?zone.y+23:zone.y+zone.h-30,zone.name,{fontFamily:'Arial',fontSize:'14px',fontStyle:'bold',letterSpacing:hall==='arcade'?1:2,color:'#d9c394'}).setOrigin(.5).setDepth(.04);
  }
  // Wide circulation routes connect distinct destinations rather than a wall of cabinets.
  if(hall!=='arcade')g.lineStyle(2,0xd0b988,.3).lineBetween(130,700,WORLD.width-140,700);
  if(hall==='arcade') drawLuelonWing(scene,onNewZone);
  for(const x of clubColumns(hall)) {
    g.fillStyle(0x775d48).fillRoundedRect(x-19,670,38,63,4);
    g.fillStyle(0xd7b785).fillRect(x-22,670,44,7);
    g.lineStyle(1,0xad9069).lineBetween(x-10,682,x-10,725);
  }
  const crest=hall==='arcade'?{x:1000,y:1030}:{x:890,y:840};
  g.lineStyle(3,0xc2a06a,.8).strokeCircle(crest.x,crest.y,hall==='arcade'?65:77);
  g.lineStyle(1,0xc2a06a,.6).strokeCircle(crest.x,crest.y,hall==='arcade'?55:65);
  // The floor image already owns this layer, so bake its fixed decoration once.
  const floor=scene.textures.get('club-floor-'+hall) as Phaser.Textures.CanvasTexture;
  g.setScale(floor.width/FLOOR.width,floor.height/FLOOR.height);
  g.generateTexture(floor.canvas,floor.width,floor.height);
  Phaser.GameObjects.Graphics.TargetCamera.renderList.length=0;
  floor.refresh();
  g.destroy();
  scene.add.text(crest.x,crest.y-15,'R',{fontFamily:'Georgia',fontSize:'52px',color:'#d2b67b'}).setOrigin(.5).setDepth(.04);
  scene.add.text(crest.x,crest.y+34,'ROYAL CLUB',{fontFamily:'Arial',fontSize:'11px',letterSpacing:3,color:'#c2aa7b'}).setOrigin(.5).setDepth(.04);
  for(const lounge of LOUNGES.filter(l=>l.hall===hall)) {
    scene.add.image(lounge.x,lounge.y,'sofa').setOrigin(.5,1).setDisplaySize(198,98).setDepth(lounge.y-20);
    scene.add.image(lounge.x,lounge.y+118,'table').setOrigin(.5,1).setDisplaySize(104,62).setDepth(lounge.y+114);
    const lamp=scene.make.graphics({x:0,y:0},false);
    lamp.fillStyle(0x332d33).fillEllipse(0,0,34,10).fillRect(-3,-81,6,78);
    lamp.fillStyle(0xe5c594).fillTriangle(-22,-60,0,-96,22,-60);
    decoration(scene,lamp,'lamp',-24,-98,48,104,lounge.x-135,lounge.y-20,lounge.y-21);
    const light=scene.add.ellipse(lounge.x-135,lounge.y-42,165,120,0xf4df9c,.04).setDepth(.035);
    void light;
  }
  for(const plant of clubPlants(hall)) {
    const p=scene.make.graphics({x:0,y:0},false);
    p.fillStyle(0x443a32).fillRoundedRect(-18,-26,36,26,4);
    p.fillStyle(0x729777).fillEllipse(-13,-47,28,22).fillEllipse(9,-61,27,27).fillEllipse(13,-36,31,23);
    p.fillStyle(0x456e57).fillEllipse(-8,-66,26,25).fillEllipse(-18,-30,23,20);
    p.lineStyle(2,0xb29463).lineBetween(-18,-21,18,-21);
    decoration(scene,p,'plant',-34,-82,68,86,plant.x,plant.y,plant.y);
  }
  for(const seat of SEATS.filter(s=>s.kind==='sofa'&&(s.hall??'arcade')===hall)) {
    scene.add.zone(seat.x,seat.y-28,64,64).setDepth(seat.y+2).setInteractive({useHandCursor:true}).on('pointerdown',()=>onSeat(seat.id));
  }
  // A quiet row of windows runs around the far side of the enlarged club.
  for(const x of HALL_WINDOW_XS) {
    if (hall === CAT_HOME.hall && x === CAT_HOME.window.x) { drawCatHome(scene); continue; }
    scene.add.image(x,HALL_WINDOWS.top,hall==='arcade'?'window-city':'window-garden').setOrigin(.5,0).setDisplaySize(HALL_WINDOWS.width,HALL_WINDOWS.height).setDepth(2).setName('hall-window-'+hall+'-'+x);
  }
  scene.add.text(WORLD.width-170,1280,hall==='arcade'?translateText('КАЗИНО И БАР · ЭТАЖ 1'):hall==='tables'?translateText('БАЛКОН · ЭТАЖ 2'):translateText('КАРТОЧНЫЙ САЛОН · ЭТАЖ 3'),{fontFamily:'Arial',fontSize:'13px',color:'#b4a58e',letterSpacing:2}).setOrigin(1,.5).setDepth(.04);
  const rail=scene.make.graphics({x:0,y:0},false);
  rail.lineStyle(4,0x977b50).lineBetween(1230,FLOOR.y+FLOOR.height-8,FLOOR.x+FLOOR.width-55,FLOOR.y+FLOOR.height-8);
  for(let x=1240;x<FLOOR.x+FLOOR.width-55;x+=42)rail.lineStyle(2,0xbea171).lineBetween(x,1300,x,1320);
  decoration(scene,rail,'rail',1227,1297,FLOOR.x+FLOOR.width-55-1227+3,26,0,0,3);
}

function drawLuelonWing(scene:Phaser.Scene,onVisit?:()=>void){
  const zone=LUELON_NEW_ZONE,art=scene.make.graphics({x:0,y:0},false);
  for(const id of ARCADE_HOUSE_GAMES){
    const position=ARCADE_CABINET_POSITIONS[id];
    art.fillStyle(0x71d9e4,.08).fillEllipse(position.x,position.y+18,128,48);
    art.lineStyle(1,0x8ee7e8,.4).strokeEllipse(position.x,position.y+18,118,42);
  }
  decoration(scene,art,'luelon-floor',zone.x,zone.y,zone.w,zone.h,0,0,.045);
  if(onVisit)scene.add.zone(zone.entrance.x,zone.entrance.y,48,90).setDepth(4).setInteractive({useHandCursor:true}).on('pointerdown',onVisit);
}

function decoration(scene:Phaser.Scene,g:Phaser.GameObjects.Graphics,id:string,x:number,y:number,width:number,height:number,worldX:number,worldY:number,depth:number){
  const key=scene.sys.settings.key+'-club-decoration-'+id;
  if(!scene.textures.exists(key)){
    const density=Math.min(Math.max(width,height)>512?1:2,4096/width,4096/height),w=Math.floor(width*density),h=Math.floor(height*density);
    const texture=scene.textures.createCanvas(key,w,h)!;
    // Ignore camera scroll while cropping the original local drawing into its image.
    g.setScrollFactor(0).setPosition(-x*w/width,-y*h/height).setScale(w/width,h/height);
    g.generateTexture(texture.canvas,w,h);
    Phaser.GameObjects.Graphics.TargetCamera.renderList.length=0;texture.refresh();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>scene.textures.remove(key));
  }
  g.destroy();
  return scene.add.image(worldX+x,worldY+y,key).setOrigin(0).setDisplaySize(width,height).setDepth(depth).setName(key);
}
