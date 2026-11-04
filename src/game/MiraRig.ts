import Phaser from 'phaser';
import {BAR_POSITION} from '../shared/furniture';
import type {MiraView} from '../shared/miraRoutine';
import {miraPose,blendMiraPose,MIRA_RIG_SIZE,type MiraPose,type RigPoint,type MiraJoint} from './miraPose';

type ImageSource=HTMLImageElement|HTMLCanvasElement;
type Part={image:ImageSource;rect:[number,number,number,number];root:RigPoint;tip?:RigPoint;width?:number};
type PartSpec={key:string;rect:[number,number,number,number];root:[number,number];tip?:[number,number]};
const specs:Record<string,PartSpec>={
  frontHead:{key:'mira-rig-body',rect:[69,11,384,466],root:[262,326]},
  sideHead:{key:'mira-rig-body',rect:[589,11,353,463],root:[805,326]},
  backHead:{key:'mira-rig-body',rect:[1083,10,388,476],root:[1280,326]},
  frontBody:{key:'mira-rig-body',rect:[106,515,308,496],root:[252,524]},
  sideBody:{key:'mira-rig-body',rect:[641,516,244,495],root:[744,524]},
  backBody:{key:'mira-rig-body',rect:[1126,514,299,497],root:[1280,524]},
  leftUpper:{key:'mira-rig-limbs',rect:[113,41,149,397],root:[211,89],tip:[168,404]},
  leftFore:{key:'mira-rig-limbs',rect:[512,22,107,465],root:[571,51],tip:[558,384]},
  rightUpper:{key:'mira-rig-limbs',rect:[893,41,149,400],root:[947,89],tip:[984,404]},
  rightFore:{key:'mira-rig-limbs',rect:[1293,22,108,465],root:[1340,51],tip:[1347,384]},
  leftThigh:{key:'mira-rig-limbs',rect:[69,529,235,472],root:[181,573],tip:[221,953]},
  rightThigh:{key:'mira-rig-limbs',rect:[464,532,233,469],root:[590,573],tip:[551,953]},
  leftShin:{key:'mira-rig-limbs',rect:[898,528,129,484],root:[975,557],tip:[979,990]},
  rightShin:{key:'mira-rig-limbs',rect:[1279,527,135,485],root:[1335,557],tip:[1362,990]},
};
const local=(p:[number,number],r:[number,number,number,number]):RigPoint=>({x:p[0]-r[0],y:p[1]-r[1]});

function registerParts(scene:Phaser.Scene):Record<string,Part>{
  const sources=new Map<string,{image:ImageSource;data:ImageData}>();
  const source=(key:string)=>{
    if(!sources.has(key)){
      const image=scene.textures.get(key).getSourceImage() as ImageSource;
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const c=canvas.getContext('2d',{willReadFrequently:true})!;c.drawImage(image,0,0);
      sources.set(key,{image,data:c.getImageData(0,0,canvas.width,canvas.height)});
    }
    return sources.get(key)!;
  };
  const parts:Record<string,Part>={};
  for(const[name,spec]of Object.entries(specs)){
    const {image,data}=source(spec.key),root=local(spec.root,spec.rect),tip=spec.tip?local(spec.tip,spec.rect):undefined;
    const part:Part={image,rect:spec.rect,root,tip};
    if(tip){
      const angle=Math.atan2(tip.y-root.y,tip.x-root.x),sin=Math.sin(angle),cos=Math.cos(angle);
      let lo=Infinity,hi=-Infinity;
      const[x,y,w,h]=spec.rect;
      for(let py=0;py<h;py++)for(let px=0;px<w;px++)if(data.data[((y+py)*data.width+x+px)*4+3]>180){
        const across=-(px-root.x)*sin+(py-root.y)*cos;lo=Math.min(lo,across);hi=Math.max(hi,across);
      }
      part.width=Math.max(1,hi-lo);
    }
    parts[name]=part;
  }
  const {image,data}=source('mira-rig-props');
  for(const[name,column]of [['glass',0],['bottle',1],['cloth',2]] as const){
    const cw=image.width/3;let left=Infinity,top=Infinity,right=0,bottom=0;
    for(let y=0;y<image.height;y++)for(let x=Math.ceil(column*cw);x<(column+1)*cw;x++)if(data.data[(y*data.width+x)*4+3]>180){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    const rect:[number,number,number,number]=[left,top,right-left+1,bottom-top+1];
    parts[name]={image,rect,root:{x:rect[2]/2,y:rect[3]*(name==='bottle'?.7:name==='glass'?.6:.5)}};
  }
  return parts;
}

export class MiraRig {
  private body:Phaser.GameObjects.Image;
  private foreground:Phaser.GameObjects.Image;
  private bodyTexture:Phaser.Textures.CanvasTexture;
  private frontTexture:Phaser.Textures.CanvasTexture;
  private parts:Record<string,Part>;
  private pose?:MiraPose;
  constructor(private scene:Phaser.Scene){
    this.parts=registerParts(scene);
    const{width,height,resolution}=MIRA_RIG_SIZE;
    for(const key of ['mira-illustrated-body','mira-illustrated-front'])if(scene.textures.exists(key))scene.textures.remove(key);
    this.bodyTexture=scene.textures.createCanvas('mira-illustrated-body',width*resolution,height*resolution)!;
    this.frontTexture=scene.textures.createCanvas('mira-illustrated-front',width*resolution,height*resolution)!;
    this.body=scene.add.image(0,0,this.bodyTexture).setOrigin(.5,1).setDisplaySize(width,height).setDepth(BAR_POSITION.y+117).setName('mira-illustrated-body');
    this.foreground=scene.add.image(0,0,this.frontTexture).setOrigin(.5,1).setDisplaySize(width,height).setDepth(BAR_POSITION.y+170).setName('mira-illustrated-front');
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{
      for(const key of ['mira-illustrated-body','mira-illustrated-front'])if(scene.textures.exists(key))scene.textures.remove(key);
    });
  }
  reset(){this.pose=undefined;}
  private bone(c:CanvasRenderingContext2D,name:string,from:RigPoint,to:RigPoint,width:number){
    const part=this.parts[name],tip=part.tip!;
    const sourceAngle=Math.atan2(tip.y-part.root.y,tip.x-part.root.x),targetAngle=Math.atan2(to.y-from.y,to.x-from.x);
    const length=Math.hypot(to.x-from.x,to.y-from.y)/Math.hypot(tip.x-part.root.x,tip.y-part.root.y);
    c.save();c.translate(from.x,from.y);c.rotate(targetAngle);c.scale(length,width/part.width!);c.rotate(-sourceAngle);c.translate(-part.root.x,-part.root.y);
    c.drawImage(part.image,...part.rect,0,0,part.rect[2],part.rect[3]);c.restore();
  }
  private part(c:CanvasRenderingContext2D,name:string,at:RigPoint,angle:number,sx:number,sy=sx){
    const part=this.parts[name];c.save();c.translate(at.x,at.y);c.rotate(angle);c.scale(sx,sy);
    c.drawImage(part.image,...part.rect,-part.root.x,-part.root.y,part.rect[2],part.rect[3]);c.restore();
  }
  private forearms(c:CanvasRenderingContext2D,p:MiraPose){
    const j=p.joints;
    this.bone(c,'leftFore',j.leftElbow,j.leftHand,4.6);
    this.bone(c,'rightFore',j.rightElbow,j.rightHand,4.6);
  }
  private props(c:CanvasRenderingContext2D,p:MiraPose){
    for(const prop of p.props){
      const part=this.parts[prop.kind],height=prop.kind==='glass'?15:prop.kind==='bottle'?20:4;
      const width=prop.kind==='cloth'?10:height*part.rect[2]/part.rect[3];
      c.save();c.globalAlpha*=prop.alpha;this.part(c,prop.kind,prop.point,prop.angle,width/part.rect[2],height/part.rect[3]);c.restore();
    }
    if(p.pour){
      c.save();c.strokeStyle='#efd075';c.lineWidth=.65;c.beginPath();c.moveTo(p.pour.from.x,p.pour.from.y);c.lineTo(p.pour.to.x,p.pour.to.y);c.stroke();c.restore();
    }
  }
  private character(c:CanvasRenderingContext2D,p:MiraPose){
    const j=p.joints;
    this.bone(c,'rightThigh',j.rightHip,j.rightKnee,10.5);this.bone(c,'rightShin',j.rightKnee,j.rightFoot,7.3);
    this.bone(c,'leftThigh',j.leftHip,j.leftKnee,10.5);this.bone(c,'leftShin',j.leftKnee,j.leftFoot,7.3);
    this.bone(c,'leftUpper',j.leftShoulder,j.leftElbow,5.6);
    if(p.facing!=='side')this.bone(c,'rightUpper',j.rightShoulder,j.rightElbow,5.6);
    this.part(c,p.facing+'Body',j.neck,p.bodyAngle,.10,.08);
    if(p.facing==='side')this.bone(c,'rightUpper',j.rightShoulder,j.rightElbow,5.6);
    this.part(c,p.facing+'Head',j.neck,p.headAngle,.08);
    if(p.facing!=='back'&&(p.blink||p.mouthOpen)){
      const part=this.parts[p.facing+'Head'];
      c.save();c.translate(j.neck.x,j.neck.y);c.rotate(p.headAngle);c.scale(.08,.08);c.translate(-part.root.x-part.rect[0],-part.root.y-part.rect[1]);
      const side=p.facing==='side';
      if(p.mouthOpen){c.fillStyle='#502331';c.beginPath();c.ellipse(side?905:265,side?226:236,side?8:11,6,side?-.2:-.1,0,Math.PI*2);c.fill();}
      if(p.blink){
        c.strokeStyle='#dba17b';c.lineWidth=13;c.lineCap='round';
        for(const[a,b]of (side?[[[861,172],[893,177]]]:[[[204,194],[239,185]],[[282,179],[315,173]]])){c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke();}
        c.strokeStyle='#4c2630';c.lineWidth=4;
        for(const[a,b]of (side?[[[861,174],[893,179]]]:[[[204,196],[239,187]],[[282,181],[315,175]]])){c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke();}
      }
      c.restore();
    }
    this.props(c,p);this.forearms(c,p);
  }
  render(view:MiraView,reducedMotion:boolean,time:number,delta:number){
    const next=miraPose(view,reducedMotion,time);
    this.pose=this.pose?blendMiraPose(this.pose,next,1-Math.exp(-Math.min(.1,Math.max(0,delta))/.09)):next;
    const pose=this.pose,{width,height,resolution}=MIRA_RIG_SIZE;
    const y=view.y+pose.rootY;this.body.setPosition(view.x,y);this.foreground.setPosition(view.x,y);
    const counter=BAR_POSITION.y+106-(y-height);
    const draw=(texture:Phaser.Textures.CanvasTexture,front:boolean)=>{
      const c=texture.context;c.clearRect(0,0,texture.width,texture.height);c.save();c.scale(resolution,resolution);
      if(pose.flipped){c.translate(width,0);c.scale(-1,1);}
      if(!front)this.character(c,pose);
      else{
        if(pose.seat>.001){
          c.save();c.beginPath();c.rect(0,counter-5,width,6+pose.seat*(height-counter+6));c.clip();this.character(c,pose);c.restore();
        }
        if(!['walk','stock'].includes(pose.action)){
          c.save();c.beginPath();c.rect(0,counter-7,width,height-counter+7);c.clip();this.props(c,pose);this.forearms(c,pose);c.restore();
        }
      }
      c.restore();texture.refresh();
    };
    draw(this.bodyTexture,false);draw(this.frontTexture,true);
  }
  getState(){
    const pose=this.pose;
    if(!pose)return {artVersion:2,renderX:this.body.x,renderY:this.body.y};
    const world=(p:RigPoint)=>({x:this.body.x+(pose.flipped?48-p.x:p.x-48),y:this.body.y-160+p.y});
    return {artVersion:2,renderX:this.body.x,renderY:this.body.y,bodyAngle:pose.bodyAngle,headAngle:pose.headAngle,mouthOpen:pose.mouthOpen,
      joints:Object.fromEntries(Object.entries(pose.joints).map(([name,p])=>[name,world(p)])) as Record<MiraJoint,RigPoint>,
      props:pose.props.map(prop=>({...prop,point:world(prop.point)})),pouring:!!pose.pour};
  }
}
