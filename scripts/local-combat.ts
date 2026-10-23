/** Local, isolated verification with synthetic provider settlements. Never use with production data. */
import { randomBytes } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { cryptoConfig } from '../server/crypto/config';
import { CryptoStore } from '../server/crypto/store';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { PaymentOutbox } from '../server/payments/outbox';
import { createPaymentApp } from '../server/payments/app';
import { startPaymentWorkers } from '../server/payments/workers';
if(process.env.NODE_ENV!=='test')throw Error('This fixture requires the isolated database test runner');
const requestSecret=randomBytes(32).toString('hex'),eventSecret=randomBytes(32).toString('hex');
process.env.PAYMENTS_SERVICE_URL='http://127.0.0.1:2689';
process.env.PAYMENTS_REQUEST_SECRET=requestSecret;process.env.PAYMENTS_EVENT_SECRET=eventSecret;
process.env.PAYMENTS_REQUEST_SECRET_FILE='';process.env.PAYMENTS_EVENT_SECRET_FILE='';
const db=new PostgresDatabase(':memory:');await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
const payments=new Map<string,Record<string,any>>();let nextId=100;
const provider={
 currencies:async()=>[{code:'usdttrc20',name:'USDT',network:'trx',memo:false}],
 estimate:async(_from:string,_to:string,value:string)=>value,minimum:async()=>'0.001',fee:async()=>'1',
 validateAddress:async()=>{},balance:async()=>({usdttrc20:{amount:'1000000'}}),
 createPayment:async(id:string,currency:string,value:string)=>{
  const payment={payment_id:String(++nextId),order_id:id,pay_currency:currency,price_currency:'usdttrc20',
   price_amount:value,pay_amount:value,pay_address:'T'+'A'.repeat(33),payment_status:'finished',
   outcome_currency:'usdttrc20',outcome_amount:value};payments.set(payment.payment_id,payment);return payment;
 },
 payment:async(id:string)=>payments.get(id)!,
} as unknown as CryptoProvider;
const outbox=new PaymentOutbox(db,'http://127.0.0.1:2688/internal/payments/events',eventSecret);
const store=new CryptoStore(db,{...cryptoConfig({}),enabled:true,combat:true},provider,outbox.ready,undefined,undefined,change=>outbox.record(change));
await store.ready;await store.reconcile();
const server=createPaymentApp(store,requestSecret).listen(2689,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const stopWorkers=startPaymentWorkers(store,outbox);
process.once('SIGTERM',()=>{void stopWorkers().then(()=>new Promise<void>(resolve=>server.close(()=>resolve()))).then(()=>db.close());});
await import('../server/index');
