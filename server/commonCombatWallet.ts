import type { CombatEscrow } from './combatWallet';
import type { NileCombatEscrow } from './finance/combat-escrow';
export class CommonCombatWallet implements CombatEscrow {
  private match?:{id:string;accounts:string[];stake:number};
  constructor(private store:NileCombatEscrow,private allowMoney:(id:string)=>Promise<void>){}
  async fund(id:string,accounts:string[],stake:number){
    for(const account of accounts)await this.allowMoney(account);
    const r=await this.store.fund(accounts[0],{id,accounts,stakeUnits:String(stake*1000000)});
    if(r.state!=='active')throw Error('Бой уже отменён или завершён.');
    this.match={id,accounts:[...accounts],stake};
  }
  async settle(id:string,winner=''){
    const m=this.match;if(!m||m.id!==id)throw Error('Обнови состояние боя.');
    const r=await this.store.settle(m.accounts[0],{id,accounts:m.accounts,stakeUnits:String(m.stake*1000000),winner});
    return {winner:r.winner,fee:Number(r.feeUnits)/1000000,payout:Number(r.payoutUnits)/1000000};
  }
  async cancel(id:string,accounts:string[],stake:number){await this.store.cancel(accounts[0],{id,accounts,stakeUnits:String(stake*1000000)});}
  async recoverExpired(){await this.store.recoverExpired();}
}
