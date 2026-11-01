import type Phaser from 'phaser';
import { t } from '../i18n';
import { CHARACTER_SCALE, characterTexture } from './characters';
import { STREET_RESIDENTS, StreetConversations, type StreetResidentId, type StreetVisitor } from './streetDetails';
import './street-residents.css';
import { streetResidentPose, type StreetResidentPose } from './StreetResidentActions';
import { createStreetMascotTexture, drawMascotArms, drawResidentShovel, drawTaxiHabit, drawTouristCamera } from './streetResidentArt';
import { StreetResidentPatrols, STREET_WORK_PATCHES } from './StreetResidentPatrols';
import { advanceCharacterMotion, createCharacterMotion } from './characterAnimation';
import type { Point } from './navigation';

export class StreetResidents {
  private conversations=new StreetConversations();
  private patrols=new StreetResidentPatrols();
  private locations=this.patrols.snapshot();
  private actors:{sprite:Phaser.GameObjects.Sprite;shadow:Phaser.GameObjects.Ellipse;zone:Phaser.GameObjects.Zone;tool:Phaser.GameObjects.Graphics;label:Phaser.GameObjects.Text;greeting?:Phaser.GameObjects.Text;motion:ReturnType<typeof createCharacterMotion>;x:number;y:number}[]=[];
  private lastTime=0;
  private prepared:StreetResidentId|null=null;
  private snow:Phaser.GameObjects.Graphics;
  private cleared=new Map<number,number>();
  private root=document.createElement('aside');
  private name=document.createElement('strong');
  private role=document.createElement('span');
  private line=document.createElement('p');
  private talkButton=document.createElement('button');
  private nextButton=document.createElement('button');
  private closeButton=document.createElement('button');
  private renderKey='';
  private dismissed:StreetResidentId|null=null;
  private returnFocus:()=>void;
  private poses=new Map<StreetResidentId,StreetResidentPose>();
  private escape=(event:KeyboardEvent)=>{
    if(event.key==='Escape'&&this.conversations.snapshot().conversation){this.dismiss();event.preventDefault();}
  };
  constructor(scene:Phaser.Scene,approach:(id:StreetResidentId)=>void){
    this.returnFocus=()=>scene.game.canvas.focus({preventScroll:true});
    this.snow=scene.add.graphics().setDepth(.02);
    for(const person of STREET_RESIDENTS){
      const mascot=person.id==='mascot';
      const position=this.locations.find(p=>p.id===person.id)!;
      const shadow=scene.add.ellipse(position.x,position.y-1,mascot?46:29,10,0x27202c,.15).setDepth(position.y-1);
      const sprite=scene.add.sprite(position.x,position.y,mascot?createStreetMascotTexture(scene):characterTexture(scene,0,person.appearance),mascot?6:person.facing+'-6')
        .setOrigin(.5,1).setScale(mascot ? 0.5 : CHARACTER_SCALE).setDepth(position.y);
      const tool=scene.add.graphics().setPosition(position.x,position.y).setDepth(position.y+.1);
      const label=scene.add.text(position.x,position.y-(mascot?113:91),t(person.name),{fontFamily:'Arial',fontSize:'10px',color:'#f5dfaa',backgroundColor:'#302832e8',padding:{x:6,y:4}}).setOrigin(.5,1).setDepth(3000);
      const zone=scene.add.zone(position.x,position.y-(mascot?53:40),mascot?104:62,mascot?110:86).setDepth(position.y+3).setInteractive({useHandCursor:true}).on('pointerdown',()=>approach(person.id));
      const greeting=mascot?scene.add.text(position.x,position.y-131,t('Добро пожаловать!'),{fontFamily:'Arial',fontSize:'11px',color:'#5c3b25',backgroundColor:'#fff0c9',padding:{x:6,y:4}}).setOrigin(.5,1).setDepth(3001).setVisible(false):undefined;
      this.actors.push({sprite,shadow,zone,tool,label,greeting,motion:createCharacterMotion(),x:position.x,y:position.y});
    }
    this.root.className='street-conversation';this.root.hidden=true;
    this.root.setAttribute('aria-label',t('Персонажи улицы'));
    this.line.setAttribute('aria-live','polite');
    const heading=document.createElement('div');heading.className='street-conversation-heading';heading.append(this.name,this.role);
    const actions=document.createElement('div');actions.className='street-conversation-actions';
    for(const button of [this.talkButton,this.nextButton,this.closeButton])button.type='button';
    this.talkButton.textContent=t('Поговорить');this.nextButton.textContent=t('Ещё');this.closeButton.textContent=t('Закрыть');
    this.talkButton.onclick=()=>{const id=this.conversations.snapshot().nearby;if(id)approach(id);};
    this.nextButton.onclick=()=>{this.conversations.next();this.render();};
    this.closeButton.onclick=()=>this.dismiss();
    actions.append(this.talkButton,this.nextButton,this.closeButton);this.root.append(heading,this.line,actions);
    document.querySelector('.room-panel')!.append(this.root);
    document.addEventListener('keydown',this.escape);
    scene.events.once('shutdown',()=>{document.removeEventListener('keydown',this.escape);this.root.remove();});
  }
  setActive(active:boolean){if(!active)this.prepared=null;this.conversations.update({x:0,y:0},active,this.locations);this.render();}
  update(player:StreetVisitor,time:number,motion:boolean,overview:boolean,passers:readonly Point[],approaching?:StreetResidentId){
    this.prepared=approaching??null;
    this.conversations.update(player,true,this.locations);
    const talkingId=this.conversations.snapshot().conversation;
    const frozen=[this.prepared,talkingId].filter((id):id is StreetResidentId=>Boolean(id));
    this.locations=this.patrols.advance(time-this.lastTime,{motion,frozen,passers});this.lastTime=time;
    this.conversations.update(player,true,this.locations);
    STREET_RESIDENTS.forEach((person,index)=>{
      const actor=this.actors[index],position=this.locations[index],mascot=person.id==='mascot';
      const talking=this.conversations.snapshot().conversation===person.id;
      const walking=advanceCharacterMotion(actor.motion,{mode:position.moving?'walk':'rest',distance:Math.hypot(position.x-actor.x,position.y-actor.y),time,normalSpeed:155});
      const canAct=motion&&!talking&&this.prepared!==person.id;
      let pose=streetResidentPose(person.id,position.workTime,canAct,talking);
      if(position.moving)pose={action:'walk',progress:actor.motion.distance/77.5,frame:walking.frame,facing:position.facing};
      if(position.greeting)pose={action:'greet',progress:position.greetingProgress,frame:6};
      else if(mascot&&canAct&&!position.moving)pose={action:'pose',progress:pose.progress,frame:6};
      if(person.id==='tourist'&&(pose.action==='frame-photo'||pose.action==='take-photo'))pose.facing=position.facing;
      this.poses.set(person.id,pose);
      actor.sprite.setPosition(position.x,position.y).setDepth(position.y).setFrame(mascot?position.moving?walking.frame:6:(talking?'down':pose.facing??position.facing)+'-'+pose.frame);
      actor.shadow.setPosition(position.x,position.y-1).setDepth(position.y-1);
      actor.tool.setPosition(position.x,position.y).setDepth(position.y+.1);
      actor.zone.setPosition(position.x,position.y-(mascot?53:40)).setDepth(position.y+3);
      actor.label.setPosition(position.x,position.y-(mascot?113:91)).setVisible(!overview&&Math.hypot(player.x-position.x,player.y-position.y)<195);
      actor.greeting?.setPosition(position.x,position.y-131).setVisible(!overview&&position.greeting&&Math.hypot(player.x-position.x,player.y-position.y)<500);
      actor.x=position.x;actor.y=position.y;
      actor.tool.clear();
      if(person.id==='doorman'){
        actor.tool.fillStyle(0xf6cf58).fillRect(-14,-71,28,2).fillCircle(8,-35,2);
        for(const y of [-32,-23])for(const x of [-5,5])actor.tool.fillCircle(x,y,1.3);
      }
      if(person.id==='janitor'){
        drawResidentShovel(actor.tool,pose);
      }
      if(person.id==='taxi-driver')drawTaxiHabit(actor.tool,pose);
      if(person.id==='tourist')drawTouristCamera(actor.tool,pose);
      if(person.id==='mascot')drawMascotArms(actor.tool,pose);
    });
    const worker=this.locations.find(p=>p.id==='janitor')!;
    if(motion&&!worker.moving)this.cleared.set(worker.stop,Math.max(this.cleared.get(worker.stop)??0,Math.min(1,worker.workTime/9000)));
    this.snow.clear();
    STREET_WORK_PATCHES.forEach((patch,index)=>{
      const cleared=this.cleared.get(index)??0;
      this.snow.fillStyle(0xf8fbff).fillEllipse(patch.x,patch.y,48-cleared*36,15-cleared*7).fillEllipse(patch.x-10,patch.y-4,22-cleared*16,10-cleared*5);
    });
    this.render();
  }
  prepareApproach(id:StreetResidentId,player:Point){
    const point=this.patrols.approach(id,player);
    if(point){this.conversations.close();this.prepared=id;this.render();}
    return point;
  }
  interact(player:StreetVisitor,id?:StreetResidentId){
    this.conversations.update(player,true,this.locations);
    const target=id??this.conversations.snapshot().nearby;
    const accepted=target?this.conversations.talk(target):false;
    if(accepted)this.dismissed=null;this.render();return accepted;
  }
  private dismiss(){this.dismissed=this.conversations.snapshot().nearby;this.conversations.close();this.render();this.returnFocus();}
  private render(){
    const state=this.conversations.snapshot(),id=state.conversation??state.nearby;
    if(state.nearby!==this.dismissed)this.dismissed=null;
    const key=JSON.stringify([state,this.dismissed]);if(key===this.renderKey)return;this.renderKey=key;
    this.root.hidden=!state.active||!id||(!state.conversation&&id===this.dismissed);
    this.root.dataset.resident=id??'';this.root.dataset.speaking=String(Boolean(state.conversation));
    if(!id)return;
    const person=STREET_RESIDENTS.find(p=>p.id===id)!;
    this.name.textContent=t(person.name);this.role.textContent=t(person.role);
    this.line.hidden=!state.conversation;this.line.textContent=state.conversation?t(person.lines[state.line]):'';
    this.talkButton.hidden=Boolean(state.conversation);this.nextButton.hidden=!state.conversation;
  }
  get count(){return STREET_RESIDENTS.length;}
  get textureKeys(){return this.actors.map(actor=>actor.sprite.texture.key);}
  getState(){return {...this.conversations.snapshot(),approaching:this.prepared,people:this.locations.map(p=>({...p,activity:this.poses.get(p.id)?.action??'idle',progress:this.poses.get(p.id)?.progress??0}))};}
}
