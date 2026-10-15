import type { PostgresDatabase } from '../database';
import { USDT_BETS } from '../../src/shared/usdtWallet';
import { validCasinoAction, type CasinoAction } from '../../src/shared/casinoSessions';
import { advanceSession, publicSession, sessionPayout, sessionReservation, startSession, verifySessionTransition, type SessionState } from '../games/casinoSessions';

export type CasinoEvent = {accountId:string;id:string;createdAt:number;request:CasinoAction;session:SessionState;deltaUnits:string;reserveUnits:string};
export async function casinoStates(db:PostgresDatabase,accountId:string):Promise<SessionState[]> {
  const rows=await db.prepare(`SELECT payload FROM (SELECT DISTINCT ON (payload::jsonb->'session'->>'id') payload,seq FROM events
    WHERE kind='casino' AND payload::jsonb->>'accountId'=? ORDER BY payload::jsonb->'session'->>'id',seq DESC) latest ORDER BY seq DESC`).all(accountId);
  return rows.map(row=>(JSON.parse(row.payload) as CasinoEvent).session);
}
export async function casinoReserved(db:PostgresDatabase,accountId:string):Promise<bigint> {
  return (await casinoStates(db,accountId)).reduce((n,s)=>n+sessionReservation(s),0n);
}
export function casinoDelta(before:SessionState|undefined,after:SessionState):bigint {
  return !before?-BigInt(after.stakeUnits):after.state!=='active'?sessionPayout(after):0n;
}
export function makeCasinoEvent(accountId:string,op:CasinoAction,before:SessionState|undefined,now:number,draw?:((n:number)=>number)):CasinoEvent {
  const session=op.action==='start'?startSession(op,draw):advanceSession(before!,op);
  return {accountId,id:op.id,createdAt:now,request:op,session,deltaUnits:casinoDelta(before,session).toString(),reserveUnits:sessionReservation(session).toString()};
}
export function verifyCasinoEvent(row:CasinoEvent,accountId:string,states:Map<string,SessionState>):boolean {
  try {
    if(!row||Object.keys(row).sort().join(',')!=='accountId,createdAt,deltaUnits,id,request,reserveUnits,session'
      || row.accountId!==accountId||row.id!==row.request.id||!Number.isSafeInteger(row.createdAt)||row.createdAt<1||!validCasinoAction(row.request))return false;
    const op=row.request,before=op.action==='start'?undefined:states.get(op.sessionId);
    if(op.action==='start'&&(!(USDT_BETS as readonly string[]).includes(op.stakeUnits)||states.has(op.id)
      ||[...states.values()].some(s=>s.gameId===op.gameId&&s.state==='active')))return false;
    if(!verifySessionTransition(before,op,row.session)||row.deltaUnits!==casinoDelta(before,row.session).toString()
      ||row.reserveUnits!==sessionReservation(row.session).toString())return false;
    return true;
  }catch{return false;}
}
export const publicCasinoStates=(states:SessionState[])=>states.filter(s=>s.state==='active').map(publicSession);
