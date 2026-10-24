import { NilePlayError } from '../finance/nile-play-ledger';
import { PvpStore } from './store';
import { VIRTUAL_PVP_SCOPE } from '../../src/shared/pvp';

/** Private in-process transport. Only authenticated room code can adjudicate a game. */
export function virtualPvpCommand(store:PvpStore){
  return async(accountId:string,action:string,v:any):Promise<{status:number;value:any}>=>{
    try{
      if(action==='pvp-command'){
        if(!v||v.request?.walletScope!==VIRTUAL_PVP_SCOPE)throw new NilePlayError('Обнови страницу, чтобы использовать общий игровой баланс.',409);
        return {status:200,value:await store.command({accountId,name:v.name,roomId:v.roomId},v.request)};
      }
      if(action==='pvp-sync')return {status:200,value:{snapshots:await store.syncRoom(v.roomId,v.people),matches:await store.roomMatches(v.roomId)}};
      if(action==='pvp-result'){
        if(!v||!['win','draw','server'].includes(v.reason))throw new NilePlayError('invalid_pvp_request',400);
        await store.adjudicate(v.roomId,v.matchId,v.winnerId,v.reason);return {status:200,value:{ok:true}};
      }
      throw new NilePlayError('invalid_pvp_request',400);
    }catch(error){return {status:error instanceof NilePlayError?error.status:503,value:{code:error instanceof NilePlayError?error.code:'play_unavailable'}};}
  };
}
