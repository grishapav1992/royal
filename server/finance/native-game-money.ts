import {gameAccountId,nileUnits} from '../../src/shared/nileWallet';
export type NativeMoneyEvent={version:1;id:string;accountId:string;userId:string;beforeUnits:string;afterUnits:string;beforeReserveUnits:string;afterReserveUnits:string;createdAt:number;requestHash:string};
export function nativeMoneyEntries(row:NativeMoneyEvent){
 if(!row||Object.keys(row).sort().join(',')!=='accountId,afterReserveUnits,afterUnits,beforeReserveUnits,beforeUnits,createdAt,id,requestHash,userId,version'
  ||row.version!==1||!gameAccountId(row.id)||!gameAccountId(row.accountId)||!/^[a-zA-Z0-9_-]{1,64}$/.test(row.userId)
  ||![row.beforeUnits,row.afterUnits,row.beforeReserveUnits,row.afterReserveUnits].every(nileUnits)
  ||!Number.isSafeInteger(row.createdAt)||row.createdAt<1||!/^[a-f0-9]{64}$/.test(row.requestHash))throw Error('Invalid native money event');
 const delta=BigInt(row.afterUnits)-BigInt(row.beforeUnits),reserve=BigInt(row.afterReserveUnits)-BigInt(row.beforeReserveUnits);
 if(delta%10000n!==0n||reserve%10000n!==0n)throw Error('Native game cents must be exact');
 return[{account:'player:'+row.userId,units:String(delta)},{account:'house',units:String(-delta-reserve)},
  {account:'games-reserved:'+row.userId,units:String(reserve)}];
}
