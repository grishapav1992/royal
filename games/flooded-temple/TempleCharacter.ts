import type {CharacterBeat} from './character';
import {templeReaction,type TemplePose,type TempleReaction} from './character';
import {TemplePortrait} from './TemplePortrait';
import {CharacterMotion} from './CharacterMotion';

type CharacterView={beat?:CharacterBeat;key:string;offset:number;waiting:boolean;rope:boolean;selected:boolean;reduced:boolean;paused:boolean;connected:boolean};
/** Owns one portrait and one frame callback across board renders. No reward queue. */
export class TempleCharacter{
  readonly element:HTMLElement;
  private portrait:TemplePortrait;
  private view:CharacterView={key:'',offset:0,waiting:false,rope:false,selected:false,reduced:true,paused:false,connected:false};
  private reaction:TempleReaction=templeReaction(undefined);
  private from:TemplePose='idle';
  private blendAt=-1000;
  private clock=0;
  private idle=0;
  private previous=0;
  private handle=0;
  private disposed=false;
  private clipKey='';
  private drawnAt=0;
  private motion={energy:0,look:0,gesture:0};
  private rig=new CharacterMotion();
  private transitions:{clip:string;pose:TemplePose;key:string}[]=[];
  constructor(doc:Document,en:boolean,private singlePose=false){
    this.element=doc.createElement('aside');this.element.className='ft-character';this.element.setAttribute('aria-label',en?'Temple explorer':'Исследовательница храма');
    this.portrait=new TemplePortrait(this.element,()=>this.draw());
  }
  update(view:CharacterView){
    if(this.disposed)return;
    const old=this.view;this.view=view;
    if(old.key!==view.key||old.waiting!==view.waiting||old.selected!==view.selected||old.rope!==view.rope)this.idle=0;
    if(view.reduced||view.paused||!view.connected){cancelAnimationFrame(this.handle);this.handle=0;this.previous=0;}
    if(!view.connected||view.reduced)this.rig.reset();else if(view.paused)this.rig.freeze();
    this.select();this.draw();
    if(!this.handle&&!view.reduced&&!view.paused&&view.connected){this.previous=0;this.handle=requestAnimationFrame(this.frame);}
  }
  private select(){
    const v=this.view,idleVariant=this.idle%24000>17000?2:this.idle%24000>10500&&this.idle%24000<13700?1:0;
    const reaction=v.connected?templeReaction(v.beat,v.waiting,v.rope,v.selected,idleVariant):templeReaction(undefined);
    const key=(v.beat?v.key+':'+v.beat.id:'idle')+':'+reaction.clip;
    if(key===this.clipKey)return;
    this.clipKey=key;this.from=v.connected?this.reaction.pose:'idle';this.reaction=reaction;this.blendAt=v.reduced||!v.connected?this.clock-240:this.clock;
    this.element.dataset.reaction=reaction.clip;this.element.dataset.pose=reaction.pose;
    if(this.singlePose)this.rig.select(key,reaction,v.beat);
    this.transitions.push({clip:reaction.clip,pose:reaction.pose,key});if(this.transitions.length>32)this.transitions.shift();
  }
  private frame=(now:number)=>{
    this.handle=0;if(this.disposed||this.view.paused||this.view.reduced||!this.view.connected)return;
    const dt=this.previous?Math.min(80,now-this.previous):0;this.previous=now;this.clock+=dt;
    if(!this.view.beat&&!this.view.waiting&&!this.view.selected&&!this.view.rope)this.idle+=dt;
    this.select();this.draw();this.handle=requestAnimationFrame(this.frame);
  };
  private draw(){
    if(this.disposed||!this.portrait)return;
    const v=this.view,p=v.beat?Math.min(1,Math.max(0,v.offset/v.beat.duration)):this.idle%7000/7000;
    const gesture=Math.sin(p*Math.PI)*(this.reaction.clip==='triumph'?1+.15*Math.sin(p*Math.PI*4):1);
    const blend=v.reduced||v.paused&&!v.beat?1:Math.min(1,Math.max(0,(this.clock-this.blendAt)/220));
    if(this.singlePose){
      const dt=v.paused||v.reduced||!v.connected?0:Math.max(0,this.clock-this.drawnAt);
      this.drawnAt=this.clock;
      const pose=this.rig.step(dt,this.clock,v.offset);
      this.motion={energy:this.reaction.energy,look:pose.gaze,gesture:pose.lift};
      this.portrait.draw('idle','idle',1,this.reaction,this.clock,gesture,!v.reduced&&v.connected,pose);
    }else this.portrait.draw(this.from,this.reaction.pose,blend,this.reaction,this.clock,gesture,!v.reduced&&v.connected);
  }
  tick(beat:CharacterBeat,offset:number){this.view.beat=beat;this.view.offset=offset;this.draw();}
  getState(){return {clip:this.reaction.clip,poseBlendMode:this.singlePose?'anchored-mesh':'crossfade',motion:{...this.motion},rig:this.singlePose?this.rig.getState():undefined,clockMs:this.clock,idleMs:this.idle,framePending:!!this.handle,paused:this.view.paused,reduced:this.view.reduced,transitions:this.transitions.slice(),...this.portrait.getState(),disposed:this.disposed};}
  destroy(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.handle);this.handle=0;this.portrait.destroy();this.element.remove();}
}
