import { request } from 'node:http';
import { CryptoError } from './crypto/config';
import { SKIN_PRICE_UNITS, SKIN_UUID, type SkinPurchase } from '../src/shared/skinStudio';
import type { SkinPayments } from './skinStudio';

export class NileSkinPayments implements SkinPayments {
  constructor(private socket = process.env.NILE_PLAY_SOCKET_FILE) {}
  async skinPurchase(accountId: string, id: string, action: 'reserve' | 'capture' | 'refund'): Promise<SkinPurchase> {
    if (!this.socket) throw new CryptoError(503, 'Общий баланс USDT временно недоступен.');
    const body = JSON.stringify({ accountId, action: 'skin-purchase', value: { id, action } });
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: this.socket, path: '/command', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2048) req.destroy(new Error('Invalid purchase response')); else chunks.push(chunk); });
        res.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (res.statusCode !== 200 || value.id !== id || !SKIN_UUID.test(id) || !['reserved','captured','refunded'].includes(value.state) || value.amountUnits !== SKIN_PRICE_UNITS) throw new Error('Unconfirmed purchase');
            resolve(value);
          } catch { reject(new CryptoError(503, 'Не удалось подтвердить оплату образа. Проверка повторится без повторного списания.')); }
        });
        res.on('error', reject);
      });
      req.setTimeout(10000, () => req.destroy(new Error('Purchase timeout'))); req.on('error', reject); req.end(body);
    });
  }
}
