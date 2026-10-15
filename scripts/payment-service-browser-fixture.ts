import express from 'express';
import { PostgresDatabase } from '../server/database';
import { CryptoStore } from '../server/crypto/store';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { PaymentOutbox } from '../server/payments/outbox';
import { createPaymentApp } from '../server/payments/app';
if (process.env.NODE_ENV !== 'test') throw new Error('Only isolated tests may run this payment fixture');
class BrowserProvider implements CryptoProvider {
  creates = 0; payouts = 0; paymentData: any; payoutData: any;
  currencies = async () => [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }];
  estimate = async (_from: string, _to: string, value: string) => value;
  minimum = async () => '0.001'; fee = async () => '1'; validateAddress = async () => {};
  balance = async () => ({ usdttrc20: { amount: '1000' } });
  createPayment = async (id: string, currency: string, value: string) => {
    this.creates++; this.paymentData = { payment_id: String(100 + this.creates), order_id: id, pay_currency: currency,
      price_currency: 'usdttrc20', price_amount: value, pay_amount: value, pay_address: 'T' + 'A'.repeat(33),
      payment_status: 'waiting', outcome_currency: 'usdttrc20', outcome_amount: value };
    return this.paymentData;
  };
  payment = async () => this.paymentData;
  convert = async () => { throw new Error('No conversion in this fixture'); };
  conversion = async () => { throw new Error('No conversion in this fixture'); };
  createPayout = async (id: string, currency: string, address: string, memo: string, amount: string) => {
    this.payouts++; this.payoutData = { id: String(300 + this.payouts), batch_withdrawal_id: '401', unique_external_id: id,
      currency, address, extra_id: memo, amount, status: 'finished', hash: 'test-payout' };
    return { id: '401', withdrawals: [this.payoutData] };
  };
  payout = async () => this.payoutData; verify = async () => {};
}

const db=new PostgresDatabase('payment_service_browser');
await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
const outbox=new PaymentOutbox(db,'http://127.0.0.1:2590/internal/payments/events','b'.repeat(64));
const provider=new BrowserProvider();
const store=new CryptoStore(db,{...cryptoConfig({}),enabled:true,withdrawals:true,games:false,ipnSecret:'fake-test-ipn-secret'},provider,outbox.ready,undefined,undefined,event=>outbox.record(event));
await store.ready;
const app=express();
app.post('/test/settle',async (_req,res)=>{try { provider.paymentData.payment_status='finished'; provider.paymentData.outcome_amount='19'; await store.applyPayment(provider.paymentData);await outbox.flush();res.json({ok:true}); }catch{res.status(503).json({ok:false});}});
app.get('/test/stats',async (_req,res)=>res.json({creates:provider.creates,events:(await db.prepare('SELECT count(*)::int AS n FROM payment_outbox').get())!.n}));
app.use(createPaymentApp(store,'a'.repeat(64)));
const server=app.listen(2591,'127.0.0.1');
process.once('SIGTERM',()=>{server.close();void db.close();});
