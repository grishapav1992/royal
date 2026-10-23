import { playCommand } from './nilePlayRoutes';
import { validCombatEscrowReceipt } from '../src/shared/combatEscrow';
export interface CombatEscrow {
 fund(id:string,accounts:string[],stake:number):Promise<void>;
 settle(id:string,winner?:string):Promise<{winner:string;fee:number;payout:number}>;
 cancel?(id:string,accounts:string[],stake:number):Promise<void>;
 recoverExpired():Promise<void>;
}
class CombatWalletError extends Error {
 constructor(readonly status:number,message:string){super(message);}
}
const messages:Record<string,string>={
 play_wallet_unassigned:'Открой общий кошелёк USDT · Nile и получи адрес пополнения.',
 play_insufficient_balance:'У одного из игроков недостаточно USDT · Nile.',
 combat_already_playing:'Сначала заверши другой бой.',
 play_idempotency_conflict:'Номер боя уже использован с другими ставками.',
};
export class CombatUsdtWallet implements CombatEscrow {
 private match?:{id:string;accounts:string[];stake:number};
 constructor(private socket:string){}
 private async call(action:'fund'|'settle'|'cancel',id:string,accounts:string[],stake:number,winner?:string){
  if(!this.socket)throw new CombatWalletError(503,'Общий кошелёк USDT · Nile временно недоступен.');
  const value={id,accounts,stakeUnits:String(stake*1_000_000),...(action==='settle'?{winner:winner??''}:{})};
  const response=await playCommand(this.socket,accounts[0],'combat-'+action,value);
  if(response.status!==200)throw new CombatWalletError(response.status,messages[response.value?.code]??'Не удалось подтвердить банк боя. Повтори проверку.');
  const r=response.value;
  if(!validCombatEscrowReceipt(r)||r.id!==id||r.stakeUnits!==value.stakeUnits||JSON.stringify(r.accounts)!==JSON.stringify(accounts)
   ||action!=='fund'&&r.state==='active')throw new CombatWalletError(503,'Ответ банка боя не подтверждён. Проверяем ту же операцию.');
  return r;
 }
 async fund(id:string,accounts:string[],stake:number){
  this.match={id,accounts:[...accounts],stake};
  const result=await this.call('fund',id,accounts,stake);
  if(result.state!=='active')throw new CombatWalletError(409,'Бой уже отменён или завершён.');
 }
 async settle(id:string,winner=''){
  const match=this.match;if(!match||match.id!==id)throw new CombatWalletError(503,'Восстанавливаем банк боя.');
  const r=await this.call('settle',id,match.accounts,match.stake,winner);
  return{winner:r.winner,fee:Number(r.feeUnits)/1_000_000,payout:Number(r.payoutUnits)/1_000_000};
 }
 async cancel(id:string,accounts:string[],stake:number){await this.call('cancel',id,accounts,stake);}
 async recoverExpired(){/* The common Nile service owns recovery after game-server restarts. */}
}
