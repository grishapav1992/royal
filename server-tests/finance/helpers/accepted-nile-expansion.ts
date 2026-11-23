import {createHash} from 'node:crypto';
import {DemoWalletStore} from '../../../server/demoWallet';
import {demoBalanceUnits,demoReservedUnits,saveDemoUnits} from '../../../server/demoWalletAmounts';
import type {NilePlayLedger} from '../../../server/finance/nile-play-ledger';

// Write a previously accepted round with its original rules and matching journal.
// The outer financial transaction owns the account lock.
export async function seedAcceptedNileExpansion(
  ledger:NilePlayLedger,account:string,operationId:string,draw:(max:number)=>number,
  accept:(wallet:DemoWalletStore)=>Promise<unknown>,
){
  await ledger.ready;
  await ledger.db.exec('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)');
  const projection=new Proxy(ledger.db,{
    get(target,key){
      if(key==='transaction')return<T>(action:()=>Promise<T>)=>target.transaction(action);
      const value=Reflect.get(target,key,target);
      return typeof value==='function'?value.bind(target):value;
    },
  });
  const wallet=new DemoWalletStore(projection,draw);
  await wallet.ready;
  await ledger.nativeTransaction(account,async context=>{
    const balanceCents=context.available/10000n;
    await ledger.db.prepare('INSERT INTO accounts(id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
    await saveDemoUnits(ledger.db,account,Number(balanceCents));
    await accept(wallet);
    const spentCents=balanceCents-BigInt(await demoBalanceUnits(ledger.db,account));
    await context.post(
      context.available-spentCents*10000n,
      BigInt(await demoReservedUnits(ledger.db,account))*10000n,
      createHash('sha256').update('accepted-expansion-fixture:'+operationId).digest('hex'),
    );
  });
}
