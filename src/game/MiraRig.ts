import Phaser from 'phaser';
import {BAR_POSITION} from '../shared/furniture';
import {MIRA_COUNTER_FRONT_Y,type MiraView} from '../shared/miraRoutine';
import {isMiraPouring,MIRA_ATLASES,sampleMiraFrame,type MiraAtlas,type MiraFrame} from './miraAnimation';
import {ROYAL_BAR_DEPTH} from './royalBarLayers';

type Rect={x:number;y:number;width:number;height:number};
type PaintedFrame={image:HTMLImageElement|HTMLCanvasElement;rect:Rect;anchorX:number;anchorY:number;contactOffset:number;scale:number};
const SIZE={width:128,height:180,resolution:4};

/** Register opaque artwork with a single scale for the complete sheet. */
function registerAtlas(scene:Phaser.Scene,atlas:MiraAtlas):PaintedFrame[]{
  const spec=MIRA_ATLASES[atlas],image=scene.textures.get('mira-painted-'+atlas).getSourceImage() as HTMLImageElement;
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(image,0,0);
  // The wipe atlas packs matching body and hand-contact tiles in two halves.
  const contactGround='contactGround' in spec?spec.contactGround:undefined;
  const bodyHeight=contactGround===undefined?image.height:image.height/2;
  const anchorGround='anchorGround' in spec?spec.anchorGround:contactGround;
  const pixels=context.getImageData(0,0,image.width,bodyHeight).data,frames:PaintedFrame[]=[];
  for(let row=0;row<spec.rows;row++)for(let col=0;col<spec.columns;col++){
    const x0=Math.floor(col*image.width/spec.columns),x1=Math.floor((col+1)*image.width/spec.columns);
    const y0=Math.floor(row*bodyHeight/spec.rows),y1=Math.floor((row+1)*bodyHeight/spec.rows);
    let left=x1,top=y1,right=x0,bottom=y0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(pixels[(y*image.width+x)*4+3]>200){
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    if(right<=left||bottom<=top)throw new Error('Empty painted Mira frame: '+atlas+' '+frames.length);
    const ground=anchorGround===undefined?bottom+1:y0+anchorGround;
    frames.push({image,rect:{x:left,y:top,width:right-left+1,height:bottom-top+1},
      anchorX:(x0+x1)/2-left,anchorY:ground-top,contactOffset:image.height-bodyHeight,scale:1});
  }
  const heights=frames.map(f=>f.rect.height).sort((a,b)=>a-b),height='scaleHeight' in spec?spec.scaleHeight:heights[Math.floor(heights.length/2)];
  for(const frame of frames)frame.scale=(spec.fullBody?110:60)/height;
  return frames;
}

/** Complete painted frames, with separate counter occlusion. Keeps the existing Bar adapter. */
export class MiraRig {
  private body:Phaser.GameObjects.Image;
  private foreground:Phaser.GameObjects.Image;
  private bodyTexture:Phaser.Textures.CanvasTexture;
  private frontTexture:Phaser.Textures.CanvasTexture;
  private frames:Record<MiraAtlas,PaintedFrame[]>;
  private sample?:MiraFrame;
  private bounds:Rect={x:0,y:0,width:0,height:0};
  private signature='';
  constructor(private scene:Phaser.Scene){
    this.frames=Object.fromEntries((Object.keys(MIRA_ATLASES) as MiraAtlas[]).map(key=>[key,registerAtlas(scene,key)])) as Record<MiraAtlas,PaintedFrame[]>;
    for(const frame of this.frames.wipe)frame.scale=this.frames.work[0].scale;
    for(const key of ['mira-illustrated-body','mira-illustrated-front'])if(scene.textures.exists(key))scene.textures.remove(key);
    this.bodyTexture=scene.textures.createCanvas('mira-illustrated-body',SIZE.width*SIZE.resolution,SIZE.height*SIZE.resolution)!;
    this.frontTexture=scene.textures.createCanvas('mira-illustrated-front',SIZE.width*SIZE.resolution,SIZE.height*SIZE.resolution)!;
    this.body=scene.add.image(0,0,this.bodyTexture).setOrigin(.5,1).setDisplaySize(SIZE.width,SIZE.height).setDepth(ROYAL_BAR_DEPTH.staff).setName('mira-painted-body');
    this.foreground=scene.add.image(0,0,this.frontTexture).setOrigin(.5,1).setDisplaySize(SIZE.width,SIZE.height).setDepth(ROYAL_BAR_DEPTH.staffContact).setName('mira-painted-front');
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{
      for(const key of ['mira-illustrated-body','mira-illustrated-front'])if(scene.textures.exists(key))scene.textures.remove(key);
    });
  }
  reset(){this.sample=undefined;this.signature='';}
  render(view:MiraView,reducedMotion:boolean,_time:number,_delta:number){
    const sample=sampleMiraFrame(view,reducedMotion),frame=this.frames[sample.atlas][sample.frame];
    this.sample=sample;
    const fullBody=MIRA_ATLASES[sample.atlas].fullBody;
    const baseY=view.y+52-31*sample.seat,originY=baseY-SIZE.height;
    const depth=view.y>MIRA_COUNTER_FRONT_Y?ROYAL_BAR_DEPTH.props+.25:ROYAL_BAR_DEPTH.staff;
    this.body.setPosition(view.x,baseY);
    if(this.body.depth!==depth)this.body.setDepth(depth);
    this.foreground.setPosition(view.x,baseY);
    const width=frame.rect.width*frame.scale,height=frame.rect.height*frame.scale;
    const x=SIZE.width/2-frame.anchorX*frame.scale;
    const bottom=fullBody?SIZE.height:BAR_POSITION.y+114-originY;
    const y=bottom-frame.anchorY*frame.scale;
    this.bounds={x:view.x+(sample.flipped?SIZE.width-x-width:x)-SIZE.width/2,y:originY+y,width,height};
    const signature=[sample.atlas,sample.frame,sample.flipped,sample.seat.toFixed(4),baseY.toFixed(3)].join(':');
    if(signature===this.signature)return;this.signature=signature;
    const draw=(texture:Phaser.Textures.CanvasTexture,front:boolean)=>{
      const c=texture.context;c.clearRect(0,0,texture.width,texture.height);c.save();c.scale(SIZE.resolution,SIZE.resolution);
      if(front&&!frame.contactOffset){c.restore();texture.refresh();return;}
      if(sample.flipped){c.translate(SIZE.width,0);c.scale(-1,1);}
      const r=frame.rect;c.drawImage(frame.image,r.x,r.y+(front?frame.contactOffset:0),r.width,r.height,x,y,width,height);
      c.restore();texture.refresh();
    };
    draw(this.bodyTexture,false);draw(this.frontTexture,true);
  }
  getState(){
    return {artVersion:3,animationMethod:'painted-sequences',renderX:this.body.x,renderY:this.body.y,
      clip:this.sample?.clip,atlas:this.sample?.atlas,frame:this.sample?.frame,paintedBounds:{...this.bounds},bodyDepth:this.body.depth,foregroundDepth:this.foreground.depth,
      pouring:isMiraPouring(this.sample)};
  }
}
