import { createHash } from 'node:crypto';
import type { CasinoApiProGame } from '../src/shared/casinoApiPro';

export type CasinoApiProConfig = { apiKey: string; apiSecret: string; walletSecret: string; currency: string; publicOrigin: string };
export class CasinoApiProError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function casinoApiProConfig(env: NodeJS.ProcessEnv = process.env): CasinoApiProConfig | undefined {
  if (env.CASINOAPIPRO_ENABLED !== 'true') return;
  const { CASINOAPIPRO_API_KEY: apiKey = '', CASINOAPIPRO_API_SECRET: apiSecret = '', CASINOAPIPRO_WALLET_SECRET: walletSecret = '', CASINOAPIPRO_CURRENCY: currency = 'USD', PUBLIC_ORIGIN: publicOrigin = '' } = env;
  if (!/^ck_test_[A-Za-z0-9_-]{8,120}$/.test(apiKey) || !/^cs_test_[A-Za-z0-9_-]{8,240}$/.test(apiSecret) || !/^[a-f0-9]{64}$/i.test(walletSecret)) throw new Error('Casino Api Pro requires sandbox credentials and a 32-byte wallet secret');
  if (!['USD','EUR','GBP','GHS','RUB','BRL'].includes(currency)) throw new Error('Casino Api Pro requires a supported two-decimal test currency');
  const url = new URL(publicOrigin);
  if (url.origin !== publicOrigin || (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Casino Api Pro requires a public HTTPS origin');
  return { apiKey,apiSecret,walletSecret,currency,publicOrigin };
}
export const walletBinding = (config: CasinoApiProConfig) => createHash('sha256').update(`${config.apiKey}:${config.walletSecret}:${config.currency}`).digest('hex');

export class CasinoApiProClient {
  private token?: { value: string; until: number };
  private authenticating?: Promise<string>;
  private catalogue?: { games: CasinoApiProGame[]; until: number };
  private loading?: Promise<CasinoApiProGame[]>;
  constructor(readonly config: CasinoApiProConfig, private request: typeof fetch = fetch) {}
  private async tokenValue() {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      const response = await this.request('https://api.casinoapipro.com/v1/auth/token', { method:'POST', redirect:'error', headers:{'Content-Type':'application/json'}, body:JSON.stringify({api_key:this.config.apiKey,api_secret:this.config.apiSecret}),signal:AbortSignal.timeout(15000) });
      if (!response.ok) throw new CasinoApiProError(502,'PROVIDER_AUTH','Поставщик не принял тестовые ключи.');
      const data = await response.json();
      if (data.environment !== 'SANDBOX' || typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in < 60) throw new CasinoApiProError(502,'WRONG_ENVIRONMENT','Поставщик не подтвердил тестовый режим.');
      this.token = { value:data.access_token,until:Date.now() + (data.expires_in - 30) * 1000 };
      return this.token.value;
    })();
    try { return await this.authenticating; } finally { this.authenticating = undefined; }
  }
  private async call(path: string, body?: unknown) {
    const response = await this.request(`https://api.casinoapipro.com${path}`, { method:body === undefined ? 'GET' : 'POST',redirect:'error',headers:{Authorization:`Bearer ${await this.tokenValue()}`,'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(20000) });
    if (!response.ok) {
      if (response.status === 401) this.token = undefined;
      throw new CasinoApiProError(502,'PROVIDER_UNAVAILABLE','Не удалось получить ответ поставщика. Попробуй ещё раз.');
    }
    return response.json();
  }
  async games() {
    if (this.catalogue && this.catalogue.until > Date.now()) return this.catalogue.games;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const games: CasinoApiProGame[] = [], seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({limit:'200',enabled_only:'true'});
        if (cursor) query.set('cursor',cursor);
        const data = await this.call(`/v1/games/?${query}`);
        if (!Array.isArray(data.data)) throw new CasinoApiProError(502,'INVALID_CATALOGUE','Каталог поставщика имеет неизвестный формат.');
        for (const game of data.data) {
          if (!game?.enabled || game.status !== 'ACTIVE' || !Array.isArray(game.currencies) || !game.currencies.includes(this.config.currency) || typeof game.id !== 'string' || typeof game.slug !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(game.slug) || typeof game.name !== 'string' || seen.has(game.id)) continue;
          let thumbnailUrl: string | undefined;
          try {
            const art = new URL(game.thumbnail_url);
            if (art.protocol === 'https:' && !art.username && !art.password && ['casinoapipro.com','assets.casinoapipro.com','games.casinoapipro.com','api.casinoapipro.com'].includes(art.hostname)) thumbnailUrl = art.href;
          } catch { /* A missing cover does not prevent play. */ }
          games.push({id:game.id,slug:game.slug,name:game.name.slice(0,120),category:String(game.category ?? '').slice(0,50),thumbnailUrl,minBet:String(game.min_bet),maxBet:String(game.max_bet)}); seen.add(game.id);
        }
        if (!data.has_more) {
          this.catalogue = { games,until:Date.now()+60000 }; return games;
        }
        if (typeof data.next_cursor !== 'string' || data.next_cursor === cursor) break;
        cursor = data.next_cursor;
      }
      throw new CasinoApiProError(502,'INVALID_CATALOGUE','Не удалось загрузить полный каталог поставщика.');
    })();
    try { return await this.loading; } finally { this.loading = undefined; }
  }
  async launch(gameId: unknown, playerId: string) {
    if (typeof gameId !== 'string') throw new CasinoApiProError(400,'INVALID_GAME','Выбери игру из каталога.');
    const game = (await this.games()).find(game => game.id === gameId);
    if (!game) throw new CasinoApiProError(404,'INVALID_GAME','Игра недоступна в тестовом каталоге.');
    const data = await this.call('/v1/sessions/',{game_id:game.id,player_id:playerId,currency:this.config.currency,language:'en',return_url:this.config.publicOrigin,ttl_seconds:3600});
    let url: URL;
    try { url = new URL(data.launch_url); } catch { throw new CasinoApiProError(502,'INVALID_LAUNCH','Поставщик вернул недопустимый адрес игры.'); }
    if (url.origin !== 'https://games.casinoapipro.com' || url.pathname !== '/play' || url.username || url.password || !url.searchParams.get('token') || data.player_id !== playerId || data.currency !== this.config.currency || data.game?.id !== game.id) throw new CasinoApiProError(502,'INVALID_LAUNCH','Поставщик вернул недопустимую игровую сессию.');
    return {launchUrl:url.href,game,currency:this.config.currency};
  }
}
