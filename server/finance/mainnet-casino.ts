import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../database';
import { USDT_BETS } from '../../src/shared/usdtWallet';
import { isSessionGame, type CasinoAction } from '../../src/shared/casinoSessions';
import { advanceSession, publicSession, sessionReservation, startSession, type SessionState } from '../games/casinoSessions';
import { isLegacyTowerState, legacyCasinoPayout, legacyCasinoReservation, verifyLegacyCasinoRetirement, verifyLegacyCasinoTransition,
  type LegacyCasinoAction, type LegacyCasinoState } from '../games/legacyCasinoSessions';

type RetirementAction = { id:string;gameId:'github-tower';action:'retire';sessionId:string };
export type CasinoEvent = {accountId:string;id:string;createdAt:number;request:CasinoAction|LegacyCasinoAction|RetirementAction;session:LegacyCasinoState;deltaUnits:string;reserveUnits:string};
export async function casinoStates(db:PostgresDatabase,accountId:string):Promise<LegacyCasinoState[]> {
  const rows=await db.prepare(`SELECT payload FROM (SELECT DISTINCT ON (payload::jsonb->'session'->>'id') payload,seq FROM events
    WHERE kind='casino' AND payload::jsonb->>'accountId'=? ORDER BY payload::jsonb->'session'->>'id',seq DESC) latest ORDER BY seq DESC`).all(accountId);
  return rows.map(row=>(JSON.parse(row.payload) as CasinoEvent).session);
}
export async function casinoReserved(db:PostgresDatabase,accountId:string):Promise<bigint> {
  return (await casinoStates(db,accountId)).reduce((n,s)=>n+legacyCasinoReservation(s),0n);
}
export function casinoDelta(before:LegacyCasinoState|undefined,after:LegacyCasinoState):bigint {
  return !before?-BigInt(after.stakeUnits):after.state!=='active'?legacyCasinoPayout(after):0n;
}
export function makeCasinoEvent(accountId:string,op:CasinoAction,before:SessionState|undefined,now:number,draw?:((n:number)=>number)):CasinoEvent {
  const session=op.action==='start'?startSession(op,draw):advanceSession(before!,op);
  return {accountId,id:op.id,createdAt:now,request:op,session,deltaUnits:casinoDelta(before,session).toString(),reserveUnits:sessionReservation(session).toString()};
}
function retirementId(accountId:string,sessionId:string):string {
  const hex=createHash('sha256').update('remove-casino-v1:'+accountId+':'+sessionId).digest('hex').slice(0,32);
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
}
export function makeCasinoRetirement(accountId:string,before:LegacyCasinoState,now:number):CasinoEvent {
  if(!isLegacyTowerState(before)||before.state!=='active')throw Error('Invalid removed casino state');
  const id=retirementId(accountId,before.id),session={...structuredClone(before),state:'cashed_out' as const};
  return {accountId,id,createdAt:now,request:{id,gameId:before.gameId,action:'retire',sessionId:before.id},session,
    deltaUnits:legacyCasinoPayout(before).toString(),reserveUnits:'0'};
}
export function verifyCasinoEvent(row:CasinoEvent,accountId:string,states:Map<string,LegacyCasinoState>):boolean {
  try {
    if(!row||Object.keys(row).sort().join(',')!=='accountId,createdAt,deltaUnits,id,request,reserveUnits,session'
      || row.accountId!==accountId||row.id!==row.request.id||!Number.isSafeInteger(row.createdAt)||row.createdAt<1)return false;
    const op=row.request,before=op.action==='start'?undefined:states.get(op.sessionId);
    if(op.action==='retire')return !!before&&op.gameId==='github-tower'
      && Object.keys(op).sort().join(',')==='action,gameId,id,sessionId'
      && op.id===retirementId(accountId,before.id)&&op.sessionId===before.id
      && verifyLegacyCasinoRetirement(before,row.session)
      && row.deltaUnits===legacyCasinoPayout(before).toString()&&row.reserveUnits==='0';
    if(op.action==='start'&&(!(USDT_BETS as readonly string[]).includes(op.stakeUnits)||states.has(op.id)
      ||[...states.values()].some(s=>s.gameId===op.gameId&&s.state==='active')))return false;
    if(!verifyLegacyCasinoTransition(before,op,row.session)||row.deltaUnits!==casinoDelta(before,row.session).toString()
      ||row.reserveUnits!==legacyCasinoReservation(row.session).toString())return false;
    return true;
  }catch{return false;}
}
export const publicCasinoStates=(states:LegacyCasinoState[])=>states.filter((s):s is SessionState=>isSessionGame(s.gameId)&&s.state==='active').map(publicSession);
