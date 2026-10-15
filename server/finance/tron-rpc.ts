import { NILE_GENESIS, TronReadError, integer, normalizeHeader, normalizeTronBlock, rejectTron, type TronBlock, type TronHeader } from './tron-protocol';
import { setTimeout as delay } from 'node:timers/promises';

export const NILE_ORIGINS = ['https://api.nileex.io', 'https://nile.trongrid.io'] as const;
export type TronSource = {
  id: string; origin: string;
  genesis(signal?: AbortSignal): Promise<string>;
  tip(signal?: AbortSignal): Promise<TronHeader>;
  block(height: number, signal?: AbortSignal): Promise<TronBlock>;
};
export class NileRpc implements TronSource {
  private tail: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  constructor(readonly id: string, readonly origin: string, private readonly transport: typeof fetch = fetch) {
    if (!NILE_ORIGINS.includes(origin as typeof NILE_ORIGINS[number]) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) rejectTron('nile_rpc_required');
  }
  private async request(method: 'getnowblock' | 'getblockbynum' | 'gettransactioninfobyblocknum', body: Record<string, number>, signal?: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.timeout(10000);
    try {
      const response = await this.transport(this.origin + '/walletsolidity/' + method, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error',
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (response.status === 429) return rejectTron('rpc_rate_limited');
      if (!response.ok) return rejectTron('rpc_unavailable');
      if (!response.body || Number(response.headers.get('content-length') ?? 0) > 16 * 1024 * 1024) return rejectTron('rpc_response_limit');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.length;
          if (size > 16 * 1024 * 1024) { await reader.cancel(); return rejectTron('rpc_response_limit'); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'Error')) return rejectTron('rpc_error_response');
      return parsed;
    } catch (error) {
      if (error instanceof TronReadError) throw error;
      return rejectTron(signal?.aborted ? 'scan_deadline' : 'rpc_unavailable');
    }
  }
  private query(method: 'getnowblock' | 'getblockbynum' | 'gettransactioninfobyblocknum', body: Record<string, number>, signal?: AbortSignal): Promise<unknown> {
    const result = this.tail.then(async () => {
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) return rejectTron('scan_deadline');
        const pause = Math.max(0, this.nextRequestAt - Date.now());
        if (pause) await delay(pause, undefined, { signal });
        this.nextRequestAt = Date.now() + 500;
        try { return await this.request(method, body, signal); }
        catch (error) {
          if (attempt >= 1 || !(error instanceof TronReadError) || !['rpc_unavailable', 'rpc_rate_limited'].includes(error.code)) throw error;
          await delay(1000, undefined, { signal });
        }
      }
    });
    this.tail = result.then(() => {}, () => {});
    return result;
  }
  async genesis(signal?: AbortSignal) {
    const block = normalizeHeader(await this.query('getblockbynum', { num: 0 }, signal), 0);
    if (block.hash !== NILE_GENESIS) return rejectTron('wrong_network');
    return block.hash;
  }
  async tip(signal?: AbortSignal) { return normalizeHeader(await this.query('getnowblock', {}, signal)); }
  async block(height: number, signal?: AbortSignal) {
    integer(height, 1);
    const [block, receipts] = await Promise.all([
      this.query('getblockbynum', { num: height }, signal), this.query('gettransactioninfobyblocknum', { num: height }, signal),
    ]);
    return normalizeTronBlock(block, receipts, height);
  }
}
