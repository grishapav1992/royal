import { ACTIVITIES, type ActivityId } from '../../src/shared/activities';
import { activityHall } from '../../src/shared/world';
import { isPvpSnapshotGame, validPvpRequest, type PvpChallenge, type PvpSnapshot } from '../../src/shared/pvp';
import { playCommand } from '../nilePlayRoutes';
import {pvpSeat} from '../../src/shared/pvpSeats';
import type { Activities } from '../activities';

type Person={sessionId:string;accountId:string;name:string;hall:string;x:number;y:number;connected:boolean;available:boolean};
type Host={roomId:()=>string;people:()=>Person[];send:(session:string,type:string,value:unknown)=>void;activities:Activities;allowMoney?:(id:string)=>Promise<void>};
const messages:Record<string,string>={play_wallet_unassigned:'Нажми «Пополнить USDT», чтобы подключить тестовый кошелёк.',
  play_insufficient_balance:'Недостаточно тестовых USDT для ставки.',play_source_not_ready:'Подтверждение баланса временно недоступно. Повтори то же действие позже.',
  play_idempotency_conflict:'Нельзя изменить отправленную операцию.',pvp_unavailable:'Этот вызов уже недоступен.'};
export class PvpRoom {
  private matches:PvpChallenge[]=[];
  private running=new Map<string,string>();
  private poolTurn?:{turn:number;at:number;id:string};
  private busy=false;
  private queue:Promise<unknown>=Promise.resolve();
  private stopped=false;
  private outstanding=new Map<string,string>();
  private attempts=new Map<string,{at:number;n:number}>();
  constructor(private host:Host,private socket:string|((account:string,action:string,value:unknown)=>Promise<{status:number;value:any}>)|undefined=process.env.NILE_PLAY_SOCKET_FILE){
    host.activities.canJoin=(session,game)=>!this.matches.some(c=>c.gameId===game&&['arriving','playing'].includes(c.status))
      ||this.matches.some(c=>c.gameId===game&&c.status==='playing'&&this.host.people().some(p=>p.sessionId===session&&(p.accountId===c.creatorId||p.accountId===c.opponentId)));
  }
  locked(session:string){return [...this.host.activities.wagers.values()].some(ids=>ids.includes(session));}
  private async call(account:string,action:string,value:unknown){
    if(!this.socket)throw Error('Тестовый USDT пока не подключён.');
    if(typeof this.socket==='function')return this.socket(account,action,value);
    return playCommand(this.socket,account,action,value);
  }
  async command(session:string,value:unknown){
    if(!validPvpRequest(value))return;
    if(this.outstanding.get(session)===value.id)return;
    const reject=(error:string)=>this.host.send(session,'pvp-result',{requestId:value.id,error,rejected:true});
    if(this.outstanding.has(session)||this.outstanding.size>=16){reject('Дождись завершения предыдущего действия.');return;}
    const now=Date.now();for(const[id,row]of this.attempts)if(now-row.at>=60_000)this.attempts.delete(id);
    const attempt=this.attempts.get(session)??{at:now,n:0};this.attempts.set(session,attempt);
    if(++attempt.n>120){reject('Слишком много действий. Подожди минуту.');return;}
    this.outstanding.set(session,value.id);
    const run=async()=>{
      const person=this.host.people().find(p=>p.sessionId===session&&p.connected);
      if(!person||!validPvpRequest(value))return;
      try{
        if(value.action==='create'||value.action==='accept')await this.host.allowMoney?.(person.accountId);
        if(value.action==='ready'){
          const match=this.matches.find(c=>c.id===value.challengeId),game=match?.gameId;
          if(!game)throw Error('Обнови список поединков.');
          const target=pvpSeat(game,match.creatorId===person.accountId?0:1);
          if(person.hall!==activityHall(game)||Math.hypot(person.x-target.x,person.y-target.y)>65)throw Error('Сначала подойди к своему столу.');
        }
        if(value.action==='accept'){
          const game=this.matches.find(c=>c.id===value.challengeId)?.gameId;
          const engine=game==='chess'?this.host.activities.chess:this.host.activities.tables.find(t=>t.state.id===game);
          if(engine?.state.players.length&&!this.host.activities.wagers.has(game!))throw Error('За этим столом идёт другая партия.');
        }
        const result=await this.call(person.accountId,'pvp-command',{roomId:this.host.roomId(),name:person.name,request:value});
        if(result.status!==200){
          this.host.send(session,'pvp-result',{requestId:value.id,error:messages[result.value?.code]??(/^[А-Яа-яЁё]/.test(result.value?.code??'')?result.value.code:'Не удалось подтвердить действие. Повтори проверку.'),rejected:[400,404,409,429].includes(result.status)});return;
        }
        const snapshot=result.value as PvpSnapshot;
        this.matches=snapshot.challenges.filter(c=>['open','arriving','playing'].includes(c.status));
        await this.sync();
        this.host.send(session,'pvp',snapshot);
      }catch(error){this.host.send(session,'pvp-result',{requestId:value.id,error:error instanceof Error&&/[а-я]/i.test(error.message)?error.message:'Связь с кошельком прервалась. Повтори то же действие.',rejected:error instanceof Error&&((error as any).status===403||/Сначала|Обнови|другая партия/.test(error.message))});}
    };
    const task=async()=>{try{await run();}finally{this.outstanding.delete(session);}};
    this.queue=this.queue.then(task,task);return this.queue;
  }
  tick(){
    if(this.stopped||this.busy||!this.socket)return;
    this.busy=true;const run=()=>this.sync();
    this.queue=this.queue.then(run,run).catch(()=>{}).finally(()=>{this.busy=false;});
  }
  private async sync(){
    if(this.stopped)return;
    const people=this.host.people(),owner=people[0]?.accountId;if(!owner)return;
    const result=await this.call(owner,'pvp-sync',{roomId:this.host.roomId(),people:people.map(({accountId,name,connected,available})=>({accountId,name,connected,available}))});
    if(result.status!==200||!Array.isArray(result.value?.snapshots)||!Array.isArray(result.value?.matches))return;
    this.matches=result.value.matches;
    for(const [game,id] of this.running)if(!this.matches.some(c=>c.id===id&&c.status==='playing')){this.host.activities.finishWager(game);this.running.delete(game);}
    for(const c of this.matches){
      if(c.status!=='playing')continue;
      const players=[c.creatorId,c.opponentId].map(id=>people.find(p=>p.accountId===id));
      if(players.some(p=>!p?.connected))continue;
      this.host.activities.startWager(c.gameId,players.map(p=>p!.sessionId));this.running.set(c.gameId,c.id);
      if(isPvpSnapshotGame(c.gameId))continue;
      const state=c.gameId==='chess'?this.host.activities.chess.state:this.host.activities.tables.find(t=>t.state.id===c.gameId)!.state;
      let winner:string|null|undefined;
      if(state.phase==='finished')winner=state.winner?people.find(p=>p.sessionId===state.winner)?.accountId??null:null;
      if(c.gameId==='pool'&&state.phase==='playing'&&'turn'in state){
        const turn=Number(state.turn),moving='moving'in state&&state.moving;
        if(!this.poolTurn||this.poolTurn.id!==c.id||this.poolTurn.turn!==turn||moving)this.poolTurn={id:c.id,turn,at:Date.now()};
        else if(Date.now()-this.poolTurn.at>60_000)winner=[c.creatorId,c.opponentId][1-turn]!;
      }
      if(winner!==undefined){
        const settled=await this.call(c.creatorId,'pvp-result',{roomId:this.host.roomId(),matchId:c.id,winnerId:winner,reason:winner?'win':'draw'});
        if(settled.status===200)c.status='finished';
      }
    }
    for(const row of result.value.snapshots){const person=people.find(p=>p.accountId===row.accountId&&p.connected);if(person)this.host.send(person.sessionId,'pvp',row.snapshot);}
  }
  stop(){this.stopped=true;}
}
