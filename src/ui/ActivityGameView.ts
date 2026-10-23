import { t as translateText, tr } from '../i18n/index';
import { clampPaddle, stepPaddle, stepHockeyPuck, keepPaddleClearOfServe, HOCKEY_PADDLE_RADIUS, HOCKEY_KEYBOARD_SPEED, type HockeyPoint, type HockeyPuck } from '../shared/hockey';
import { defaultCuePosition } from '../shared/pool';
import type { ChessBoard } from './ChessBoard';
import type { TableRenderer } from './TableRenderer';
import '../table-games.css';
import { gameAudio } from '../game/GameAudio';
import { ACTIVITIES, CHESS_TIME_MS, PIANO_NOTES, type ActivityId, type ActivitiesState, type PianoNote, type TableState } from '../shared/activities';
import type { PlayerView } from '../shared/world';
import type { ActivityHostContext } from '../modules/ActivityHostContract';
import type { PianoAudio } from '../game/PianoAudio';
const keyNotes='awsedftgyhujkolp;';
const keyCodes=Array.from(keyNotes,k=>k===';'?'Semicolon':'Key'+k.toUpperCase());
const noteNames=[translateText('До'),translateText('До♯'),translateText('Ре'),translateText('Ре♯'),translateText('Ми'),translateText('Фа'),translateText('Фа♯'),translateText('Соль'),translateText('Соль♯'),translateText('Ля'),translateText('Ля♯'),translateText('Си')];
export interface ActivityViewFactories {
 table?(canvas: HTMLCanvasElement): TableRenderer;
 chess?(send: (value: unknown) => void): ChessBoard;
}
export class ActivityGameView {
  private destroyed=false;
  private frame=0;
  private events=new AbortController();
  private scene:ActivityHostContext['scene'];
  private send:ActivityHostContext['send'];
  private state:ActivitiesState={tables:[],pianist:'',notes:[],chess:{players:[],phase:'waiting',turn:'w',board:[],moves:[],last:null,check:false,winner:'',message:'',ready:[],revision:0,sound:'',clock:{remainingMs:[CHESS_TIME_MS,CHESS_TIME_MS],running:null}}};
  private players:PlayerView[]=[];
  private self='';
  private selected:ActivityId='hockey';
  private dialog:HTMLDialogElement;
  private canvas:HTMLCanvasElement;
  private renderer?:TableRenderer;
  private scoreboard:HTMLDivElement;
  private piano:HTMLDivElement;
  private status:HTMLElement;
  private calledPocket:HTMLSelectElement;
  private rematch:HTMLButtonElement;
  private shoot:HTMLButtonElement;
  private placeCue:HTMLButtonElement;
  private power:HTMLInputElement;
  private audio:PianoAudio;
  private held=new Set<number>();
  private keys=new Set<string>();
  private angle=0;
  private pointer={x:100,y:200};
  private lastSend=0;
  private lastFrame=0;
  private localPaddle:HockeyPoint|null=null;
  private localPuck:HockeyPuck|null=null;
  private serveRemaining=0;
  private lastPaddleTarget:HockeyPoint|null=null;
  private hockeyRound='';
  private visuals=new Map<string,{x:number;y:number}>();
  private frames=0;
  private reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private chess?:ChessBoard;
  private chargeStart:number|null=null;
  private shotPending=false;
  private powerValue:HTMLOutputElement;
  constructor(private host:HTMLElement,id:ActivityId,private context:ActivityHostContext,factories:ActivityViewFactories={}){
    this.scene=context.scene;this.send=context.send;this.audio=context.pianoAudio;this.state=context.state;this.players=context.players;this.self=context.self;this.selected=id;
    const shell=host.closest<HTMLDialogElement>('dialog[data-activity-shell]');
    this.dialog=shell??document.createElement('dialog');this.dialog.id='shared-dialog';this.dialog.classList.add('shared-dialog');this.dialog.setAttribute('aria-labelledby','shared-title');
    const content=shell?host:this.dialog;
    content.innerHTML=translateText('<div class="shared-top"><div><h2 id="shared-title"></h2></div><button type="button" id="shared-close" aria-label="Вернуться в зал">×</button></div><p id="shared-status" role="status"></p><p id="shared-rules"></p><canvas id="shared-canvas" width="720" height="400" tabindex="0" aria-label="Игровой стол"></canvas><div id="piano-keys" class="piano-keys"></div><div class="shared-actions"><button type="button" id="shared-rematch" class="primary-button" hidden>Реванш</button><label id="shot-power-label" hidden>Сила <input id="shot-power" type="range" min="80" max="850" value="550" aria-label="Сила удара"><output id="shot-power-value">61%</output></label><label id="called-pocket-label" hidden>Луза для 8 <select id="called-pocket" aria-label="Луза для восьмёрки"><option value="-1">Выбрать</option><option value="0">Слева сверху</option><option value="1">Сверху по центру</option><option value="2">Справа сверху</option><option value="3">Слева снизу</option><option value="4">Снизу по центру</option><option value="5">Справа снизу</option></select></label><button type="button" id="pool-shoot" class="primary-button" hidden>Ударить</button></div><p class="shared-hint" id="shared-hint"></p>');
    if(!shell)host.append(this.dialog);gameAudio.addSettingsButton(this.dialog.querySelector<HTMLElement>('.shared-actions')!);
    const get=<T extends HTMLElement>(id:string)=>this.dialog.querySelector<T>(id)!;
    this.canvas=get('#shared-canvas');this.piano=get('#piano-keys');this.status=get('#shared-status');this.calledPocket=get('#called-pocket');this.calledPocket.addEventListener('change',()=>this.refresh());this.rematch=get('#shared-rematch');this.shoot=get('#pool-shoot');this.power=get('#shot-power');
    this.renderer=factories.table?.(this.canvas);this.scoreboard=document.createElement('div');this.scoreboard.className='table-scoreboard';this.scoreboard.setAttribute('aria-label',translateText('Участники игры'));
    this.scoreboard.innerHTML='<div class="table-player" data-side="0"><i></i><div><strong></strong><small></small></div></div><div class="table-match-score"></div><div class="table-player" data-side="1"><i></i><div><strong></strong><small></small></div></div>';this.canvas.before(this.scoreboard);
    this.powerValue=get('#shot-power-value');if(context.shotPower!==undefined)this.power.value=String(Math.max(80,Math.min(850,context.shotPower)));this.updatePower();this.power.addEventListener('input',()=>this.updatePower());
    this.placeCue=document.createElement('button');this.placeCue.type='button';this.placeCue.id='pool-place';this.placeCue.className='primary-button';this.placeCue.textContent=translateText('Поставить белый шар');this.placeCue.hidden=true;this.shoot.before(this.placeCue);
    this.placeCue.addEventListener('click',()=>{const t=this.table();if(!t||this.placeCue.disabled)return;const point=defaultCuePosition(t);if(point)this.send({type:'place',...point});});
    this.chess=factories.chess?.(this.send);if(this.chess)this.canvas.after(this.chess.element);
    this.piano.innerHTML=PIANO_NOTES.map(note=>tr`<button type="button" data-note="${note}" aria-label="Нота ${noteNames[note%12]} ${Math.floor(note/12)-1}" class="${[1,3,6,8,10].includes(note%12)?'black-key':'white-key'}"></button>`).join('');
    this.piano.querySelectorAll<HTMLButtonElement>('[data-note]').forEach(button=>{
      button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);this.note(Number(button.dataset.note),true);});
      for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>this.note(Number(button.dataset.note),false));
    });
    get('#shared-close').addEventListener('click',()=>this.dialog.close());
    this.dialog.addEventListener('close',()=>{if(this.destroyed)return;this.release();this.context.onClose();});
    this.rematch.addEventListener('click',()=>this.send({type:'rematch'}));
    this.shoot.addEventListener('click',()=>this.fire());
    const aim=(event:PointerEvent)=>{const r=this.canvas.getBoundingClientRect();this.pointer={x:(event.clientX-r.left)/r.width*720,y:(event.clientY-r.top)/r.height*400};if(this.selected==='pool'){const cue=this.table()?.balls[0];if(cue)this.angle=Math.atan2(this.pointer.y-cue.y,this.pointer.x-cue.x);}else if(this.selected==='hockey')this.sendPaddle(performance.now());};
    this.canvas.addEventListener('pointermove',aim);
    this.canvas.addEventListener('pointerdown',e=>{this.canvas.setPointerCapture(e.pointerId);aim(e);this.canvas.focus();const t=this.table();if(this.selected==='pool'&&t?.ballInHand!=='none'&&t?.players[t.turn]===this.self)this.send({type:'place',...this.pointer});});
    this.listen(document,'keydown',e=>{
      if(!this.dialog.open||document.querySelector('#name-dialog[open]'))return;
      if(this.selected==='pool'&&e.code==='Space'){
        const target=e.target as HTMLElement;
        if(target instanceof HTMLSelectElement||(target instanceof HTMLButtonElement&&target!==this.shoot))return;
        e.preventDefault();if(!e.repeat&&!this.shoot.disabled&&!this.shotPending&&this.chargeStart===null){this.chargeStart=performance.now();this.power.value='80';this.updatePower();}return;
      }
      if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
      if(this.selected==='piano') {const index=keyCodes.indexOf(e.code);if(index>=0&&!e.repeat){e.preventDefault();this.note(60+index,true);}}
      else if(this.selected!=='chess'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)){e.preventDefault();if(this.selected==='hockey'&&!this.keys.size&&this.localPaddle)this.pointer={...this.localPaddle};this.keys.add(e.key);}
    });
    this.listen(document,'keyup',e=>{if(e.code==='Space'&&this.chargeStart!==null){e.preventDefault();this.updateCharge(performance.now());this.chargeStart=null;this.fire();}this.keys.delete(e.key);const i=keyCodes.indexOf(e.code);if(i>=0)this.note(60+i,false);});
    this.listen(window,'blur',()=>this.release());this.listen(document,'visibilitychange',()=>{if(document.hidden)this.release();});
    this.openDialog(id);
    this.frame=requestAnimationFrame(time=>this.draw(time));
    shell?.querySelector('[data-activity-loading-close]')?.remove();
  }
  private listen<K extends keyof DocumentEventMap>(target:EventTarget,type:K,listener:(event:DocumentEventMap[K])=>void){target.addEventListener(type,listener as EventListener,{signal:this.events.signal});}
  destroy(){if(this.destroyed)return;this.release();this.destroyed=true;cancelAnimationFrame(this.frame);this.events.abort();if(this.dialog.open)this.dialog.close();this.dialog.remove();}
  hallChanged(){this.release();this.audio.stop();}
  connected(){this.send({type:'ears',muted:this.audio.muted});}
  disconnected(){this.release();this.audio.stop();if(this.dialog.open)this.dialog.close();}
  updatePlayers(players:PlayerView[],self:string){this.players=players;this.self=self;this.refresh();}
  update(state:ActivitiesState){
    const old=this.state,previous=old.pianist;this.state=state;
    if(previous&&previous!==state.pianist){this.release();this.audio.stop();}
    if(this.dialog.open){const before=old.tables.find(t=>t.id===this.selected),after=this.table();
      if((this.selected==='piano'&&previous&&!state.pianist)||(before?.players.length===2&&after?.players.length===1&&!after.players.includes(this.self)))this.send({type:'join',id:this.selected});
    }
    if(this.dialog.open&&this.selected==='chess'&&old.chess.players.length===2&&state.chess.players.length===1&&!state.chess.players.includes(this.self))this.send({type:'join',id:'chess'});
    if(state.tables.find(t=>t.id==='pool')!==old.tables.find(t=>t.id==='pool'))this.shotPending=false;
    if(state.tables.find(t=>t.id==='hockey')!==old.tables.find(t=>t.id==='hockey')){
      this.syncHockey();
      if(this.dialog.open&&this.selected==='hockey'){const t=this.table();this.localPuck=t?.balls[0]?{...t.balls[0]}:null;this.serveRemaining=t?.serveDelay??0;}
    }
    this.refresh();
  }
  receive(note:PianoNote){
    if(this.scene.hall!=='arcade')return;
    // The pianist already hears local input; delayed echoes must not replay it.
    this.piano.querySelector(`[data-note="${note.note}"]`)?.classList.toggle('pressed',note.player===this.self?this.held.has(note.note):note.down);
  }
  getState(){return{...this.state,selected:this.selected,open:this.dialog.open,audio:this.audio.getState(),hockey:{local:this.localPaddle,rendered:[this.visuals.get('p0'),this.visuals.get('p1')],puck:this.visuals.get('b0'),radius:HOCKEY_PADDLE_RADIUS},charge:{charging:this.chargeStart!==null,power:Number(this.power.value)},frames:this.frames};}
  private name(id:string){return this.players.find(p=>p.id===id)?.name||translateText('Игрок');}
  private table():TableState|undefined{return this.state.tables.find(t=>t.id===this.selected);}
  private openDialog(id:ActivityId){this.release();this.shotPending=false;this.chess?.clear();this.selected=id;this.dialog.dataset.game=id;this.hockeyRound='';this.localPaddle=null;this.lastFrame=0;this.angle=0;this.visuals.clear();this.scene.setLocked(true);if(!this.dialog.open)this.dialog.showModal();this.dialog.classList.toggle('clean-piano',id==='piano');this.calledPocket.value='-1';gameAudio.setGame(id);this.syncHockey();this.refresh();this.send({type:'join',id});if(id==='pool'||id==='hockey')this.canvas.focus();void this.audio.unlock();}
  private refresh(){
    if(!this.dialog.open)return;
    this.dialog.querySelector('#shared-title')!.textContent=ACTIVITIES[this.selected].name;
    const isPiano=this.selected==='piano',t=this.table(),side=t?.players.indexOf(this.self)??-1;
    this.canvas.hidden=isPiano||this.selected==='chess';this.piano.hidden=!isPiano;if(this.chess)this.chess.element.hidden=this.selected!=='chess';
    this.scoreboard.hidden=isPiano||this.selected==='chess';
    if(t){this.scoreboard.querySelector('.table-match-score')!.textContent=t.id==='hockey'?t.score.join(' : '):'8';
      this.scoreboard.querySelectorAll<HTMLElement>('.table-player').forEach((el,i)=>{el.querySelector('strong')!.textContent=t.players[i]?this.name(t.players[i]):translateText('Свободное место');el.querySelector('small')!.textContent=t.players[i]===this.self?translateText('Ты'):t.id==='hockey'?(i?translateText('Справа'):translateText('Слева')):t.groups[i]==='solid'?translateText('Сплошные'):t.groups[i]==='stripe'?translateText('Полосатые'):translateText('Стол открыт');el.classList.toggle('active',t.phase==='playing'&&(t.id==='hockey'||t.turn===i));el.classList.toggle('own',side===i);});
    }
    this.rematch.hidden=!t||t.phase!=='finished'||side<0;this.rematch.disabled=!!t?.ready.includes(this.self);this.rematch.textContent=this.rematch.disabled?translateText('Ждём соперника'):translateText('Реванш');
    const eight=!!t&&side>=0&&t.groups[side]!=='open'&&!t.balls.some(b=>b.active&&(t.groups[side]==='solid'?b.id>=1&&b.id<=7:b.id>=9));
    (this.dialog.querySelector('#called-pocket-label') as HTMLElement).hidden=this.selected!=='pool'||!eight;
    const canShoot=this.selected==='pool'&&t?.phase==='playing'&&!t.moving&&t.turn===side&&t.ballInHand==='none'&&(!eight||Number(this.calledPocket.value)>=0);
    this.placeCue.hidden=this.selected!=='pool'||side<0||t?.phase!=='playing'||t.ballInHand==='none';
    this.placeCue.disabled=side!==t?.turn||!!t?.moving;
    this.shoot.hidden=this.selected!=='pool'||side<0;this.shoot.disabled=!canShoot||this.shotPending;if(!canShoot)this.chargeStart=null;
    (this.dialog.querySelector('#shot-power-label') as HTMLElement).hidden=this.selected!=='pool'||side<0;
    this.piano.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{b.disabled=this.state.pianist!==this.self;});
    this.dialog.querySelector('#shared-rules')!.textContent=isPiano?translateText('Займи место и играй клавишами или касаниями. Музыку слышит весь зал. Звук рояля регулируется в настройках игрока.'):this.selected==='hockey'?translateText('Забей 7 голов. Управляй битой мышью, пальцем или стрелками, каждый на своей половине.'):translateText('Американский пул «8». Сначала забей свои сплошные или полосатые шары, затем восьмёрку в выбранную лузу. Ранняя восьмёрка или фол на ней означают поражение.');
    this.dialog.querySelector('#shared-hint')!.textContent=isPiano?translateText('A W S E D F T G Y H U J K O L P ; · одновременно до 8 нот'):this.selected==='pool'?translateText('Прицелься мышью или стрелками. Зажми пробел для набора силы, отпусти для удара. Можно также выбрать силу ползунком и нажать «Ударить».'):translateText('Синий игрок слева, розовый справа. Закрытие окна освобождает место.');
    if(this.selected==='chess'){
      const c=this.state.chess,side=c.players.indexOf(this.self);this.chess?.update(c,this.self);
      this.rematch.hidden=c.phase!=='finished'||side<0;this.rematch.disabled=c.ready.includes(this.self);this.rematch.textContent=this.rematch.disabled?translateText('Ждём соперника'):translateText('Реванш');
      this.status.textContent=(c.players[0]?this.name(c.players[0]):translateText('Свободно'))+translateText(' (белые) · ')+(c.players[1]?this.name(c.players[1]):translateText('Свободно'))+translateText(' (чёрные) · ')+(c.phase==='finished'?(c.winner?translateText('Победил ')+this.name(c.winner)+' · ':'')+translateText(c.message):c.phase==='waiting'?translateText(c.message):translateText('Ход: ')+this.name(c.players[c.turn==='w'?0:1])+(c.check?translateText(' · Шах'):''))+(side<0?translateText(' · Ты наблюдаешь'):'');
      this.dialog.querySelector('#shared-rules')!.textContent=translateText('По 15 минут каждому, без добавления времени. Время истекло: поражение, если соперник может поставить мат.');
      this.dialog.querySelector('#shared-hint')!.textContent=translateText('Выбери фигуру, затем подсвеченное поле. Закрытие окна освобождает место и завершает партию. В реванше цвета меняются.');
    }else if(isPiano)this.status.textContent=this.state.pianist?(this.state.pianist===this.self?translateText('Ты за роялем. Играй!'):tr`Играет ${this.name(this.state.pianist)}`):translateText('Рояль свободен');
    else if(t){const names=[0,1].map(i=>t.players[i]?this.name(t.players[i]):translateText('Свободное место'));this.status.textContent=`${names[0]}  ${t.score[0]} : ${t.score[1]}  ${names[1]} · `+(t.phase==='waiting'?translateText('Ждём второго игрока'):t.phase==='finished'?tr`Победил ${this.name(t.winner)}`:this.selected==='pool'?(t.moving?translateText('Шары в движении'):side<0?tr`Ход: ${this.name(t.players[t.turn])}`:t.turn===side?(t.breaking?translateText('Ты разбиваешь'):translateText('Твой ход')):(t.breaking?translateText('Соперник разбивает'):translateText('Ход соперника'))):side<0?translateText('Ты наблюдаешь'):side===0?translateText('Ты слева'):translateText('Ты справа'));
      if(this.selected==='pool'){const group=(g:string)=>g==='solid'?translateText('сплошные 1–7'):g==='stripe'?translateText('полосатые 9–15'):translateText('стол открыт');this.status.textContent+=' · '+(side>=0?group(t.groups[side]):group(t.groups[t.turn]))+(translateText(t.message)?' · '+translateText(t.message):'');if(t.ballInHand!=='none'){
        const own=side===t.turn;this.status.textContent+=own?(t.ballInHand==='kitchen'?translateText(' · Поставь белый шар слева от линии'):translateText(' · Поставь белый шар в свободное место')):translateText(' · Соперник ставит белый шар');
        this.dialog.querySelector('#shared-hint')!.textContent=own?translateText('Нажми на свободное место стола или кнопку «Поставить белый шар». Затем прицелься и ударь.'):translateText('Дождись хода соперника. После фола он сначала ставит белый шар.');
      }else if(t.phase==='playing'&&!t.moving&&t.turn!==side)this.dialog.querySelector('#shared-hint')!.textContent=translateText('Дождись соперника. После забитого своего шара игрок продолжает, после промаха ход переходит другому.');}
    }
    if(this.dialog.dataset.wager==='true'){
      this.rematch.hidden=true;
      this.dialog.querySelector('#shared-hint')!.textContent=this.selected==='chess'
        ?'Выбери фигуру, затем подсвеченное поле. Окно можно закрыть и открыть через «Мой поединок». Партия и часы продолжаются.'
        :'Окно можно закрыть и открыть через «Мой поединок». Партия продолжается. Для новой ставки создай новый вызов после завершения.';
    }
  }
  private note(note:number,down:boolean){
    if(!down){if(!this.held.delete(note))return;this.piano.querySelector(`[data-note="${note}"]`)?.classList.remove('pressed');this.audio.note(note,false);this.send({type:'note',note,down:false});return;}
    if(!this.dialog.open||this.selected!=='piano'||this.state.pianist!==this.self||this.held.has(note)||this.held.size>=8)return;
    this.held.add(note);this.piano.querySelector(`[data-note="${note}"]`)?.classList.add('pressed');this.audio.note(note,true);this.send({type:'note',note,down:true});
  }
  private release(){if(this.localPaddle&&this.selected==='hockey'){this.pointer={...this.localPaddle};this.sendPaddle(performance.now(),true);}this.chargeStart=null;for(const note of this.held)this.note(note,false);this.keys.clear();}
  private updatePower(){this.powerValue.value=Math.round((Number(this.power.value)-80)/770*100)+'%';}
  private updateCharge(time:number){if(this.chargeStart===null)return;this.power.value=String(Math.round(80+Math.min(1,(time-this.chargeStart)/1500)*770));this.updatePower();}
  private fire(){if(this.dialog.open&&this.selected==='pool'&&!this.shoot.disabled&&!this.shotPending){this.shotPending=true;this.send({type:'shot',angle:this.angle,power:Number(this.power.value),pocket:Number(this.calledPocket.value)});this.refresh();}}
  private syncHockey(){
    if(!this.dialog.open||this.selected!=='hockey')return;
    const t=this.table();if(!t)return;
    const key=t.players.join(',')+':'+t.phase,side=t.players.indexOf(this.self);
    if(key===this.hockeyRound)return;
    this.hockeyRound=key;this.localPaddle=side>=0?{...t.paddles[side]}:null;
    this.localPuck=t.balls[0]?{...t.balls[0]}:null;this.serveRemaining=t.serveDelay;
    if(this.localPaddle)this.pointer={...this.localPaddle};
    this.keys.clear();this.lastPaddleTarget=null;this.lastSend=-Infinity;this.visuals.clear();
  }
  private sendPaddle(time:number,force=false){
    const t=this.table(),side=t?.players.indexOf(this.self)??-1;
    if(!this.dialog.open||this.selected!=='hockey'||t?.phase!=='playing'||side<0)return;
    this.pointer=clampPaddle(this.pointer,side);
    if(!force&&time-this.lastSend<1000/60)return;
    if(this.lastPaddleTarget&&this.lastPaddleTarget.x===this.pointer.x&&this.lastPaddleTarget.y===this.pointer.y)return;
    this.lastSend=time;this.lastPaddleTarget={...this.pointer};this.send({type:'paddle',...this.pointer});
  }
  private draw(time:number){
    if(this.destroyed)return;this.frame=requestAnimationFrame(t=>this.draw(t));const dt=this.lastFrame?Math.min(.05,Math.max(0,(time-this.lastFrame)/1000)):1/60;this.lastFrame=time;if(!this.dialog.open||this.selected==='piano')return;if(this.selected==='chess'){this.chess?.drawClocks(time);return;}this.frames++;this.updateCharge(time);
    const t=this.table();if(!t)return;const side=t.players.indexOf(this.self);
    if(this.selected==='hockey'&&side>=0&&t.phase==='playing'&&this.localPaddle){
      const dx=Number(this.keys.has('ArrowRight'))-Number(this.keys.has('ArrowLeft')),dy=Number(this.keys.has('ArrowDown'))-Number(this.keys.has('ArrowUp')),length=Math.hypot(dx,dy);
      if(length){this.pointer.x+=dx/length*HOCKEY_KEYBOARD_SPEED*dt;this.pointer.y+=dy/length*HOCKEY_KEYBOARD_SPEED*dt;}
      this.pointer=clampPaddle(this.pointer,side);this.sendPaddle(time);
    }else if(this.selected==='pool')this.angle+=(Number(this.keys.has('ArrowRight'))-Number(this.keys.has('ArrowLeft')))*.025;
    if(this.selected==='hockey'&&t.phase==='playing'&&this.localPuck){
      const steps=Math.max(1,Math.ceil(dt*240)),step=dt/steps;
      for(let n=0;n<steps;n++){
        const paddles=t.paddles.map((p,i)=>i===side&&this.localPaddle?this.localPaddle:p),velocities=paddles.map(()=>({vx:0,vy:0}));
        if(side>=0&&this.localPaddle)velocities[side]=stepPaddle(this.localPaddle,this.pointer,step);
        if(this.serveRemaining>0){if(side>=0&&this.localPaddle)keepPaddleClearOfServe(this.localPaddle,side);this.serveRemaining=Math.max(0,this.serveRemaining-step);continue;}
        const result=stepHockeyPuck(this.localPuck,paddles,velocities,step);
        if(result.scorer>=0){this.localPuck.vx=this.localPuck.vy=0;break;}
      }
    }
    const pool=this.selected==='pool',blend=pool?1-Math.exp(-dt*36):1;
    const position=(key:string,point:HockeyPoint)=>{const old=this.visuals.get(key)||{x:point.x,y:point.y};old.x+=(point.x-old.x)*blend;old.y+=(point.y-old.y)*blend;this.visuals.set(key,old);return old;};
    const paddles=t.paddles.map((p,i)=>position('p'+i,i===side&&this.localPaddle?this.localPaddle:p));
    const balls=t.balls.map(b=>{const point=!pool&&this.localPuck?this.localPuck:b;return{...b,...point,...position('b'+b.id,point)};});
    this.renderer?.render(t,balls,paddles,{side,angle:this.angle,charge:this.chargeStart===null?0:(Number(this.power.value)-80)/770,calledPocket:Number(this.calledPocket.value),reducedMotion:this.reducedMotion});
  }
}
