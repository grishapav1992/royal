import Phaser from 'phaser';
import { STREET, streetFacadeAlpha } from '../shared/street';
import { createStreetArt, STREET_ART, STREET_SIGN } from './streetArt';
import { StreetAmbience } from './StreetAmbience';
import type { Point } from './navigation';

/** Reusable facade sections keep the close view independent of total floor count. */
export class StreetRenderer {
  private facade: Phaser.GameObjects.Container;
  private plan: Phaser.GameObjects.Image;
  private footprint: Phaser.GameObjects.Graphics;
  private ground: Phaser.GameObjects.Container;
  private props: Phaser.GameObjects.Image[]=[];
  private ambience: StreetAmbience;
  private sheen: Phaser.GameObjects.Image[]=[];
  private sparkle: Phaser.GameObjects.Graphics;
  readonly mapCanvas: HTMLCanvasElement;
  constructor(scene: Phaser.Scene, enter: () => void) {
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
    this.ground=scene.add.container(0,0,[base,paving,edges]).setDepth(0);
    for(const p of STREET.benches)this.props.push(scene.add.image(p.x,p.y+14,STREET_ART.bench).setOrigin(.5,1).setDisplaySize(144,84).setDepth(p.y));
    for(const p of STREET.trees)this.props.push(scene.add.image(p.x,p.y+20,STREET_ART.pine).setOrigin(.5,1).setDisplaySize(128,184).setDepth(p.y));
    for(const p of STREET.lamps)this.props.push(scene.add.image(p.x,p.y+9,STREET_ART.lamp).setOrigin(.5,1).setDisplaySize(66,160).setDepth(p.y));
    this.plan=scene.add.image(0,0,STREET_ART.map).setOrigin(0).setDisplaySize(STREET.width,STREET.height).setDepth(.1);
    this.footprint=scene.add.graphics().setDepth(.05);
    this.footprint.fillStyle(0x681a32).fillRect(b.x,b.y,b.w,b.h);
    this.footprint.lineStyle(3,0xcdb78e).strokeRect(b.x,b.y,b.w,b.h);
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
    this.ambience=new StreetAmbience(scene);
    scene.add.zone(STREET.entrance.x,front-82,170,200).setDepth(front+1).setInteractive({useHandCursor:true}).on('pointerdown',enter);
  }
  update(player: Point, overview: boolean,delta=0,reducedMotion=false) {
    const alpha=streetFacadeAlpha(player);
    this.facade.setVisible(!overview).setAlpha(alpha);
    this.plan.setVisible(overview);
    this.footprint.setVisible(!overview&&alpha<1);
    this.ground.setVisible(!overview);
    for(const prop of this.props)prop.setVisible(!overview);
    const sign=this.ambience.update(delta,overview,reducedMotion);
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
  get pedestrianCount(){return this.ambience.count;}
  getState(){return this.ambience.getState();}
  get alpha() { return this.facade.alpha; }
}
