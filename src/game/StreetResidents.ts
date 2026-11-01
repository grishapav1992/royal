import type Phaser from 'phaser';
import { t } from '../i18n';
import { CHARACTER_SCALE, characterTexture } from './characters';
import { STREET_RESIDENTS, StreetConversations, type StreetResidentId, type StreetVisitor } from './streetDetails';
import './street-residents.css';

export class StreetResidents {
  private conversations=new StreetConversations();
  private actors:{sprite:Phaser.GameObjects.Sprite;tool:Phaser.GameObjects.Graphics;label:Phaser.GameObjects.Text}[]=[];
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
  private escape=(event:KeyboardEvent)=>{
    if(event.key==='Escape'&&this.conversations.snapshot().conversation){this.dismiss();event.preventDefault();}
  };
  constructor(scene:Phaser.Scene,approach:(id:StreetResidentId)=>void){
    this.returnFocus=()=>scene.game.canvas.focus({preventScroll:true});
    for(const person of STREET_RESIDENTS){
      scene.add.ellipse(person.x,person.y-1,29,10,0x27202c,.15).setDepth(person.y-1);
      const sprite=scene.add.sprite(person.x,person.y,characterTexture(scene,0,person.appearance),person.facing+'-6')
        .setOrigin(.5,1).setScale(CHARACTER_SCALE).setDepth(person.y);
      const tool=scene.add.graphics().setPosition(person.x,person.y).setDepth(person.y+.1);
      const label=scene.add.text(person.x,person.y-91,t(person.name),{fontFamily:'Arial',fontSize:'10px',color:'#f5dfaa',backgroundColor:'#302832e8',padding:{x:6,y:4}}).setOrigin(.5,1).setDepth(person.y+2);
      scene.add.zone(person.x,person.y-40,62,86).setDepth(person.y+3).setInteractive({useHandCursor:true}).on('pointerdown',()=>approach(person.id));
      this.actors.push({sprite,tool,label});
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
  setActive(active:boolean){this.conversations.update({x:0,y:0},active);this.render();}
  update(player:StreetVisitor,time:number,motion:boolean,overview:boolean){
    this.conversations.update(player,true);
    STREET_RESIDENTS.forEach((person,index)=>{
      const actor=this.actors[index],phase=time%(person.id==='doorman'?9600:person.id==='janitor'?6400:14000);
      const talking=this.conversations.snapshot().conversation===person.id;
      let frame=6;
      if(motion&&!talking){
        if(person.id==='doorman'&&phase<1300)frame=7;
        if(person.id==='taxi-driver'&&phase<3000)frame=11+Math.floor(phase/500);
      }
      actor.sprite.setFrame((talking?'down':person.facing)+'-'+frame);
      actor.label.setVisible(!overview&&Math.hypot(player.x-person.x,player.y-person.y)<195);
      actor.tool.clear();
      if(person.id==='doorman'){
        actor.tool.fillStyle(0xf6cf58).fillRect(-14,-71,28,2).fillCircle(8,-35,2);
        for(const y of [-32,-23])for(const x of [-5,5])actor.tool.fillCircle(x,y,1.3);
      }
      if(person.id==='janitor'){
        const push=motion&&!talking?Math.sin(Math.min(1,phase/2700)*Math.PI)*8:0;
        actor.tool.lineStyle(3,0x312a2c).lineBetween(13,-41,30+push,-5);
        actor.tool.lineStyle(1.4,0xa8794b).lineBetween(13,-41,30+push,-5);
        actor.tool.lineStyle(2,0x463b34).strokeRoundedRect(8,-48,11,8,2);
        actor.tool.fillStyle(0x8e9a9e).fillRoundedRect(22+push,-9,21,11,3);
        actor.tool.lineStyle(1.5,0x364148).strokeRoundedRect(22+push,-9,21,11,3);
        actor.tool.fillStyle(0xf8fbff).fillEllipse(35+push,1,23,5);
      }
    });
    this.render();
  }
  interact(player:StreetVisitor,id?:StreetResidentId){
    this.conversations.update(player,true);
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
  getState(){return {...this.conversations.snapshot(),people:STREET_RESIDENTS.map(({id,x,y})=>({id,x,y}))};}
}
