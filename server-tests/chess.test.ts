import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChessGame} from '../server/chessGame';
import {Activities} from '../server/activities';
import {CHESS_TIME_MS, ACTIVITIES} from '../src/shared/activities';
const game=(fen?:string)=>{const g=new ChessGame(fen);g.join('a');g.join('b');return g;};
const move=(g:ChessGame,from:string,to:string,promotion?:string)=>assert(g.move(g.state.players[g.state.turn==='w'?0:1],from,to,promotion),from+to);
test('chess validates seats, turns, malformed and illegal moves; mate ends the match and rematch swaps colors',()=>{
 const g=game();assert.equal(g.state.board.length,32);assert.equal(g.state.moves.length,20);assert(!g.join('c'));
 assert(!g.move('c','e2','e4',undefined));assert(!g.move('b','e7','e5',undefined));assert(!g.move('a','e2','e5',undefined));assert(!g.move('a',{},'e4',undefined));assert(!g.move('a','e2','e4','k'));
 move(g,'f2','f3');move(g,'e7','e5');move(g,'g2','g4');move(g,'d8','h4');assert.equal(g.state.phase,'finished');assert.equal(g.state.winner,'b');assert.equal(g.state.message,'Мат');assert.equal(g.state.moves.length,0);
 assert(!g.move('a','e2','e4',undefined));g.rematch('c');g.rematch('a');g.rematch('a');assert.equal(g.state.phase,'finished');g.rematch('b');assert.deepEqual(g.state.players,['b','a']);assert.equal(g.state.phase,'playing');assert.equal(g.state.board.length,32);
 g.leave('b');assert.equal(g.state.phase,'waiting');assert.deepEqual(g.state.players,['a']);assert.equal(g.state.board.length,32);
});
test('castling moves the rook too; en passant removes the bypassed pawn; promotion requires a valid choice',()=>{
 const castle=game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');move(castle,'e1','g1');assert(castle.state.board.some(p=>p.square==='f1'&&p.type==='r'));move(castle,'e8','c8');assert(castle.state.board.some(p=>p.square==='d8'&&p.type==='r'));
 const ep=game();move(ep,'e2','e4');move(ep,'a7','a6');move(ep,'e4','e5');move(ep,'d7','d5');move(ep,'e5','d6');assert(!ep.state.board.some(p=>p.square==='d5'));assert.equal(ep.state.board.length,31);
 const promote=game('7k/P7/8/8/8/8/8/7K w - - 0 1');assert(!promote.move('a','a7','a8',undefined));move(promote,'a7','a8','n');assert(promote.state.board.some(p=>p.square==='a8'&&p.type==='n'));assert.equal(promote.state.phase,'finished');assert.match(promote.state.message,/недостаточно/);
});
test('check cannot be ignored; stalemate and repetition draw; only a seated player can resign',()=>{
 const check=game('4k3/8/8/8/8/8/P3r3/4K3 w - - 0 1');assert(check.state.check);assert(!check.move('a','a2','a3',undefined));
 const stale=game('7k/5K2/8/6Q1/8/8/8/8 w - - 0 1');move(stale,'g5','g6');assert.equal(stale.state.message,'Ничья: пат');assert.equal(stale.state.winner,'');
 const repeat=game();for(let i=0;i<2;i++){move(repeat,'g1','f3');move(repeat,'g8','f6');move(repeat,'f3','g1');move(repeat,'f6','g8');}assert.match(repeat.state.message,/повторение/);
 const resign=game();assert(!resign.resign('c'));assert(resign.resign('a'));assert.equal(resign.state.winner,'b');assert.equal(resign.state.phase,'finished');
});
test('activity service requires proximity, auto-seats chess players and broadcasts accepted moves',()=>{
 const visitor=(x=ACTIVITIES.chess.entry.x,y=ACTIVITIES.chess.entry.y)=>({x,y,playing:false,connected:true,activity:'',ears:false,seat:'',action:'idle',facing:'down',moving:false});
 const people=new Map([['a',visitor()],['b',visitor()],['c',visitor(900,600)]]);let broadcasts=0;
 const service=new Activities(id=>people.get(id),()=>{},()=>broadcasts++,()=>{});
 service.handle('c',{type:'join',id:'chess'});assert.equal(service.chess.state.players.length,0);
 service.handle('a',{type:'join',id:'chess'});service.handle('b',{type:'join',id:'chess'});assert(people.get('a')!.playing);assert.equal(people.get('a')!.activity,'chess');
 const before=broadcasts;service.handle('b',{type:'chess-move',from:'e7',to:'e5'});assert.equal(broadcasts,before);
 service.handle('a',{type:'chess-move',from:'e2',to:'e4'});assert.equal(broadcasts,before+1);assert.equal(service.snapshot().chess.turn,'b');
 service.leave('a');assert(!people.get('a')!.playing);assert.equal(service.chess.state.phase,'waiting');
});
test('chess clocks wait for two players, debit only the active side and switch only on a legal move',()=>{
 let now=0;const g=new ChessGame(undefined,()=>now);g.join('a');now=120000;g.tick();assert.deepEqual(g.state.clock,{remainingMs:[CHESS_TIME_MS,CHESS_TIME_MS],running:null});
 g.join('b');now+=30000;g.tick();assert.deepEqual(g.state.clock,{remainingMs:[870000,900000],running:'w'});
 now+=5000;assert(!g.move('b','e7','e5',undefined));assert(!g.move('a','e2','e5',undefined));assert.equal(g.state.clock.running,'w');assert.equal(g.state.clock.remainingMs[0],865000);
 assert(g.move('a','e2','e4',undefined));now+=12000;g.tick();assert.deepEqual(g.state.clock,{remainingMs:[865000,888000],running:'b'});
 assert(g.resign('b'));now+=50000;g.tick();assert.deepEqual(g.state.clock,{remainingMs:[865000,888000],running:null});
 g.rematch('a');g.rematch('b');assert.deepEqual(g.state.players,['b','a']);assert.deepEqual(g.state.clock,{remainingMs:[900000,900000],running:'w'});
 g.leave('a');now+=900001;g.tick();assert.deepEqual(g.state.clock,{remainingMs:[900000,900000],running:null});
});
test('elapsed server time expires a clock even without moves or simulation steps; late moves and resigns cannot replace the result',()=>{
 let now=0;const g=new ChessGame(undefined,()=>now);g.join('a');g.join('b');const revision=g.state.revision;
 now=CHESS_TIME_MS+60000;assert(!g.move('a','e2','e4',undefined));assert.equal(g.state.phase,'finished');assert.equal(g.state.winner,'b');assert.equal(g.state.message,'Время белых истекло');assert.deepEqual(g.state.clock,{remainingMs:[0,900000],running:null});assert.equal(g.state.moves.length,0);
 assert(!g.resign('b'));g.tick();assert.equal(g.state.winner,'b');assert.equal(g.state.revision,revision+1);
});
test('timeout draws when the opponent cannot mate with their material',()=>{
 for(const fen of ['7k/8/8/8/8/8/R7/7K w - - 0 1','6nk/8/8/8/8/8/Q7/7K w - - 0 1','6bk/8/8/8/8/8/R7/7K w - - 0 1']){
  let now=0;const g=new ChessGame(fen,()=>now);g.join('a');g.join('b');assert.equal(g.state.phase,'playing');now=CHESS_TIME_MS;g.tick();assert.equal(g.state.phase,'finished');assert.equal(g.state.winner,'');assert.match(g.state.message,/Ничья/);
 }
 let now=0;const g=new ChessGame('6nk/8/8/8/8/8/P7/7K w - - 0 1',()=>now);g.join('a');g.join('b');now=CHESS_TIME_MS;g.tick();assert.equal(g.state.winner,'b');
});
test('checkmate freezes both clocks and a chess-only room broadcasts clock updates without clearing the board revision',()=>{
 let now=0;const g=new ChessGame(undefined,()=>now);g.join('a');g.join('b');move(g,'f2','f3');move(g,'e7','e5');move(g,'g2','g4');move(g,'d8','h4');const clocks=structuredClone(g.state.clock);now=CHESS_TIME_MS;g.tick();assert.deepEqual(g.state.clock,clocks);
 const visitor=()=>({...ACTIVITIES.chess.entry,playing:false,connected:true,activity:'',ears:false,seat:'',action:'idle',facing:'down',moving:false});const people=new Map([['a',visitor()],['b',visitor()]]);let broadcasts=0;
 const service=new Activities(id=>people.get(id),()=>{},()=>broadcasts++,()=>{});service.handle('a',{type:'join',id:'chess'});service.handle('b',{type:'join',id:'chess'});const before=broadcasts,revision=service.chess.state.revision;
 service.tick(.1);assert.equal(broadcasts,before);service.tick(.9);assert.equal(broadcasts,before+1);assert.equal(service.chess.state.revision,revision);assert(service.chess.state.clock.remainingMs[0]<CHESS_TIME_MS);
});
