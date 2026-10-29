import Phaser from 'phaser';
import type { CatView } from '../shared/cat';
import type { HallId } from '../shared/world';
import { catPurr, stopCatPurr } from './CatAudio';
import { CAT_CARE } from '../shared/catCare';
import { characterHugColors } from './characters';
import { catSurface } from '../shared/catSurfaces';
import { CatWalkCycle } from './CatWalkCycle';
import walkFrames from '../../public/assets/cat/walk-v3-frames.json';

export const CAT_TEXTURE = 'zverochka';
export const CAT_HABITS_TEXTURE = 'zverochka-habits';
export const CAT_CLIMB_TEXTURE = 'zverochka-climb';
export const CAT_SCRATCH_TEXTURE = 'zverochka-scratch';
export const CAT_WALK_TEXTURE = 'zverochka-walk-v3';
const HABIT_FRAMES: Record<string, number[]> = {
  'roll-0':[11,119,324,299], 'roll-1':[334,117,629,302],
  'roll-2':[643,125,938,275], 'roll-3':[953,112,1237,281],
  'drink-0':[15,714,324,874], 'drink-1':[329,713,631,875],
  'drink-2':[642,714,943,874], 'drink-3':[954,703,1233,874],
  'meal-0':[14,980,321,1140], 'meal-1':[327,980,628,1140],
  'meal-2':[640,980,942,1140], 'meal-3':[944,980,1245,1140],
};

function addFrames(scene: Phaser.Scene, key: string, frames: Record<string, number[]>, margin: number) {
  const texture=scene.textures.get(key),source=texture.getSourceImage() as HTMLImageElement;
  for(const [name,[left,top,right,bottom]] of Object.entries(frames)) {
    if(texture.has(name))continue;
    const x=Math.max(0,left-margin),y=Math.max(0,top-margin);
    texture.add(name,0,x,y,Math.min(source.width,right+margin)-x,Math.min(source.height,bottom+margin)-y);
  }
}
// Frames use the painted silhouette bounds, preserving the artist's proportions.
const FRAMES = [
  [83,14,206,278],[364,18,495,283],[640,14,754,283],[914,19,1037,282],
  [39,309,262,531],[313,305,545,533],[603,306,828,534],[867,308,1096,532],
  [73,567,220,796],[355,564,493,803],[648,562,766,803],[902,555,1031,803],
  [42,818,263,1054],[307,824,544,1049],[587,815,820,1053],[866,817,1105,1049],
  [1,1169,320,1349],[350,1074,543,1348],[599,1088,802,1344],[879,1125,1103,1323],
];

export class CatRenderer {
  private sprite: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Ellipse;
  private bubble: Phaser.GameObjects.Text;
  private treat: Phaser.GameObjects.Graphics;
  private hugArms: Phaser.GameObjects.Graphics;
  private x = 0;
  private y = 0;
  private hall?: HallId;
  private mood = '';
  private purrAt = -Infinity;
  private walkCycle = new CatWalkCycle();
  constructor(private scene: Phaser.Scene) {
    const texture = scene.textures.get(CAT_TEXTURE), source = texture.getSourceImage() as HTMLImageElement;
    FRAMES.forEach(([left,top,right,bottom], index) => {
      if (texture.has(String(index))) return;
      const x = Math.max(0,left-8), y = Math.max(0,top-8);
      texture.add(String(index),0,x,y,Math.min(source.width,right+8)-x,Math.min(source.height,bottom+8)-y);
    });
    addFrames(scene,CAT_HABITS_TEXTURE,HABIT_FRAMES,2);
    addFrames(scene,CAT_CLIMB_TEXTURE,{
      '0':[147,161,738,462], '1':[917,24,1441,519],
      '2':[110,505,744,972], '3':[860,577,1430,930],
    },3);
    addFrames(scene,CAT_SCRATCH_TEXTURE,{
      '0':[100,10,708,506], '1':[868,9,1476,506],
      '2':[100,518,708,1012], '3':[868,527,1476,1012],
    },0);
    for (const [facing,frames] of Object.entries(walkFrames)) {
      frames.forEach(({bounds:[left,top,right,bottom]},index) => {
        const texture=scene.textures.get(CAT_WALK_TEXTURE),name=facing+'-'+index;
        if (!texture.has(name)) texture.add(name,0,left,top,right-left,bottom-top);
      });
    }
    this.shadow = scene.add.ellipse(0,0,35,10,0x100f19,.22).setName('cat-shadow');
    this.sprite = scene.add.image(0,0,CAT_TEXTURE,'16').setOrigin(.5,1).setScale(.22).setName('cat');
    this.bubble = scene.add.text(0,0,'',{fontFamily:'Arial',fontSize:'11px',color:'#3d3038',backgroundColor:'#fff4dc',padding:{x:8,y:5}}).setOrigin(.5,1).setName('cat-bubble');
    this.treat = scene.add.graphics().setName('cat-treat');
    this.hugArms=scene.add.graphics().setName('cat-hug-arms').setVisible(false);
    scene.events.once('shutdown',stopCatPurr);
  }
  update(view: CatView, hall: HallId, time: number, dt: number, reducedMotion: boolean, carrier?: {x:number;y:number;skin?:number;appearance?:string}, audible = false) {
    const visible = view.hall === hall;
    this.sprite.setVisible(visible); this.shadow.setVisible(visible && view.mood !== 'carried');
    this.bubble.setVisible(false); this.treat.setVisible(false);this.hugArms.setVisible(false);
    if (!visible) { if(this.hall)stopCatPurr();this.hall = undefined;this.walkCycle.update(view,false,true); return; }
    if (!audible) stopCatPurr();
    const enteringMood=this.mood!==view.mood;
    if(enteringMood) {
      stopCatPurr();
      if(audible&&(view.mood==='petting'||view.mood==='carried'))void catPurr(view.mood==='carried'?7:2.4);
    }
    if(view.mood==='purring'&&audible&&(enteringMood||time-this.purrAt>5200)) {this.purrAt=time;void catPurr(4.4);}
    this.mood = view.mood;
    const surface=catSurface(view.surfaceId);
    const carried = view.mood === 'carried';
    const targetX = carried && carrier ? carrier.x + 6 : view.x;
    const targetY = carried && carrier ? carrier.y - 23 : view.y;
    const snap = this.hall !== hall || Math.hypot(this.x-targetX,this.y-targetY)>180;
    const blend = snap ? 1 : 1-Math.exp(-dt*20);
    this.x += (targetX-this.x)*blend; this.y += (targetY-this.y)*blend; this.hall = hall;
    const walkFrame=this.walkCycle.update({x:this.x,y:this.y},view.mood==='walking'&&view.moving,snap);
    const jump = view.mood === 'jumping' && !reducedMotion ? Math.sin(view.progress*Math.PI)*(23+(surface?.height??0)*.14) : 0;
    let frame = '17', textureKey = CAT_TEXTURE;
    let scale = carried ? .17 : .22;
    if (view.mood === 'sleeping') frame = '16';
    else if (view.mood === 'belly-up') {
      textureKey=CAT_HABITS_TEXTURE;scale=.23;
      const phase=reducedMotion?2:view.progress<.08?Math.min(3,Math.floor(view.progress/.02)):view.progress>.92?Math.max(0,Math.min(3,Math.floor((1-view.progress)/.02))):2+Math.floor(time/1800)%2;
      frame='roll-'+phase;
    }
    else if (carried) frame = '19';
    else if (view.mood === 'drinking' || view.mood === 'eating-bowl') {
      textureKey=CAT_HABITS_TEXTURE;scale=.18;
      frame=(view.mood==='drinking'?'drink-':'meal-')+(reducedMotion?0:Math.floor(time/(view.mood==='drinking'?230:320))%4);
    }
    else if (view.mood === 'eating') frame = '18';
    else if (view.mood === 'stretching') frame = '4';
    else if (view.mood === 'scratching') {
      textureKey=CAT_SCRATCH_TEXTURE;scale=.12;
      frame=String(reducedMotion?0:[0,1,0,2,3,2][Math.floor(time/170)%6]);
    }
    else if (view.mood === 'perched'&&surface?.kind==='sofa') frame='16';
    else if (view.mood === 'jumping') {
      textureKey=CAT_CLIMB_TEXTURE;scale=.1;
      frame=String(reducedMotion?3:view.jumpingDown?view.progress<.18?0:view.progress<.82?2:3:Math.min(3,Math.floor(view.progress*4)));
    }
    else if (view.mood === 'walking') {
      textureKey=CAT_WALK_TEXTURE;scale=.26;
      frame=view.facing+'-'+(view.moving&&!reducedMotion?walkFrame:0);
    }
    if (this.sprite.texture.key !== textureKey || this.sprite.frame.name !== frame) this.sprite.setTexture(textureKey,frame);
    if (textureKey===CAT_WALK_TEXTURE) {
      const registration=walkFrames[view.facing][view.moving&&!reducedMotion?walkFrame:0];
      const [left,top,right,bottom]=registration.bounds;
      this.sprite.setOrigin((registration.anchorX-left)/(right-left),(registration.groundY-top)/(bottom-top));
    } else this.sprite.setOrigin(.5,1);
    const breathe = !reducedMotion && ['sleeping','belly-up','perched','purring'].includes(view.mood) ? Math.sin(time/950)*.015 : 0;
    const stretch=view.mood==='stretching'&&!reducedMotion?Math.sin(view.progress*Math.PI):0;
    const depth = surface?.depth ?? (carried ? view.y+5 : view.y+1);
    const footY=this.y+(surface?0:view.mood==='eating-bowl'?-5:7)-jump;
    this.sprite.setPosition(this.x,footY).setDepth(depth).setScale(scale*(1+stretch*.18),scale*(1+breathe-stretch*.16));
    const airborne=view.mood==='jumping';
    this.sprite.setFlipX(airborne&&this.jumpFacesRight(view)).setAngle(airborne&&view.jumpingDown&&!reducedMotion?(this.jumpFacesRight(view)?25:-25)*Math.sin(view.progress*Math.PI):0);
    this.shadow.setPosition(this.x,airborne&&surface?surface.approach.y:footY-2).setDepth(airborne?2:depth-1).setScale(surface?.kind==='pillow'?1.4:surface?.kind==='cabinet' ? .8 : 1,airborne ? .6 : 1).setAlpha(airborne ? .12 : .22);
    if(carried&&carrier) {
      const colors=characterHugColors(carrier.skin,carrier.appearance),arms=this.hugArms;
      const lift=reducedMotion?1:Math.min(1,view.progress*18);
      arms.clear().setPosition(carrier.x,carrier.y).setDepth(depth+1).setVisible(true);
      for(const side of [-1,1]) {
        const elbowY=-19-5*lift,handY=-20-6*lift;
        for(const [width,color] of [[9,0x382f3b],[7,colors.sleeve]]) {
          arms.lineStyle(width,color).beginPath().moveTo(side*14,-39).lineTo(side*17,elbowY).lineTo(side*8+3,handY).strokePath();
        }
        arms.fillStyle(colors.skin).fillEllipse(side*8+3,handY,8,6);
      }
    }
    const phrase = view.mood === 'petting' || view.mood==='purring' || carried ? 'Мр-р-р…' : view.mood === 'eating' ? 'С ладошки вкуснее' : '';
    if (phrase) this.bubble.setText(phrase).setPosition(this.x,this.y-52).setDepth(depth+2).setVisible(true);
    if (view.mood === 'eating') {
      this.treat.clear().fillStyle(0xe5ab7a).fillRoundedRect(this.x-5,this.y-22,9,6,2).setDepth(depth+1).setVisible(true);
    }
    if (view.mood === 'drinking') {
      const mug=CAT_CARE.bar.mug,ripple=reducedMotion?0:(Math.sin(time/230)+1)*1.2;
      this.treat.clear().lineStyle(.8,0xe2f4f4,.8).strokeEllipse(mug.x,mug.y-5,5+ripple,2+ripple/2).setDepth(depth+3).setVisible(true);
    }
    if(view.mood==='scratching'&&!reducedMotion) {
      const post=CAT_CARE.scratcher.post,stroke=(time%340)/340;
      this.treat.clear().setDepth(depth+1).setVisible(true);
      if(stroke<.55)for(let i=0;i<2;i++) {
        const x=post.x-5+i*3,y=post.y-40+stroke*10+i*2;
        this.treat.lineStyle(.8,0xe2c79b,1-stroke/.55).lineBetween(x,y,x-2,y+3);
      }
    }
  }
  private jumpFacesRight(view:CatView) {
    const surface=catSurface(view.surfaceId);
    if(!surface)return view.facing==='right';
    return view.jumpingDown?surface.approach.x>=surface.perch.x:surface.perch.x>=surface.approach.x;
  }
}
