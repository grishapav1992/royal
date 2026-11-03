import type Phaser from 'phaser';
import { characterTexture } from './characters';
import { advanceCharacterMotion,createCharacterMotion } from './characterAnimation';
import { rearWindowArt } from './rearWindowArt';
import { REAR_WINDOW,RearWindowLife,rearWindowLayout } from './rearWindowLife';
import type { StreetView } from './streetView';

/** Opaque wall surrounds shallow room vignettes, with all visitors clipped behind glass. */
export class RearCasinoWindows {
  readonly root:Phaser.GameObjects.Container;
  private life=new RearWindowLife();
  private windows:ReturnType<typeof rearWindowLayout>;
  private people:Phaser.GameObjects.Container;
  private mask:Phaser.Display.Masks.GeometryMask;
  private actors:{sprite:Phaser.GameObjects.Sprite;motion:ReturnType<typeof createCharacterMotion>;x:number;y:number;windowIndex:number;personIndex:number;frame:number}[]=[];
  private visible=false;
  private onscreen=new Set<string>();
  constructor(private scene:Phaser.Scene,view:StreetView){
    this.windows=rearWindowLayout(view.wall,view.roofEdge);
    const art=rearWindowArt(scene),backgrounds:Phaser.GameObjects.GameObject[]=[],frames:Phaser.GameObjects.GameObject[]=[];
    const trim=scene.add.graphics(),clip=scene.make.graphics({x:0,y:0},false).fillStyle(0xffffff);
    this.people=scene.add.container(0,0);
    this.windows.forEach((window,windowIndex)=>{
      const g=REAR_WINDOW.glass;
      if(!window.column)trim.lineStyle(2,0xb58c64,.65).lineBetween(view.wall.left+10,window.y+212,view.wall.right-10,window.y+212);
      backgrounds.push(scene.add.image(window.x+g.x,window.y+g.y,art.rooms[window.kind]).setOrigin(0).setDisplaySize(g.w,g.h));
      frames.push(scene.add.image(window.x,window.y,art.frame).setOrigin(0).setDisplaySize(REAR_WINDOW.width,REAR_WINDOW.height));
      clip.fillRect(window.x+g.x,window.y+g.y,g.w,g.h);
      for(let personIndex=0;personIndex<2;personIndex++){
        const person=this.life.person(window,personIndex);
        const sprite=scene.add.sprite(person.x,person.y,characterTexture(scene,person.skin),'down-6').setOrigin(.5,1).setScale(person.scale).setTint(0xffe7bd);
        this.people.add(sprite);this.actors.push({sprite,motion:createCharacterMotion(),x:person.x,y:person.y,windowIndex,personIndex,frame:6});
      }
    });
    this.mask=clip.createGeometryMask();this.people.setMask(this.mask);
    this.root=scene.add.container(0,0,[trim,...backgrounds,this.people,...frames]).setVisible(false);
    scene.events.once('shutdown',()=>{this.mask.destroy();clip.destroy();});
  }
  update(delta:number,visible:boolean,reducedMotion:boolean){
    this.visible=visible;this.root.setVisible(visible);
    this.life.advance(delta,visible,reducedMotion,document.hidden);
    if(!visible)return;
    const camera=this.scene.cameras.main.worldView;this.onscreen.clear();
    for(const w of this.windows)if(w.x<camera.right&&w.x+REAR_WINDOW.width>camera.left&&w.y<camera.bottom&&w.y+REAR_WINDOW.height>camera.top)this.onscreen.add(w.id);
    for(const actor of this.actors){
      const window=this.windows[actor.windowIndex],person=this.life.person(window,actor.personIndex);
      const distance=Math.hypot(person.x-actor.x,person.y-actor.y);
      if(this.life.motion){
        actor.frame=advanceCharacterMotion(actor.motion,{mode:person.moving?'walk':'rest',distance,time:this.life.time,normalSpeed:person.speed}).frame;
      }else if(reducedMotion)actor.frame=6;
      const halfWidth=actor.sprite.displayWidth/2,left=window.x+REAR_WINDOW.glass.x;
      actor.sprite.setPosition(person.x,person.y).setFrame(person.facing+'-'+actor.frame).setVisible(this.onscreen.has(window.id)&&person.x+halfWidth>left&&person.x-halfWidth<left+REAR_WINDOW.glass.w);
      actor.x=person.x;actor.y=person.y;
    }
  }
  setActive(active:boolean){if(!active){this.visible=false;this.root.setVisible(false);this.life.motion=false;}}
  getState(){return {visible:this.visible,motion:this.life.motion,time:this.life.time,maskApplied:this.people.mask===this.mask,windows:this.windows.map(w=>({...w,width:REAR_WINDOW.width,height:REAR_WINDOW.height,glass:{x:w.x+REAR_WINDOW.glass.x,y:w.y+REAR_WINDOW.glass.y,w:REAR_WINDOW.glass.w,h:REAR_WINDOW.glass.h},onscreen:this.visible&&this.onscreen.has(w.id)})),people:this.actors.map(actor=>{const person=this.life.person(this.windows[actor.windowIndex],actor.personIndex);return {...person,frame:actor.frame,visible:this.visible&&actor.sprite.visible,interactive:Boolean(actor.sprite.input)};})};}
}
