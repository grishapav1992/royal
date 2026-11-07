import Phaser from 'phaser';
import {BAR_POSITION} from '../shared/furniture';
import {MiraRoutine,miraSeatAmount,type MiraAttention,type MiraView} from '../shared/miraRoutine';
import {NpcMotion} from '../network/NpcMotion';
import {MiraRig} from './MiraRig';
import {interpolateMiraProgress} from './miraAnimation';
import {drawRoyalBar} from './royalBarArt';

export class Bar {
  private routine=new MiraRoutine();
  private target?:MiraView;
  private motion=new NpcMotion<MiraView>({delayMs:0,isMoving:view=>view.action==='walk',interpolate:interpolateMiraProgress});
  private view:MiraView={...this.routine.state};
  private attention:MiraAttention='closed';
  private rig:MiraRig;
  private contact:Phaser.GameObjects.Ellipse;
  private steam:Phaser.GameObjects.Graphics;
  private lastDraw=-Infinity;
  constructor(private scene:Phaser.Scene,onSeat:(id:string)=>void,onOrder:()=>void){
    drawRoyalBar(scene,onSeat,onOrder);
    const{x,y}=BAR_POSITION;
    this.contact=scene.add.ellipse(x+51,y+111,25,4,0x231422,.4).setDepth(y+169).setVisible(false);
    this.rig=new MiraRig(scene);
    this.rig.render(this.view,false,scene.time.now,.033);
    this.steam=scene.add.graphics().setDepth(y+169);
  }
  sync(view:MiraView,at=performance.now()){this.target=view;this.motion.push(view,at);}
  resetMotion(){this.motion.reset();this.target=undefined;this.rig.reset();}
  setAttention(attention:MiraAttention){this.attention=attention;}
  getState(){return {...this.view,seatAmount:miraSeatAmount(this.view.action,this.view.progress),...this.rig.getState()};}
  update(serving:boolean,reducedMotion:boolean,conversation={active:false,speaking:false},delta=.016,online=false,renderAt=performance.now()){
    if(!online){this.routine.tick(delta,serving,conversation.active,this.attention);this.target={...this.routine.state};}
    const target=online?this.motion.sample(renderAt)??this.target??this.routine.state:this.target??this.routine.state;
    Object.assign(this.view,target);
    const seat=miraSeatAmount(target.action,target.progress);
    this.contact.setVisible(seat>.01).setAlpha(seat*.4);
    const time=this.scene.time.now;
    const drawEffects=time-this.lastDraw>=33;
    if(!drawEffects&&target.action!=='walk'&&target.action!=='wipe')return;
    const elapsed=Number.isFinite(this.lastDraw)?(time-this.lastDraw)/1000:.033;
    const guardListening=target.action==='chat'&&target.facing==='left'&&conversation.active&&!conversation.speaking;
    const action=guardListening||reducedMotion&&target.action==='greet'?'listen':target.action;
    this.rig.render({...target,action},reducedMotion,time,elapsed);
    if(!drawEffects)return;
    this.lastDraw=time;
    this.steam.clear();
    if(!reducedMotion){
      const{x,y}=BAR_POSITION;
      for(let n=0;n<2;n++){
        const rise=(time/1600+n*.5)%1;
        this.steam.lineStyle(.55,0xe8d3b1,(1-rise)*.3);
        this.steam.beginPath();this.steam.moveTo(x+128+n*3,y+100-rise*8);
        this.steam.lineTo(x+128+n*3+Math.sin(rise*5+n),y+96-rise*8);this.steam.strokePath();
      }
    }
  }
}
