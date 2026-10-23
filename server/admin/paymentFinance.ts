import type { CryptoStore } from '../crypto/store';
import { units } from '../crypto/amounts';
import { CRYPTO_SETTLEMENT } from '../../src/shared/cryptoWallet';
import { queryFinanceReport, paymentReportSql } from './report';

export async function paymentFinanceReport(store: CryptoStore, filters: unknown) {
  await store.ready;
  let treasury: bigint | null = null, checkedAt: number | null = null;
  if (store.config.enabled) {
    try { treasury = units((await store.provider.balance())[CRYPTO_SETTLEMENT]?.amount ?? '0'); checkedAt = Date.now(); }
    catch { /* An unavailable provider balance is unknown, never zero. */ }
  }
  return queryFinanceReport(store.db,paymentReportSql,'payments',filters,async () => {
    const row = (await store.db.prepare('SELECT coalesce(sum(balance_units),0)::text AS players,coalesce(sum(reserved_units),0)::text AS reserved FROM crypto_wallets').get())!;
    return { players:String(row.players),reserved:String(row.reserved),treasury:treasury?.toString()??null,
      house:treasury===null?null:(treasury-BigInt(row.players)-BigInt(row.reserved)).toString(),checkedAt,
      ...(treasury===null?{note:store.config.enabled?'Остаток у провайдера сейчас не подтверждён.':'Платежи отключены. Сохранённая история доступна.'}:{}) };
  },store.config.enabled,async ids=>Object.fromEntries((await store.db.prepare('SELECT account_id,balance_units,reserved_units FROM crypto_wallets WHERE account_id=ANY(?::text[])').all(ids))
    .map(r=>[r.account_id,{available:String(r.balance_units),reserved:String(r.reserved_units)}])));
}
