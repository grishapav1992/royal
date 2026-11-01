import {randomUUID} from 'node:crypto';
import {pvpPayout,type PvpChallenge} from '../../src/shared/pvp';
import type {PvpLedger} from '../../server/pvp/store';
/** Accepted historical terms, seeded without reopening their retired creation API. */
export async function acceptedLegacyTsu(ledger:PvpLedger,actors:{accountId:string;name:string;roomId:string}[],options:{mode?:'free'|'stake';targetWins?:3|5|7;legacy?:boolean},now:number){
  const a=actors[0],free=options.mode==='free',id=randomUUID();
  const challenge:PvpChallenge={id,gameId:'tsu-e-fa',creatorId:a.accountId,creatorName:a.name,targetId:actors[1].accountId,opponentId:null,opponentName:'',stakeUnits:free?'0':'1100000',
    ...(free?{potUnits:'0',feeUnits:'0',payoutUnits:'0'}:pvpPayout('1100000')),rulesVersion:options.legacy?1:2,mode:options.mode??'stake',targetWins:options.targetWins??3,
    status:'open',createdAt:now,expiresAt:now+120000,ready:[],winnerId:null,reason:'',revision:0,disconnected:[]};
  const stored={challenge,cards:null,roomId:a.roomId,lastMoveAt:now,roomSeenAt:now};
  await ledger.db.prepare('INSERT INTO pvp_matches VALUES(?,?,?,?,?,?,?)').run(id,a.roomId,a.accountId,null,'open',JSON.stringify(stored),now);
  if(!free)await ledger.pvpHold(a.accountId,{matchId:id,gameId:'tsu-e-fa',stakeUnits:'1100000'},now);
  return challenge;
}
