import type { PostgresDatabase } from './database';
import { CryptoError } from './crypto/config';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits } from './demoWalletAmounts';
import { SKIN_PRICE_UNITS, SKIN_UUID, type SkinPurchase } from '../src/shared/skinStudio';
import type { SkinPayments } from './skinStudio';

// The shared game wallet uses cents; the studio price contract uses millionths of a dollar.
const PRICE_CENTS = Number(BigInt(SKIN_PRICE_UNITS) / 10000n);
export class CommonSkinPayments implements SkinPayments {
  constructor(private db: PostgresDatabase, private ready: Promise<void>) {}
  async skinPurchase(accountId: string, id: string, action: 'reserve' | 'capture' | 'refund'): Promise<SkinPurchase> {
    await this.ready;
    if (!SKIN_UUID.test(id) || !['reserve', 'capture', 'refund'].includes(action)) throw new CryptoError(400, 'Некорректная покупка образа.');
    return this.db.transaction(async () => {
      const row = await this.db.prepare('SELECT * FROM skin_purchases WHERE id=?').get(id);
      if (row && row.account_id !== accountId) throw new CryptoError(409, 'Покупка принадлежит другому игроку.');
      let state = row?.state as SkinPurchase['state'] | undefined;
      if (!row) {
        if (action === 'capture') throw new CryptoError(409, 'Сначала зарезервируй оплату образа.');
        state = action === 'refund' ? 'refunded' : 'reserved';
        const balance = await demoBalanceUnits(this.db, accountId);
        if (state === 'reserved' && balance < PRICE_CENTS) throw new CryptoError(409, 'На общем балансе недостаточно денег. Нужно $10.');
        await this.db.prepare('INSERT INTO skin_purchases(id,account_id,state,created_at,updated_at) VALUES (?,?,?,?,?)')
          .run(id, accountId, state, Date.now(), Date.now());
        if (state === 'reserved') {
          await saveDemoUnits(this.db, accountId, balance - PRICE_CENTS);
          await recordDemoUnits(this.db, accountId, id, 'bet', -PRICE_CENTS, balance - PRICE_CENTS, 'atelier', 'Ателье');
        }
      } else if (state === 'reserved' && action !== 'reserve') {
        state = action === 'capture' ? 'captured' : 'refunded';
        await this.db.prepare('UPDATE skin_purchases SET state=?,updated_at=? WHERE id=?').run(state, Date.now(), id);
        if (state === 'refunded') {
          const balance = await demoBalanceUnits(this.db, accountId) + PRICE_CENTS;
          await saveDemoUnits(this.db, accountId, balance);
          await recordDemoUnits(this.db, accountId, id, 'refund', PRICE_CENTS, balance, 'atelier', 'Ателье');
        }
      } else if (state === 'captured' && action === 'refund') throw new CryptoError(409, 'Завершённая генерация уже оплачена.');
      return { id, state: state!, amountUnits: SKIN_PRICE_UNITS };
    }, { lockKey: 'account:' + accountId });
  }
}
