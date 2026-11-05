import type { PostgresDatabase } from './database';
import { CryptoError } from './crypto/config';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits } from './demoWalletAmounts';
import { SKIN_PRICE_UNITS,SKIN_OFFERS, SKIN_UUID, type SkinPurchase,type SkinPaymentTerms } from '../src/shared/skinStudio';
import type { SkinPayments } from './skinStudio';

export class CommonSkinPayments implements SkinPayments {
  constructor(private db: PostgresDatabase, private ready: Promise<void>) {}
  async skinPurchase(accountId: string, id: string, action: 'reserve' | 'capture' | 'refund',terms?:SkinPaymentTerms): Promise<SkinPurchase> {
    await this.ready;
    if (!SKIN_UUID.test(id) || !['reserve', 'capture', 'refund'].includes(action)) throw new CryptoError(400, 'Некорректная покупка образа.');
    // Calls without terms belong to the historical ten-dollar payment bridge.
    const offerId=terms?.offerId??'atelier',priceUnits=terms?.priceUnits??SKIN_PRICE_UNITS;
    if(!Object.hasOwn(SKIN_OFFERS,offerId)||!(priceUnits===SKIN_OFFERS[offerId].priceUnits||offerId==='atelier'&&priceUnits===SKIN_PRICE_UNITS))throw new CryptoError(400,'Некорректная цена образа.');
    const requestedCents=Number(BigInt(priceUnits)/10000n);
    return this.db.transaction(async () => {
      const row = await this.db.prepare('SELECT * FROM skin_purchases WHERE id=?').get(id);
      if (row && row.account_id !== accountId) throw new CryptoError(409, 'Покупка принадлежит другому игроку.');
      if(row&&terms&&(Number(row.amount_cents)!==requestedCents||row.offer_id!==offerId))throw new CryptoError(409,'Нельзя изменить условия принятой покупки.');
      const cents=row?Number(row.amount_cents):requestedCents,seller=row?.offer_id??offerId;
      const gameId=seller==='janitor'?'janitor-skins':'atelier',gameName=seller==='janitor'?'Жора: образы':'Ателье';
      let state = row?.state as SkinPurchase['state'] | undefined;
      if (!row) {
        if (action === 'capture') throw new CryptoError(409, 'Сначала зарезервируй оплату образа.');
        state = action === 'refund' ? 'refunded' : 'reserved';
        const balance = await demoBalanceUnits(this.db, accountId);
        if (state === 'reserved' && balance < cents) throw new CryptoError(409, 'На общем балансе недостаточно денег. Нужно $'+(cents/100).toFixed(0)+'.');
        await this.db.prepare('INSERT INTO skin_purchases(id,account_id,state,created_at,updated_at,amount_cents,offer_id) VALUES (?,?,?,?,?,?,?)')
          .run(id, accountId, state, Date.now(), Date.now(),cents,seller);
        if (state === 'reserved') {
          await saveDemoUnits(this.db, accountId, balance - cents);
          await recordDemoUnits(this.db, accountId, id, 'bet', -cents, balance - cents, gameId, gameName);
        }
      } else if (state === 'reserved' && action !== 'reserve') {
        state = action === 'capture' ? 'captured' : 'refunded';
        await this.db.prepare('UPDATE skin_purchases SET state=?,updated_at=? WHERE id=?').run(state, Date.now(), id);
        if (state === 'refunded') {
          const balance = await demoBalanceUnits(this.db, accountId) + cents;
          await saveDemoUnits(this.db, accountId, balance);
          await recordDemoUnits(this.db, accountId, id, 'refund', cents, balance, gameId, gameName);
        }
      } else if (state === 'captured' && action === 'refund') throw new CryptoError(409, 'Завершённая генерация уже оплачена.');
      return { id, state: state!, amountUnits: String(BigInt(cents)*10000n) };
    }, { lockKey: 'account:' + accountId });
  }
}
