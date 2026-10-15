import { Chess } from 'chess.js';
import type { ChessState } from '../src/shared/activities';
import { CHESS_TIME_MS } from '../src/shared/activities';

export class ChessGame {
  private game:Chess;
  private clockAt=0;
  readonly state:ChessState={players:[],phase:'waiting',turn:'w',board:[],moves:[],last:null,check:false,winner:'',message:'Ждём второго игрока',ready:[],revision:0,sound:'',clock:{remainingMs:[CHESS_TIME_MS,CHESS_TIME_MS],running:null}};
  constructor(private initialFen?:string,private now:()=>number=()=>performance.now()){this.game=new Chess(initialFen);this.sync();}
  join(id:string){
    if(this.state.players.includes(id))return true;
    if(this.state.players.length===2)return false;
    this.state.players.push(id);this.reset();return true;
  }
  leave(id:string){if(!this.state.players.includes(id))return;this.state.players=this.state.players.filter(p=>p!==id);this.reset();}
  move(id:string,from:unknown,to:unknown,promotion:unknown){
    this.tick();
    if(this.state.phase!=='playing'||this.state.players[this.game.turn()==='w'?0:1]!==id)return false;
    if(typeof from!=='string'||typeof to!=='string'||!/^[a-h][1-8]$/.test(from)||!/^[a-h][1-8]$/.test(to))return false;
    if(promotion!==undefined&&(typeof promotion!=='string'||!['q','r','b','n'].includes(promotion)))return false;
    try{
      const move=this.game.move({from,to,promotion:promotion as string|undefined});
      this.state.last={from,to};this.state.sound=move.captured?'coin':'hit';this.sync();this.state.clock.running=this.state.phase==='playing'?this.state.turn:null;return true;
    }catch{return false;}
  }
  resign(id:string){this.tick();if(this.state.phase!=='playing'||!this.state.players.includes(id))return false;this.state.phase='finished';this.state.clock.running=null;this.state.winner=this.state.players.find(p=>p!==id)!;this.state.message='Соперник сдался';this.state.moves=[];this.state.sound='win';this.state.revision++;return true;}
  tick(){
    const s=this.state;if(s.phase!=='playing'||!s.clock.running)return;
    const now=this.now(),elapsed=Math.max(0,now-this.clockAt);this.clockAt=now;
    const side=s.clock.running==='w'?0:1;s.clock.remainingMs[side]=Math.max(0,s.clock.remainingMs[side]-elapsed);
    if(s.clock.remainingMs[side]>0)return;
    const draw=this.insufficientMaterial(side===0?'b':'w');
    s.phase='finished';s.clock.running=null;s.winner=draw?'':s.players[1-side];
    s.message=draw?'Ничья: у соперника недостаточно фигур для мата':(side===0?'Время белых истекло':'Время чёрных истекло');
    s.moves=[];s.sound='win';s.revision++;
  }
  private insufficientMaterial(color:'w'|'b'){
    const board=this.state.board,own=board.filter(p=>p.color===color);
    if(own.some(p=>['p','r','q'].includes(p.type)))return false;
    if(own.some(p=>p.type==='n'))return own.length===2&&!board.some(p=>p.color!==color&&!['k','q'].includes(p.type));
    if(own.some(p=>p.type==='b')){
      const bishops=board.filter(p=>p.type==='b'),colors=new Set(bishops.map(p=>(p.square.charCodeAt(0)+Number(p.square[1]))%2));
      return colors.size===1&&!board.some(p=>['p','n'].includes(p.type));
    }
    return true;
  }
  rematch(id:string){
    if(this.state.phase!=='finished'||!this.state.players.includes(id)||this.state.ready.includes(id))return;
    this.state.ready.push(id);if(this.state.ready.length===2){this.state.players.reverse();this.reset();}
  }
  private reset(){this.game=new Chess(this.initialFen);Object.assign(this.state,{phase:this.state.players.length===2?'playing':'waiting',ready:[],winner:'',last:null,sound:'',clock:{remainingMs:[CHESS_TIME_MS,CHESS_TIME_MS],running:null}});this.clockAt=this.now();this.sync();this.state.clock.running=this.state.phase==='playing'?this.state.turn:null;}
  private sync(){
    const s=this.state;s.turn=this.game.turn();s.board=this.game.board().flat().filter(p=>p!==null).map(p=>({square:p.square,type:p.type,color:p.color}));s.check=this.game.isCheck();
    if(s.phase==='playing'&&this.game.isGameOver()){
      s.phase='finished';s.winner=this.game.isCheckmate()?s.players[s.turn==='w'?1:0]:'';
      s.clock.running=null;
      s.message=this.game.isCheckmate()?'Мат':this.game.isStalemate()?'Ничья: пат':this.game.isInsufficientMaterial()?'Ничья: недостаточно фигур':this.game.isThreefoldRepetition()?'Ничья: повторение позиции':'Ничья: правило 50 ходов';s.sound='win';
    }else s.message=s.phase==='waiting'?'Ждём второго игрока':s.check?'Шах':'';
    s.moves=s.phase==='playing'?this.game.moves({verbose:true}).map(m=>({from:m.from,to:m.to,...(m.promotion?{promotion:m.promotion}:{})})):[];
    s.revision++;
  }
}
