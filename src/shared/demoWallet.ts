import { language } from '../i18n/index';
import { coinsMultiplier } from './gameCore';
import type { GamePlayRequest, GameRound } from './gameCore';

export const DEMO_BETS = [10, 50, 100, 500] as const;
export const DEMO_SYMBOLS = ['♛', '◆', '🍒', '🍋', '★'] as const;
export type WalletEntry = { id: number; kind: 'deposit' | 'bet' | 'win' | 'refund' | 'rollback'; amount: number; balance: number; operationId: string; createdAt: number; source?: string; gameName?: string | null };
export type DemoWallet = { balance: number; entries: WalletEntry[]; pendingBalance?:string };
export const validProviderBalance=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(value);
export function providerCoins(value:string):string {
  if(!validProviderBalance(value))throw new Error('Invalid provider balance');
  const [whole,fraction]=value.split('.'),groups:string[]=[];
  for(let end=whole.length;end>0;end-=3)groups.push(whole.slice(Math.max(0,end-3),end));
  return `${groups.reverse().join(language === 'en' ? ',' : '\u00a0')}${language === 'en' ? '.' : ','}${fraction}`;
}
export type DemoRound = { symbols: number[]; bet: number; payout: number; multiplier: number };
export type WalletOperation = { id: string; kind: 'deposit' | 'spin'; amount: number } | GamePlayRequest;
export type WalletResult = { wallet: DemoWallet; round?: DemoRound; gameRound?: GameRound };
export const demoMultiplier = coinsMultiplier;
