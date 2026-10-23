import type { PaymentClient } from './payments/client';
import { CryptoError } from './crypto/config';
import { validCombatEscrowReceipt } from '../src/shared/combatEscrow';
export interface CombatEscrow {
 fund(id:string,accounts:string[],stake:number):Promise<void>;
 settle(id:string,winner?:string):Promise<{winner:string;fee:number;payout:number}>;
 cancel?(id:string,accounts:string[],stake:number):Promise<void>;
 recoverExpired():Promise<void>;
}
export class CombatUsdtWallet implements CombatEscrow {
 private match?:{id:string;accounts:string[];stake:number};
 constructor(private client:PaymentClient){}
 private async call(action:'fund'|'settle'|'cancel',id:string,accounts:string[],stake:number,winner?:string){
  const value={id,accounts,stakeUnits:String(stake*1_000_000),...(action==='settle'?{winner:winner??''}:{})};
  const r=await this.client.combat(action,accounts[0],value);
  if(!validCombatEscrowReceipt(r)||r.id!==id||r.stakeUnits!==value.stakeUnits||JSON.stringify(r.accounts)!==JSON.stringify(accounts))throw new CryptoError(503,'Ответ банка боя не подтверждён. Проверяем ту же операцию.');
  return r;
 }
 async fund(id:string,accounts:string[],stake:number){
  this.match={id,accounts:[...accounts],stake};
  const result=await this.call('fund',id,accounts,stake);
  if(result.state!=='active')throw new CryptoError(409,'Бой уже отменён или завершён.');
 }
 async settle(id:string,winner=''){
  const match=this.match;if(!match||match.id!==id)throw new CryptoError(503,'Восстанавливаем банк боя.');
  const r=await this.call('settle',id,match.accounts,match.stake,winner);
  return{winner:r.winner,fee:Number(r.feeUnits)/1_000_000,payout:Number(r.payoutUnits)/1_000_000};
 }
 async cancel(id:string,accounts:string[],stake:number){await this.call('cancel',id,accounts,stake);}
 async recoverExpired(){/* The payment service owns durable recovery, including after game-server restarts. */}
}
