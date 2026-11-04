import type Phaser from 'phaser';
import { characterTexture,CHARACTER_SCALE } from './characters';
import { advanceCharacterMotion,createCharacterMotion } from './characterAnimation';
import { rearWindowArt } from './rearWindowArt';
import { REAR_WINDOW,RearWindowLife,rearWindowLayout } from './rearWindowLife';
import type { StreetView } from './streetView';
import type { HallId } from '../shared/world';
import { rearWindowInterior,type RearInteriorView } from './rearWindowInteriors';

/** Opaque wall surrounds shallow room vignettes, with all visitors clipped behind glass. */
export class RearCasinoWindows {
  readonly root:Phaser.GameObjects.Container;
  private life=new RearWindowLife();
  private windows:(ReturnType<typeof rearWindowLayout>[number]&{room:RearInteriorView|null})[];
  private backgrounds=new Map<string,Phaser.GameObjects.Image>();
  private captures=new Map<string,Phaser.GameObjects.RenderTexture>();
  private people:Phaser.GameObjects.Container;
  private mask:Phaser.Display.Masks.GeometryMask;
  private actors:{sprite:Phaser.GameObjects.Sprite;motion:ReturnType<typeof createCharacterMotion>;x:number;y:number;windowIndex:number;personIndex:number;frame:number}[]=[];
  private visible=false;
  private onscreen=new Set<string>();
  constructor(private scene:Phaser.Scene,view:StreetView,private floorObjects:ReadonlyMap<HallId,readonly Phaser.GameObjects.GameObject[]>=new Map()){
    const windows=rearWindowLayout(view.wall,view.roofEdge),rows=Math.max(...windows.map(p=>p.row))+1,columns=Math.max(...windows.map(p=>p.column))+1;
    this.windows=windows.map(window=>({...window,room:rearWindowInterior(window,rows,columns)}));
    const art=rearWindowArt(scene),backgrounds:Phaser.GameObjects.GameObject[]=[],frames:Phaser.GameObjects.GameObject[]=[];
    const trim=scene.add.graphics(),clip=scene.make.graphics({x:0,y:0},false).fillStyle(0xffffff);
    this.people=scene.add.container(0,0);
    this.windows.forEach((window,windowIndex)=>{
      const g=REAR_WINDOW.glass;
      if(!window.column)trim.lineStyle(2,0xb58c64,.65).lineBetween(view.wall.left+10,window.y+212,view.wall.right-10,window.y+212);
      const background=scene.add.image(window.x+g.x,window.y+g.y,art.closed).setOrigin(0).setDisplaySize(g.w,g.h);
      this.backgrounds.set(window.id,background);backgrounds.push(background);
      frames.push(scene.add.image(window.x,window.y,art.frame).setOrigin(0).setDisplaySize(REAR_WINDOW.width,REAR_WINDOW.height));
      clip.fillRect(window.x+g.x,window.y+g.y,g.w,g.h);
      for(let personIndex=0;window.room&&personIndex<2;personIndex++){
        const person=this.person(window,personIndex);
        const sprite=scene.add.sprite(person.x,person.y,characterTexture(scene,person.skin),'down-6').setOrigin(.5,1).setScale(person.scale).setTint(0xffe7bd);
        this.people.add(sprite);this.actors.push({sprite,motion:createCharacterMotion(),x:person.x,y:person.y,windowIndex,personIndex,frame:6});
      }
    });
    this.mask=clip.createGeometryMask();this.people.setMask(this.mask);
    this.root=scene.add.container(0,0,[trim,...backgrounds,this.people,...frames]).setVisible(false);
    scene.events.once('shutdown',()=>{this.mask.destroy();clip.destroy();for(const texture of this.captures.values()){const key=texture.texture.key;texture.destroy();if(scene.textures.exists(key))scene.textures.remove(key);}});
  }
  private person(window:typeof this.windows[number],index:number){
    const scale=window.room?CHARACTER_SCALE*REAR_WINDOW.glass.w/window.room.crop.w:.54;
    return this.life.person(window,index,scale);
  }
  private capture(room:RearInteriorView){
    const existing=this.captures.get(room.id);if(existing)return existing.texture.key;
    const source=this.floorObjects.get(room.hall);if(!source?.length)return null;
    const objects=source.filter(p=>p.type!=='Zone'&&'renderWebGL' in p).map(p=>p as Phaser.GameObjects.Image).sort((a,b)=>a.depth-b.depth);
    const visibility=objects.map(p=>p.visible),g=REAR_WINDOW.glass;
    const texture=this.scene.make.renderTexture({width:g.w*2,height:g.h*2},false);
    texture.camera.setOrigin(0,0).setZoom(g.w*2/room.crop.w).setScroll(room.crop.x,room.crop.y);
    // Hidden hall objects are only exposed to this offscreen draw, then restored immediately.
    try{objects.forEach(p=>p.setVisible(true));texture.draw(objects);}
    finally{objects.forEach((p,i)=>p.setVisible(visibility[i]));}
    texture.saveTexture('casino-rear-interior-'+room.id);this.captures.set(room.id,texture);
    return texture.texture.key;
  }
  update(delta:number,visible:boolean,reducedMotion:boolean){
    this.visible=visible;this.root.setVisible(visible);
    this.life.advance(delta,visible,reducedMotion,document.hidden);
    if(!visible)return;
    const camera=this.scene.cameras.main.worldView;this.onscreen.clear();
    for(const w of this.windows)if(w.x<camera.right&&w.x+REAR_WINDOW.width>camera.left&&w.y<camera.bottom&&w.y+REAR_WINDOW.height>camera.top){
      this.onscreen.add(w.id);
      if(w.room){const key=this.capture(w.room);if(key)this.backgrounds.get(w.id)!.setTexture(key).setDisplaySize(REAR_WINDOW.glass.w,REAR_WINDOW.glass.h);}
    }
    for(const actor of this.actors){
      const window=this.windows[actor.windowIndex],person=this.person(window,actor.personIndex);
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
  getState(){return {visible:this.visible,motion:this.life.motion,time:this.life.time,maskApplied:this.people.mask===this.mask,capturedRooms:this.captures.size,windows:this.windows.map(w=>({...w,captured:Boolean(w.room&&this.captures.has(w.room.id)),width:REAR_WINDOW.width,height:REAR_WINDOW.height,glass:{x:w.x+REAR_WINDOW.glass.x,y:w.y+REAR_WINDOW.glass.y,w:REAR_WINDOW.glass.w,h:REAR_WINDOW.glass.h},onscreen:this.visible&&this.onscreen.has(w.id)})),people:this.actors.map(actor=>{const person=this.person(this.windows[actor.windowIndex],actor.personIndex);return {...person,frame:actor.frame,visible:this.visible&&actor.sprite.visible,interactive:Boolean(actor.sprite.input)};})};}
}
