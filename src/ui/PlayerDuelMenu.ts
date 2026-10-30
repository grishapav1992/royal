import type { RoomScene } from '../game/RoomScene';
import type { PvpClient } from '../network/PvpClient';
import type { PlayerView } from '../shared/world';
import { PVP_PLAYER_DISTANCE } from '../shared/tsuEFa';
import { language } from '../i18n/index';
import './pvp-invitations.css';

const copy=(ru:string,en:string)=>language==='en'?en:ru;
export class PlayerDuelMenu {
  private menu=document.createElement('dialog');
  private players:PlayerView[]=[];private self='';private selected='';private approaching='';private approachUntil=0;
  private title=document.createElement('h2');private status=document.createElement('p');
  private invite=document.createElement('button');private approach=document.createElement('button');
  private prior;private handler=(id:string)=>this.open(id);
  constructor(private scene:RoomScene,private client:PvpClient,offer:(account:string)=>void){
    this.prior=scene.onPlayer;scene.onPlayer=this.handler;
    this.menu.id='player-actions';this.menu.className='player-duel-menu';this.title.id='player-actions-title';this.menu.setAttribute('aria-labelledby',this.title.id);
    this.invite.type=this.approach.type='button';this.invite.dataset.playerInvite='';this.approach.dataset.playerApproach='';
    this.invite.textContent=copy('Предложить «Цу-е-фа»','Invite to Rock Paper Scissors');this.approach.textContent=copy('Подойти к игроку','Walk to player');
    this.invite.onclick=()=>{const person=this.client.snapshot?.people.find(p=>p.sessionId===this.selected);if(!person||this.invite.disabled)return;this.menu.close();offer(person.accountId);};
    this.approach.onclick=()=>{const target=this.players.find(p=>p.id===this.selected);if(!target)return;this.approaching=target.id;this.approachUntil=Date.now()+20000;this.menu.close();this.scene.goTo({x:target.x,y:target.y+35});};
    const close=document.createElement('button');close.type='button';close.textContent=copy('Закрыть','Close');close.onclick=()=>this.menu.close();
    this.menu.append(this.title,this.status,this.invite,this.approach,close);document.body.append(this.menu);
    this.menu.addEventListener('close',()=>scene.setLocked(!!document.querySelector('dialog[open]')));
  }
  update(players:PlayerView[],self:string){this.players=players;this.self=self;this.refresh();}
  open(id:string){
    if(id===this.self||!this.players.some(p=>p.id===id&&p.connected)||document.querySelector('dialog[open]'))return;
    this.selected=id;this.refresh();this.scene.finishMovement(()=>{});this.scene.setLocked(true);this.menu.showModal();
  }
  tick(){
    if(this.menu.open)this.refresh();
    if(!this.approaching)return;
    const target=this.players.find(p=>p.id===this.approaching&&p.connected&&p.hall===this.scene.hall);
    if(!target||Date.now()>this.approachUntil){this.approaching='';return;}
    if(Math.hypot(this.scene.player.x-target.x,this.scene.player.y-target.y)<PVP_PLAYER_DISTANCE-20){const id=this.approaching;this.approaching='';this.open(id);}
  }
  private refresh(){
    const target=this.players.find(p=>p.id===this.selected),person=this.client.snapshot?.people.find(p=>p.sessionId===this.selected);
    const near=!!target&&target.hall===this.scene.hall&&Math.hypot(this.scene.player.x-target.x,this.scene.player.y-target.y)<PVP_PLAYER_DISTANCE-20;
    const busy=!!this.client.snapshot?.active&&['open','arriving','playing'].includes(this.client.snapshot.active.status);
    this.title.textContent=target?.name??copy('Игрок вышел из зала','Player left the hall');
    this.invite.disabled=!near||!person?.available||!target?.connected||busy||!this.client.connected;
    this.approach.hidden=near||!target||target.hall!==this.scene.hall;this.approach.disabled=busy;
    this.status.textContent=busy?copy('Сначала заверши текущий поединок.','Finish your current duel first.')
      :!target?.connected?copy('Игрок сейчас не в сети.','Player is offline.')
      :target.hall!==this.scene.hall?copy('Игрок находится на другом этаже.','Player is on another floor.')
      :!near?copy('Подойди ближе, чтобы предложить сыграть.','Walk closer to invite this player.')
      :!person?.available?copy('Игрок сейчас занят.','Player is busy.')
      :copy('Выбери бесплатную игру или ставку и отправь приглашение.','Choose free play or a stake and send an invitation.');
  }
  reset(){this.approaching='';this.menu.close();}
  destroy(){this.reset();this.menu.remove();if(this.scene.onPlayer===this.handler)this.scene.onPlayer=this.prior;}
}
