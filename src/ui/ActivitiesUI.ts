import { registerGameChatDialog } from './GameChat';
import { t as translateText } from '../i18n/index';
import { activityHall, type PlayerView } from '../shared/world';
import { HOCKEY_PADDLE_RADIUS } from '../shared/hockey';
import { ACTIVITIES, CHESS_TIME_MS, type ActivityId, type ActivitiesState, type PianoNote } from '../shared/activities';
import { gameAudio, type Sound } from '../game/GameAudio';
import type { RoomScene } from '../game/RoomScene';
import { PianoAudio } from '../game/PianoAudio';
import { IndependentGameUI } from '../modules/IndependentGameUI';
import type { ActivityHostContext } from '../modules/ActivityHostContract';

type ViewState = { hockey: { local: unknown; rendered: unknown[]; puck: unknown; radius: number }; charge: { charging: boolean; power: number }; frames: number };

/** The room owns network state and ambient sound; each open activity owns its view. */
export class ActivitiesUI {
 private state:ActivitiesState={tables:[],pianist:'',notes:[],chess:{players:[],phase:'waiting',turn:'w',board:[],moves:[],last:null,check:false,winner:'',message:'',ready:[],revision:0,sound:'',clock:{remainingMs:[CHESS_TIME_MS,CHESS_TIME_MS],running:null}}};
 private players:PlayerView[]=[];
 private self='';
 private selected:ActivityId='hockey';
 private audio=new PianoAudio();
 private mute:HTMLButtonElement;
 private cards:HTMLDivElement;
 private view?:IndependentGameUI;
 private context?:ActivityHostContext;
 private shell?:HTMLDialogElement;
 private chatCleanup?:()=>void;
 private events=new AbortController();
 private lastView:ViewState={hockey:{local:null,rendered:[undefined,undefined],puck:undefined,radius:HOCKEY_PADDLE_RADIUS},charge:{charging:false,power:550},frames:0};
 private activity=(id:ActivityId)=>this.open(id);
 constructor(private scene:RoomScene,private send:(value:unknown)=>void){
  this.cards=document.createElement('div');this.cards.className='shared-cards';
  this.cards.innerHTML=(['hockey','pool','chess','piano','mortal-kombat'] as const).map(id=>`<button type="button" data-activity="${id}"><span>${id==='mortal-kombat'?'⚔':id==='piano'?'♫':id==='pool'?'●':id==='chess'?'♞':'◎'}</span><strong>${ACTIVITIES[id].name}</strong><small>${id==='piano'?translateText('Музыка для всех'):translateText('2 игрока · можно наблюдать')}</small></button>`).join('');
  document.querySelector('.cabinet-list')!.before(this.cards);
  this.cards.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach(button=>button.addEventListener('click',()=>scene.approachActivity(button.dataset.activity as ActivityId),{signal:this.events.signal}));
  this.mute=document.createElement('button');this.mute.id='mute-piano';this.mute.className='invite-button piano-mute';this.mute.type='button';
  try{this.audio.mute(localStorage.getItem('royal-piano-muted')==='1');}catch{}
  this.updateMute();document.querySelector('#piano-sound-setting')!.append(this.mute);
  this.mute.addEventListener('click',()=>this.toggleMute(),{signal:this.events.signal});
  document.addEventListener('pointerdown',()=>{void this.audio.unlock();},{capture:true,signal:this.events.signal});
  document.addEventListener('keydown',()=>{void this.audio.unlock();},{capture:true,signal:this.events.signal});
  scene.onActivity=this.activity;
 }
 hallChanged(){this.view?.hallChanged();this.audio.stop();}
 connected(){this.send({type:'ears',muted:this.audio.muted});}
 disconnected(){this.view?.hallChanged();this.audio.stop();this.close();}
 updatePlayers(players:PlayerView[],self:string){this.players=players;this.self=self;if(this.context){this.context.players=players;this.context.self=self;}this.view?.updatePlayers(players,self);}
 update(state:ActivitiesState){
  const old=this.state;this.state=state;if(this.context)this.context.state=state;
  this.view?.update(state);
  if(old.pianist&&old.pianist!==state.pianist)this.audio.stop();
  for(const table of state.tables){const prior=old.tables.find(value=>value.id===table.id);if(this.scene.hall==='tables'&&prior&&table.sound.seq!==prior.sound.seq){
   const entry=ACTIVITIES[table.id].entry,dist=Math.hypot(this.scene.player.x-entry.x,this.scene.player.y-entry.y);
   gameAudio.effect(table.sound.kind as Sound,this.shell?.open?(this.selected===table.id?1:.08):Math.max(.05,.35-dist/2000),table.id);
  }}
  if(state.chess.revision!==old.chess.revision&&state.chess.sound&&this.shell?.open&&this.selected==='chess')gameAudio.effect(state.chess.sound as Sound,1,'chess');
 }
 receive(note:PianoNote){
  if(this.scene.hall!=='arcade')return;
  if(note.player!==this.self)this.audio.note(note.note,note.down);
  this.view?.receive(note);
  if(note.down)this.scene.pianoNote(note.note);
 }
 getState(){const current=this.view?.getState() as ViewState|undefined;return{...(current??this.lastView),...this.state,selected:this.selected,open:!!this.shell?.open,audio:this.audio.getState()};}
 private toggleMute(){void this.audio.unlock();this.audio.mute(!this.audio.muted);this.updateMute();this.send({type:'ears',muted:this.audio.muted});try{localStorage.setItem('royal-piano-muted',this.audio.muted?'1':'0');}catch{}}
 private updateMute(){this.mute.textContent=this.audio.muted?translateText('Включить рояль'):translateText('Рояль включён');this.mute.setAttribute('aria-pressed',String(this.audio.muted));this.mute.setAttribute('aria-label',this.audio.muted?translateText('Включить рояль'):translateText('Отключить рояль'));}
 private open(id:ActivityId){
  if(activityHall(id)!==this.scene.hall)return;
  this.close();this.selected=id;this.scene.setLocked(true);gameAudio.setGame(id);
  const shell=document.createElement('dialog');shell.id='shared-dialog';shell.className='shared-dialog';shell.dataset.activityShell='';shell.dataset.game=id;
  const close=document.createElement('button');close.type='button';close.dataset.activityLoadingClose='';close.textContent='×';close.setAttribute('aria-label',translateText('Вернуться в зал'));close.onclick=()=>this.close();
  const host=document.createElement('div');host.className='activity-module-content';shell.append(close,host);document.body.append(shell);this.shell=shell;
  if(id==='mortal-kombat')this.chatCleanup=registerGameChatDialog(shell);
  shell.addEventListener('close',()=>{if(this.shell===shell)this.close();});
  const context:ActivityHostContext={scene:this.scene,send:this.send,state:this.state,players:this.players,self:this.self,pianoAudio:this.audio,shotPower:this.lastView.charge.power,onClose:()=>{if(this.shell===shell)this.close();}};
  this.context=context;this.view=new IndependentGameUI(host,id,{activity:context});
  this.view.update(this.state);this.view.updatePlayers(this.players,this.self);shell.showModal();void this.audio.unlock();
 }
 private close(){
  const view=this.view,shell=this.shell;if(!view&&!shell)return;
  this.lastView=(view?.getState() as ViewState|undefined)??this.lastView;
  this.lastView={...this.lastView,charge:{...this.lastView.charge,charging:false}};
  this.view=undefined;this.context=undefined;this.shell=undefined;view?.destroy();this.chatCleanup?.();this.chatCleanup=undefined;shell?.remove();
  gameAudio.setGame('');this.send({type:'leave'});this.scene.setLocked(Boolean(document.querySelector('dialog[open]')));document.querySelector<HTMLElement>('#game')?.focus({preventScroll:true});
 }
 destroy(){this.close();this.audio.stop();this.events.abort();this.cards.remove();this.mute.remove();if(this.scene.onActivity===this.activity)this.scene.onActivity=()=>{};}
}
