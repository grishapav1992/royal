export type ActivityId = 'hockey' | 'pool' | 'piano' | 'chess';
export const ACTIVITIES = {
  hockey: { name:'Аэрохоккей', entry:{x:1220,y:510}, bounds:{x:1175,y:382,w:90,h:100} },
  pool: { name:'Бильярд', entry:{x:562,y:510} },
  piano: { name:'Рояль', entry:{x:120,y:340}, bounds:{x:70,y:260,w:110,h:60} },
  chess: { name:'Шахматы', entry:{x:1550,y:950}, bounds:{x:1497,y:853,w:104,h:59} },
} as const;
export const isActivity = (value: unknown): value is ActivityId => typeof value === 'string' && Object.hasOwn(ACTIVITIES,value);
export type Ball = {id:number;x:number;y:number;vx:number;vy:number;active:boolean};
export type TableState = {
  id:'hockey'|'pool'; players:string[]; phase:'waiting'|'playing'|'finished'; score:number[];
  groups:('open'|'solid'|'stripe')[]; breaking:boolean; ballInHand:'none'|'kitchen'|'table'; message:string; sound:{seq:number;kind:string};
  winner:string; turn:number; moving:boolean; balls:Ball[]; paddles:{x:number;y:number}[]; ready:string[]; serveDelay:number;
};
export const CHESS_TIME_MS=15*60*1000;
export type ChessState = {
  players:string[]; phase:'waiting'|'playing'|'finished'; turn:'w'|'b';
  board:{square:string;type:string;color:'w'|'b'}[];
  moves:{from:string;to:string;promotion?:string}[];
  last:{from:string;to:string}|null; check:boolean; winner:string; message:string;
  ready:string[]; revision:number; sound:string;
  clock:{remainingMs:[number,number];running:'w'|'b'|null};
};
export type ActivitiesState = {tables:TableState[];pianist:string;notes:number[];chess:ChessState};
export type TableUpdate = Pick<TableState,'id'> & Partial<Omit<TableState,'id'>>;
export type ActivitiesUpdate = {patch:true;tables?:TableUpdate[];pianist?:string;notes?:number[];chess?:Partial<ChessState>};
export type ActivitiesMessage = ActivitiesState | ActivitiesUpdate;

export function mergeActivities(state:ActivitiesState,message:ActivitiesMessage):ActivitiesState {
  if(!('patch' in message))return message;
  return {
    tables:message.tables?state.tables.map(table=>{
      const update=message.tables!.find(value=>value.id===table.id);
      return update?{...table,...update}:table;
    }):state.tables,
    pianist:message.pianist??state.pianist,
    notes:message.notes??state.notes,
    chess:message.chess?{...state.chess,...message.chess}:state.chess,
  };
}
export type PianoNote = {note:number;down:boolean;player:string};
export function mergePianoNote(state:ActivitiesState,note:PianoNote):ActivitiesState {
  if(note.player!==state.pianist||state.notes.includes(note.note)===note.down)return state;
  return {...state,notes:note.down?[...state.notes,note.note]:state.notes.filter(value=>value!==note.note)};
}
export const TABLE_WIDTH=720, TABLE_HEIGHT=400;
export const PIANO_NOTES = Array.from({length:17},(_,i)=>60+i);
