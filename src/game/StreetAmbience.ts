import type { StreetView } from './streetView';
import type Phaser from 'phaser';
import { StreetLife, STREET_CARS } from './StreetLife';
import { CHARACTER_SCALE, characterTexture } from './characters';
import { advanceCharacterMotion, createCharacterMotion } from './characterAnimation';

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
    for(const car of STREET_CARS)this.cars.push(scene.add.image(0,car.y,'street-car-'+car.id).setOrigin(.5,1).setDisplaySize(190,78).setFlipX(car.direction<0).setDepth(car.y));
  }
  update(delta:number,overview:boolean,reducedMotion:boolean,view:StreetView){
    this.state=this.life.advance(delta,{paused:document.hidden,reducedMotion});
    this.state.pedestrians.forEach((person,index)=>{
      const actor=this.pedestrians[index],distance=Math.hypot(person.x-actor.x,person.y-actor.y);
      const motion=advanceCharacterMotion(actor.motion,{mode:person.moving?'walk':'rest',distance,time:this.state.time,normalSpeed:155});
      const p=view.point(person),visible=view.visible(person);
      actor.sprite.setPosition(p.x,p.y).setFrame(view.facing(person.facing)+'-'+motion.frame).setDepth(p.y).setVisible(visible);
      actor.shadow.setPosition(p.x,p.y-1).setDepth(p.y-1).setVisible(visible);
      actor.x=person.x;actor.y=person.y;
    });
    this.state.cars.forEach((car,index)=>{
      const p=view.point(car);
      this.cars[index].setDepth(p.y).setTexture((overview?'street-car-plan-':'street-car-')+car.id).setPosition(p.x,p.y).setVisible(car.visible&&view.visible(car));
    });
    return this.state.sign;
  }
  get count(){return this.pedestrians.length;}
  getState(){return this.state;}
}
