import { gameAccountId } from './nileWallet';
export const COMBAT_USDT_STAKES = [1, 2, 5, 10, 50, 100] as const;
export type CombatEscrowReceipt = {
 id:string;accounts:[string,string];stakeUnits:string;
 state:'active'|'settled'|'refunded'|'cancelled';winner:string;
 feeUnits:string;payoutUnits:string;expiresAt:number;
};
export function validCombatEscrowReceipt(value:unknown):value is CombatEscrowReceipt{
 const r=value as CombatEscrowReceipt;
 if(!r||typeof r!=='object'||Object.keys(r).sort().join(',')!=='accounts,expiresAt,feeUnits,id,payoutUnits,stakeUnits,state,winner'
  ||!gameAccountId(r.id)||!Array.isArray(r.accounts)||r.accounts.length!==2||!r.accounts.every(gameAccountId)||r.accounts[0]===r.accounts[1]
  ||![r.stakeUnits,r.feeUnits,r.payoutUnits].every(v=>typeof v==='string'&&/^(0|[1-9]\d{0,12})$/.test(v))
  ||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<1
  ||!(COMBAT_USDT_STAKES as readonly number[]).some(n=>BigInt(n)*1_000_000n===BigInt(r.stakeUnits)))return false;
 if(r.state==='settled')return r.accounts.includes(r.winner)&&BigInt(r.feeUnits)===BigInt(r.stakeUnits)/10n&&BigInt(r.payoutUnits)===BigInt(r.stakeUnits)*19n/10n;
 return ['active','refunded','cancelled'].includes(r.state)&&r.winner===''&&r.feeUnits==='0'&&r.payoutUnits==='0';
}
