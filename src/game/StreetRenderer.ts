import Phaser from 'phaser';
import { STREET } from '../shared/street';
import { createStreetArt, STREET_ART, STREET_SIGN } from './streetArt';
import { StreetAmbience } from './StreetAmbience';
import type { Point } from './navigation';
import { STREET_SERVICE_PROPS, type StreetResidentId } from './streetDetails';
import { StreetView, type StreetSide } from './streetView';
import { createStreetWall } from './streetWalls';
import { StreetRoofStairs } from './RooftopRenderer';
import { StreetResidents } from './StreetResidents';

/** Reusable facade sections keep the close view independent of total floor count. */
export class StreetRenderer {
  private facade: Phaser.GameObjects.Container;
  private plan: Phaser.GameObjects.Image;
  private walls=new Map<StreetSide,Phaser.GameObjects.Container>();
  private anchors:{image:Phaser.GameObjects.Image;point:Point}[]=[];
  private door:Phaser.GameObjects.Zone;
  private ground: Phaser.GameObjects.Container;
  private props: Phaser.GameObjects.Image[]=[];
  private ambience: StreetAmbience;
  private sheen: Phaser.GameObjects.Image[]=[];
  private sparkle: Phaser.GameObjects.Graphics;
  private residents:StreetResidents;
  private roofStairs:StreetRoofStairs;
  readonly mapCanvas: HTMLCanvasElement;
  constructor(scene: Phaser.Scene, enter: () => void,approach:(id:StreetResidentId)=>void,climb:()=>void,readonly view:StreetView) {
    this.mapCanvas=createStreetArt(scene);
    const b=STREET.building,front=b.y+b.h;
    const base=scene.add.graphics();
    base.fillStyle(0xe6edf2).fillRect(0,-200,STREET.width,STREET.height+200);
    base.fillStyle(0x303d50).fillRect(0,1210,STREET.width,170);
    base.fillStyle(0xf6cf58);
    for(let x=25;x<STREET.width;x+=140)base.fillRect(x,1295,68,6);
    const paving=scene.add.tileSprite(320,240,2180,960,STREET_ART.paving).setOrigin(0).setTileScale(.5);
    const edges=scene.add.graphics();
    edges.lineStyle(3,0xa7afbc).strokeRect(320,240,2180,960);
    edges.fillStyle(0xf8fbff).fillRect(0,1198,STREET.width,12);
    // Snow stays at the edges of the same unobstructed circulation lane.
    for(const [x,y,w] of [[270,265,90],[2515,520,95],[300,955,78],[2550,1140,120],[680,225,130],[1980,225,115],[100,1185,145],[2610,1185,130]]){
      edges.fillStyle(0xf8fbff).fillEllipse(x,y,w,25).fillEllipse(x-w*.2,y-9,w*.45,28).fillEllipse(x+w*.2,y-5,w*.4,23);
    }
    const details=scene.add.graphics();
    details.fillStyle(0xacb5bf).fillRect(2498,988,169,198);
    details.lineStyle(3,0xe9cf78).strokePoints([{x:2503,y:997},{x:2503,y:1182},{x:2662,y:1182},{x:2662,y:997}]);
    for(const [x,y] of [[675,1176],[2060,1176],[1000,304],[1650,304]]){
      details.fillStyle(0x6d7981).fillRoundedRect(x,y,53,13,2);
      for(let dx=5;dx<50;dx+=7)details.lineStyle(2,0x394953).lineBetween(x+dx,y+3,x+dx,y+10);
    }
    for(const [x,y] of [[1060,306],[1540,438],[2260,1123],[418,725]]){
      details.lineStyle(1,0x959eab,.7).strokePoints([{x,y},{x:x+17,y:y+8},{x:x+12,y:y+14},{x:x+28,y:y+18}]);
    }
    for(const [x,y] of [[1080,290],[1560,290],[2040,286]]){
      details.lineStyle(2,0xd2bf88,.8).strokeRect(x,y,90,36);
      for(let dx=6;dx<86;dx+=17)details.lineBetween(x+dx,y+29,x+dx+14,y+7);
    }
    const carpet=scene.add.image(STREET.entrance.x-120,928,STREET_ART.carpet).setOrigin(0).setDisplaySize(240,120);
    this.ground=scene.add.container(0,0,[base,paving,edges,details,carpet]).setDepth(0);
    for(const p of STREET.benches.filter(p=>p.y>500))this.props.push(scene.add.image(p.x,p.y+14,STREET_ART.bench).setOrigin(.5,1).setDisplaySize(144,84).setDepth(p.y));
    for(const p of STREET.trees.filter(p=>!(p.x===2580&&p.y===1100)))this.props.push(scene.add.image(p.x,p.y+20,STREET_ART.pine).setOrigin(.5,1).setDisplaySize(128,184).setDepth(p.y));
    for(const p of STREET.lamps)this.props.push(scene.add.image(p.x,p.y+9,STREET_ART.lamp).setOrigin(.5,1).setDisplaySize(66,160).setDepth(p.y));
    for(const prop of STREET_SERVICE_PROPS)this.props.push(scene.add.image(prop.x,prop.y,'street-detail-'+prop.id).setOrigin(.5,1).setDisplaySize(prop.width,prop.height).setDepth(prop.y));
    this.props.push(scene.add.image(2660,1060,STREET_ART.taxiSign).setOrigin(.5,1).setDisplaySize(70,123).setDepth(1060));
    this.plan=scene.add.image(0,0,STREET_ART.map).setOrigin(0).setDisplaySize(STREET.width,STREET.height).setDepth(.1);
    const background=scene.add.graphics();
    background.fillStyle(0x681a32).fillRect(b.x,-2300,b.w,front+2300);
    const sections: Phaser.GameObjects.GameObject[]=[background];
    for(let y=front-320;y>-2200;y-=250){
      for(let x=b.x;x<b.x+b.w-20;x+=246)sections.push(scene.add.image(x,y,STREET_ART.floor).setOrigin(0,1).setDisplaySize(246,250));
    }
    const edge=scene.add.graphics();edge.fillStyle(0xf3dcb1).fillRect(b.x+b.w-17,-2300,17,front+2300);
    sections.push(edge,scene.add.image(b.x,front-320,STREET_ART.front).setOrigin(0).setDisplaySize(b.w,350));
    const signX=b.x+STREET_SIGN.center-STREET_SIGN.width/2,signY=front+STREET_SIGN.baselineOffset-STREET_SIGN.baseline;
    sections.push(scene.add.image(signX,signY,STREET_ART.sign).setOrigin(0).setDisplaySize(STREET_SIGN.width,STREET_SIGN.height));
    for(let n=0;n<3;n++){
      const image=scene.add.image(signX,signY,STREET_ART.sheen).setOrigin(0).setDisplaySize(STREET_SIGN.width,STREET_SIGN.height).setVisible(false);
      this.sheen.push(image);sections.push(image);
    }
    this.sparkle=scene.add.graphics().setPosition(signX,signY);sections.push(this.sparkle);
    this.facade=scene.add.container(0,0,sections).setDepth(front);
    this.walls.set('front',this.facade);
    for(const side of ['right','rear','left'] as const){
      const test=new StreetView();test.side=side;const wall=test.wall,g=scene.add.graphics();
      g.fillStyle(side==='rear'?0x65303f:0x681a32).fillRect(wall.left,-2400,wall.width,wall.base+2400);
      for(let x=wall.left;x<wall.right;x+=160)g.lineStyle(1,0x532836).lineBetween(x,-2400,x,wall.base);
      const pieces:Phaser.GameObjects.GameObject[]=[g];
      if(side!=='rear')for(let y=wall.base-350;y>-2200;y-=250)for(let x=wall.left;x<wall.right-20;x+=246)pieces.push(scene.add.image(x,y,STREET_ART.floor).setOrigin(0,1).setDisplaySize(Math.min(246,wall.right-x),250));
      pieces.push(scene.add.image(wall.left,wall.base-350,createStreetWall(scene,side)).setOrigin(0).setDisplaySize(wall.width,350));
      this.walls.set(side,scene.add.container(0,0,pieces).setDepth(wall.base));
    }
    this.anchors=this.props.map(image=>({image,point:{x:image.x,y:image.y}}));
    this.ambience=new StreetAmbience(scene);
    this.residents=new StreetResidents(scene,approach);
    this.roofStairs=new StreetRoofStairs(scene,climb);
    this.door=scene.add.zone(STREET.entrance.x,front-82,170,200).setDepth(front+1).setInteractive({useHandCursor:true}).on('pointerdown',enter);
  }
  update(player: Point, overview: boolean,delta=0,reducedMotion=false,approaching?:StreetResidentId) {
    this.roofStairs.update(overview,this.view);
    for(const [side,wall] of this.walls)wall.setVisible(!overview&&side===this.view.side).setAlpha(1);
    this.plan.setVisible(overview);this.ground.setVisible(!overview);
    const origin=this.view.point({x:0,y:0});this.ground.setPosition(origin.x,origin.y).setRotation(this.view.angle);
    for(const {image,point} of this.anchors){const p=this.view.point(point);image.setPosition(p.x,p.y).setDepth(p.y).setVisible(!overview&&this.view.visible(point));}
    this.door.setVisible(!overview&&this.view.side==='front');if(this.door.input)this.door.input.enabled=!overview&&this.view.side==='front';
    const sign=this.ambience.update(delta,overview,reducedMotion,this.view);
    const state=this.ambience.getState();this.residents.update(player,state.time,state.motion,overview,[player,...state.pedestrians],approaching,this.view);
    this.sheen.forEach((image,index)=>{
      const width=[48,28,10][index],left=Math.max(0,sign.sweep-width/2),right=Math.min(STREET_SIGN.width,sign.sweep+width/2);
      image.setVisible(right>left&&sign.sheen>0&&!overview).setAlpha(sign.sheen*[.25,.45,.7][index]);
      if(right>left)image.setCrop(left*2,0,(right-left)*2,STREET_SIGN.height*2);
    });
    this.sparkle.clear();
    if(sign.sparkle>0&&!overview){
      const [x,y]=[[150,37],[220,57],[73,135]][sign.starIndex],r=5+sign.sparkle*2;
      this.sparkle.fillStyle(0xfff2c7,sign.sparkle).fillPoints([{x:x-r,y},{x:x-1,y:y-1},{x,y:y-r},{x:x+1,y:y-1},{x:x+r,y},{x:x+1,y:y+1},{x,y:y+r},{x:x-1,y:y+1}],true);
    }
  }
  setActive(active:boolean){this.residents.setActive(active);}
  interact(player:Point,id?:StreetResidentId){return this.residents.interact(player,id);}
  prepareApproach(id:StreetResidentId,player:Point){return this.residents.prepareApproach(id,player);}
  get pedestrianCount(){return this.ambience.count+this.residents.count;}
  get characterTextureKeys(){return this.residents.textureKeys;}
  getState(){return {view:{side:this.view.side,orientation:this.view.orientation,overview:this.view.overview},props:this.anchors.map(({image,point})=>({world:{...point},x:image.x,y:image.y,visible:image.visible,texture:image.texture.key})),...this.ambience.getState(),residents:this.residents.getState()};}
  get alpha() { return this.facade.alpha; }
}
