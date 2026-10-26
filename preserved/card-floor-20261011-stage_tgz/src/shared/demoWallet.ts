import { coinsMultiplier } from './gameCore';
import type { GamePlayRequest, GameRound } from './gameCore';

export const DEMO_BETS = [10, 50, 100, 500] as const;
export const DEMO_SYMBOLS = ['♛', '◆', '🍒', '🍋', '★'] as const;
export type WalletEntry = { id: number; kind: 'deposit' | 'bet' | 'win' | 'refund' | 'rollback'; amount: number; balance: number; operationId: string; createdAt: number; source?: string; gameName?: string | null };
export type DemoWallet = { balance: number; entries: WalletEntry[] };
export type DemoRound = { symbols: number[]; bet: number; payout: number; multiplier: number };
export type WalletOperation = { id: string; kind: 'deposit' | 'spin'; amount: number } | GamePlayRequest;
export type WalletResult = { wallet: DemoWallet; round?: DemoRound; gameRound?: GameRound };
export const demoMultiplier = coinsMultiplier;
