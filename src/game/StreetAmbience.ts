import type { StreetView } from './streetView';
import type Phaser from 'phaser';
import { StreetLife, STREET_CARS } from './StreetLife';
import { CHARACTER_SCALE, characterTexture } from './characters';
import { advanceCharacterMotion, createCharacterMotion } from './characterAnimation';

const CAR_WIDTH=190, CAR_HEIGHT=78, REAR_CAR_SCALE=.625;

export class StreetAmbience {
  private life=new StreetLife();
  private pedestrians: {sprite:Phaser.GameObjects.Sprite;shadow:Phaser.GameObjects.Ellipse;motion:ReturnType<typeof createCharacterMotion>;x:number;y:number}[]=[];
  private cars: Phaser.GameObjects.Image[]=[];
  private state=this.life.snapshot();
  constructor(scene:Phaser.Scene){
    for(const person of this.state.pedestrians){
      const shadow=scene.add.ellipse(person.x,person.y-1,29,10,0x27202c,.15).setDepth(person.y-1);
      const sprite=scene.add.sprite(person.x,person.y,characterTexture(scene,person.skin),person.facing+'-6').setOrigin(.5,1).setScale(CHARACTER_SCALE).setDepth(person.y);
      this.pedestrians.push({sprite,shadow,motion:createCharacterMotion(),x:person.x,y:person.y});
    }
    for(const car of STREET_CARS)this.cars.push(scene.add.image(0,car.y,'street-car-'+car.id).setOrigin(.5,1).setDisplaySize(CAR_WIDTH,CAR_HEIGHT).setFlipX(car.direction<0).setDepth(car.y));
  }
  update(delta:number,overview:boolean,reducedMotion:boolean,view:StreetView){
    this.state=this.life.advance(delta,{paused:document.hidden,reducedMotion});
    this.state.pedestrians.forEach((person,index)=>{
      const actor=this.pedestrians[index],distance=Math.hypot(person.x-actor.x,person.y-actor.y);
      const motion=advanceCharacterMotion(actor.motion,{mode:person.moving?'walk':'rest',distance,time:this.state.time,normalSpeed:155});
      const p=view.point(person),visible=view.visible(person),depth=view.depth(person);
      actor.sprite.setPosition(p.x,p.y).setFrame(view.facing(person.facing)+'-'+motion.frame).setDepth(depth).setVisible(visible);
      actor.shadow.setPosition(p.x,p.y-1).setDepth(depth-1).setVisible(visible);
      actor.x=person.x;actor.y=person.y;
    });
    const rear=view.orientation==='rear',scale=rear?REAR_CAR_SCALE:1;
    this.state.cars.forEach((car,index)=>{
      const p=view.point(car);
      // The projected bottom anchor becomes the top of the old footprint. Center the smaller car in that lane.
      const y=rear?p.y+(CAR_HEIGHT+CAR_HEIGHT*scale)/2:p.y;
      this.cars[index].setTexture((overview?'street-car-plan-':'street-car-')+car.id)
        .setDisplaySize(CAR_WIDTH*scale,CAR_HEIGHT*scale).setFlipX((car.direction<0)!==rear)
        .setPosition(p.x,y).setDepth(y).setVisible(car.visible);
    });
    return this.state.sign;
  }
  get count(){return this.pedestrians.length;}
  get characterBounds(){return this.pedestrians.map(({sprite})=>{const b=sprite.getBounds();return {x:sprite.x,y:sprite.y,depth:sprite.depth,visible:sprite.visible,left:b.left,right:b.right,top:b.top,bottom:b.bottom};});}
  get carRender(){return this.cars.map(image=>({x:image.x,y:image.y,height:image.displayHeight,angle:image.angle,flipX:image.flipX,depth:image.depth,visible:image.visible}));}
  getState(){return this.state;}
}
