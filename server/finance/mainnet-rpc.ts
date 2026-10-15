import { MAINNET_GENESIS, MAINNET_ORIGINS, MAINNET_USDT_TOKEN, UsdtError, usdtFail } from './mainnet-config';
import { normalizeHeader, normalizeTronBlock, type TronBlock, type TronHeader } from './tron-protocol';
import { setTimeout as delay } from 'node:timers/promises';

export interface MainnetSource {
  origin: string; genesis(signal?: AbortSignal): Promise<string>; tip(signal?: AbortSignal): Promise<TronHeader>;
  header(height: number, signal?: AbortSignal): Promise<TronHeader>;
  block(height: number, signal?: AbortSignal): Promise<TronBlock>; balance(address: string, signal?: AbortSignal): Promise<string>;
}
export class MainnetRpc implements MainnetSource {
  private tail:Promise<void>=Promise.resolve();
  private nextRequestAt=0;
  constructor(readonly origin: string, private key?: string, private transport: typeof fetch = fetch) {
    if (!(MAINNET_ORIGINS as readonly string[]).includes(origin)) usdtFail('mainnet_rpc_required', 503);
  }
  private query(method:string,body:unknown,signal?:AbortSignal):Promise<any>{
    const result=this.tail.then(async()=>{
      for(let attempt=0;;attempt++){
        if(signal?.aborted)usdtFail('mainnet_scan_deadline',503);
        const pause=Math.max(0,this.nextRequestAt-Date.now());if(pause)await delay(pause,undefined,{signal});
        this.nextRequestAt=Date.now()+500;
        try{return await this.request(method,body,signal);}
        catch(e){if(attempt>=1||signal?.aborted||(e instanceof UsdtError&&!['mainnet_rpc_unavailable','mainnet_rpc_rate_limited'].includes(e.code)))throw e;await delay(750,undefined,{signal});}
      }
    });this.tail=result.then(()=>{},()=>{});return result;
  }
  private async request(method: string, body: unknown, signal?: AbortSignal): Promise<any> {
    const response = await this.transport(this.origin + '/walletsolidity/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.key ? { 'TRON-PRO-API-KEY': this.key } : {}) },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
    });
    if(response.status===429)usdtFail('mainnet_rpc_rate_limited',503);
    if (!response.ok || !response.body) usdtFail('mainnet_rpc_unavailable', 503);
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as any) {
      size += chunk.length; if (size > 16 * 1024 * 1024) usdtFail('mainnet_rpc_response_limit', 503); chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result?.Error) usdtFail('mainnet_rpc_error', 503);
    return result;
  }
  async genesis(signal?: AbortSignal) {
    const row = await this.header(0, signal);
    if (row.hash !== MAINNET_GENESIS) usdtFail('mainnet_wrong_network', 503);
    return row.hash;
  }
  async tip(signal?: AbortSignal) { return normalizeHeader(await this.query('getnowblock', {}, signal)); }
  async header(height: number, signal?: AbortSignal) { return normalizeHeader(await this.query('getblockbynum', { num: height }, signal), height); }
  async block(height: number, signal?: AbortSignal) {
    const [block, receipts] = await Promise.all([this.query('getblockbynum', { num: height }, signal), this.query('gettransactioninfobyblocknum', { num: height }, signal)]);
    return normalizeTronBlock(block, receipts, height);
  }
  async balance(address: string, signal?: AbortSignal) {
    const result = await this.query('triggerconstantcontract', { owner_address: address, contract_address: MAINNET_USDT_TOKEN,
      function_selector: 'balanceOf(address)', parameter: address.slice(2).padStart(64, '0'), visible: false }, signal);
    if (result?.result?.result !== true || result.constant_result?.length !== 1 || !/^[a-fA-F0-9]{64}$/.test(result.constant_result[0])) usdtFail('mainnet_balance_unavailable', 503);
    return BigInt('0x' + result.constant_result[0]).toString();
  }
}
