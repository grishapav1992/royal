import { CombatRoom, type CombatDependencies } from './combatRoom';
import { combatView } from '../src/shared/combatView';
import { activityHall, type HallId } from '../src/shared/world';
import { ACTIVITIES, isActivity, type ActivitiesState, type ChessState, type PianoNote, type TableUpdate } from '../src/shared/activities';
import { TableGame } from './tableGames';
import { ChessGame } from './chessGame';
import { ActivityChanges } from './activityChanges';
type Visitor={hall?:string;x:number;y:number;playing:boolean;connected:boolean;activity:string;ears:boolean;seat:string;action:string;facing:string;moving:boolean};
export class Activities {
  readonly tables=[new TableGame('hockey'),new TableGame('pool')];
  readonly chess:ChessGame;
  readonly combat?:CombatRoom;
  private combatElapsed=0;
  private combatRevision=0;
  pianist='';
  private notes=new Map<number,number>();
  private noteTimes:number[]=[];
  private tableChanges=this.tables.map(table=>new ActivityChanges(table.state));
  private tableElapsed=[0,0];
  private tablePending=[false,false];
  private chessChanges:ActivityChanges<ChessState>;
  private chessRevision=0;
  private chessElapsed=0;
  private pianoChanges=new ActivityChanges({pianist:'',notes:[] as number[]});
  private pianoElapsed=0;
  readonly wagers=new Map<string,string[]>();
  canJoin:(id:string,game:string)=>boolean=()=>true;
  constructor(private player:(id:string)=>Visitor|undefined,private stop:(id:string)=>void,private broadcast:(type:string,value:unknown,hall:HallId)=>void,private notice:(id:string,text:string)=>void,now:()=>number=()=>performance.now(),combat?:CombatDependencies){
    if(combat)this.combat=new CombatRoom(combat,notice);
    this.chess=new ChessGame(undefined,now);this.chessChanges=new ActivityChanges(this.chess.state);this.chessRevision=this.chess.state.revision;
  }
  combatSnapshot(viewer?:string){return this.combat?combatView(this.combat.state,viewer):undefined;}
  snapshot(viewer?:string):ActivitiesState{return{...(this.combat?{combat:this.combatSnapshot(viewer)}:{}),tables:this.tables.map(t=>t.state),pianist:this.pianist,notes:[...this.notes.keys()],chess:this.chess.state};}
  handle(id:string,value:unknown){
    const p=this.player(id);if(!p?.connected||!value||typeof value!=='object')return;
    const v=value as Record<string,unknown>;
    if(typeof v.type==='string'&&v.type.startsWith('combat-')){if(p.activity==='mortal-kombat')this.combat?.handle(id,v);return;}
    if(v.type==='ears'&&typeof v.muted==='boolean'){p.ears=v.muted;return;}
    if(v.type==='leave'){this.leave(id);return;}
    if(v.type==='join'&&isActivity(v.id)){
      if(!this.canJoin(id,v.id))return;
      if(['durak','transfer-durak','crazy-eights','tsu-e-fa'].includes(v.id)){this.notice(id,'Открой вызов на поединок.');return;}
      if(p.hall && p.hall!==activityHall(v.id)){this.notice(id,'Эта игра находится в другом зале.');return;}
      if(p.activity===v.id)return;
      if(p.playing||p.seat||p.action==='drink'){this.notice(id,'Сначала заверши текущее занятие.');return;}
      const activity=ACTIVITIES[v.id];if(Math.hypot(p.x-activity.entry.x,p.y-activity.entry.y)>65){this.notice(id,'Сначала подойди ближе.');return;}
      if(v.id==='piano'){
        if(this.pianist){this.notice(id,'За роялем уже играют. Можно послушать и подождать.');return;}
        this.pianist=id;p.x=ACTIVITIES.piano.seat.x;p.y=ACTIVITIES.piano.seat.y;p.seat='piano';p.action='sit';p.facing='up';
      }else if(!(v.id==='mortal-kombat'?this.combat?.join(id):v.id==='chess'?this.chess.join(id):this.tables.find(t=>t.state.id===v.id)!.join(id))){this.notice(id,'Оба места заняты. Можно наблюдать за партией.');return;}
      this.stop(id);p.activity=v.id;p.playing=true;this.changed();return;
    }
    if(v.type==='paddle')this.tables[0].move(id,v.x,v.y);
    if(v.type==='shot'){this.tables[1].shoot(id,v.angle,v.power,v.pocket);this.changed();}
    if(v.type==='place'){
      const table=this.tables[1];
      if(!table.place(id,v.x,v.y)&&table.state.phase==='playing'&&table.state.players[table.state.turn]===id&&table.state.ballInHand!=='none')this.notice(id,'Выбери свободное место для белого шара'+(table.state.ballInHand==='kitchen'?' слева от линии.':'.'));
      this.changed();
    }
    if(v.type==='chess-move'&&this.chess.move(id,v.from,v.to,v.promotion))this.changed();
    if(v.type==='chess-resign'&&this.chess.resign(id))this.changed();
    if(v.type==='rematch'){if([...this.wagers.values()].some(ids=>ids.includes(id)))return;this.tables.forEach(t=>t.rematch(id));this.chess.rematch(id);this.changed();}
    if(v.type==='note'&&id===this.pianist&&typeof v.note==='number'&&Number.isInteger(v.note)&&v.note>=60&&v.note<=76&&typeof v.down==='boolean'){
      const now=Date.now();
      if(v.down){
        this.noteTimes=this.noteTimes.filter(t=>now-t<1000);
        if(this.notes.has(v.note)||this.notes.size>=8||this.noteTimes.length>=24)return;
        this.noteTimes.push(now);this.notes.set(v.note,now);
      }else if(!this.notes.delete(v.note))return;
      this.broadcast('piano-note',{note:v.note,down:v.down,player:id} satisfies PianoNote,'arcade');
    }
  }
  leave(id:string,force=false){
    if(!force&&[...this.wagers.values()].some(ids=>ids.includes(id)))return;
    const p=this.player(id);this.combat?.leave(id);this.tables.forEach(t=>t.leave(id));this.chess.leave(id);
    if(this.pianist===id){for(const note of this.notes.keys())this.broadcast('piano-note',{note,down:false,player:id},'arcade');this.notes.clear();this.noteTimes=[];this.pianist='';if(p){p.x=ACTIVITIES.piano.entry.x;p.y=ACTIVITIES.piano.entry.y;p.seat='';p.action='idle';}}
    if(p?.activity){p.activity='';p.playing=false;}this.changed();
  }
  disconnect(id:string){if(this.player(id)?.activity==='mortal-kombat')this.combat?.disconnect(id);else this.leave(id);}
  reconnect(id:string){this.combat?.reconnect(id);}
  tick(dt:number){
    this.combat?.tick(dt);this.combatElapsed+=dt;
    if(this.combat&&this.combatElapsed>=.05){this.combatElapsed=0;if(this.combat.state.phase!=='waiting'&&this.combat.state.phase!=='finished'||this.combat.state.revision!==this.combatRevision)this.sendCombat();}
    const updates:TableUpdate[]=[];
    this.tables.forEach((table,index)=>{
      // Keep the final frame pending even if the game finishes before the next send.
      this.tablePending[index] ||= table.state.phase==='playing';
      if(!this.wagers.has(table.state.id)||table.state.players.every(id=>this.player(id)?.connected))table.tick(dt);this.tableElapsed[index]+=dt;
      const interval=table.state.id==='hockey'?1/30:1/20;
      if(this.tablePending[index]&&this.tableElapsed[index]+1e-9>=interval){
        this.tableElapsed[index]=Math.max(0,(this.tableElapsed[index]+1e-9)%interval-1e-9);
        const update=this.tableUpdate(index);if(update)updates.push(update);
        this.tablePending[index]=false;
      }
    });
    this.sendTables(updates);
    this.chess.tick();
    this.chessElapsed+=dt;
    if(this.chess.state.revision!==this.chessRevision||this.chessElapsed+1e-9>=1)this.sendChess(this.chessElapsed+1e-9>=1);
    for(const [note,at] of this.notes)if(Date.now()-at>4000){this.notes.delete(note);this.broadcast('piano-note',{note,down:false,player:this.pianist},'arcade');}
    this.pianoElapsed+=dt;
    if(this.pianoElapsed+1e-9>=.05){this.pianoElapsed=Math.max(0,(this.pianoElapsed+1e-9)%.05-1e-9);this.sendPiano();}
  }
  startWager(game:string,ids:string[]){
    const previous=this.wagers.get(game);
    if(previous){
      if(previous.join(',')!==ids.join(',')){
        const state=game==='chess'?this.chess.state:this.tables.find(t=>t.state.id===game)?.state;
        if(state)state.players=[...ids];
        this.wagers.set(game,[...ids]);
        for(const old of previous)if(!ids.includes(old)){const p=this.player(old);if(p){p.activity='';p.playing=false;}}
      }
    }else{
      for(const id of ids)this.leave(id,true);
      const engine=game==='chess'?this.chess:this.tables.find(t=>t.state.id===game);
      if(engine){for(const id of [...engine.state.players])engine.leave(id);for(const id of ids)engine.join(id);}
      this.wagers.set(game,[...ids]);
    }
    for(const id of ids){const p=this.player(id);if(p){this.stop(id);p.activity=game;p.playing=true;}}
    this.changed();
  }
  finishWager(game:string){const ids=this.wagers.get(game);this.wagers.delete(game);for(const id of ids??[])this.leave(id,true);}
  private tableUpdate(index:number):TableUpdate|undefined{
    const changes=this.tableChanges[index].take(this.tables[index].state);
    return Object.keys(changes).length?{...changes,id:this.tables[index].state.id}:undefined;
  }
  private sendTables(tables:TableUpdate[]){if(tables.length)this.broadcast('activities',{patch:true,tables},'tables');}
  private sendChess(clockDue=false){
    const state=this.chess.state;
    const changes=this.chessChanges.take(state,(Object.keys(state) as (keyof ChessState)[]).filter(key=>key!=='clock'));
    if(clockDue||Object.keys(changes).length){Object.assign(changes,this.chessChanges.take(state,['clock']));this.chessElapsed=0;}
    this.chessRevision=state.revision;
    if(Object.keys(changes).length)this.broadcast('activities',{patch:true,chess:changes},'tables');
  }
  private sendPiano(){
    const changes=this.pianoChanges.take({pianist:this.pianist,notes:[...this.notes.keys()]});
    if(Object.keys(changes).length)this.broadcast('activities',{patch:true,...changes},'arcade');
  }
  private sendCombat(){if(!this.combat)return;this.combatRevision=this.combat.state.revision;this.broadcast('activities',{patch:true,combat:this.combatSnapshot()},'tables');}
  private changed(){
    const tables=this.tables.flatMap((_,index)=>{const update=this.tableUpdate(index);return update?[update]:[];});
    this.sendTables(tables);this.sendChess();this.sendPiano();
    if(this.combat&&this.combat.state.revision!==this.combatRevision)this.sendCombat();
  }
}
