import { gameAccountId, nileUnits } from './nileWallet';
import { isValidCoinsOutcome, rouletteRedNumbers, type GameInput, type GameRound } from './gameCore';
import { validCasinoSession, type CasinoSession } from './casinoSessions';

export const USDT_SCOPE = { network: 'tron-mainnet', asset: 'USDT', scale: 6, testOnly: false, withdrawable: false } as const;
export const USDT_BETS = ['1000000', '2000000', '5000000', '10000000'] as const;
export type UsdtGameId = 'royal-coins' | 'royal-roulette';
export type UsdtRequest = { id: string; stakeUnits: string; gameId: UsdtGameId; input: GameInput };
export type UsdtRound = Extract<GameRound, { gameId: UsdtGameId }> & { id: string; createdAt: number };
export type UsdtDeposit = { txId: string; logIndex: number; height: number; amountUnits: string };
export type UsdtWallet = typeof USDT_SCOPE & ({ state: 'disabled' | 'unassigned' } | {
  state: 'assigned'; address: string; senderAddress: string; balanceUnits: string; ready: boolean; updatedAt: number;
  maxStakeUnits: Record<UsdtGameId, string>; deposits: UsdtDeposit[]; rounds: UsdtRound[]; casinoRounds?: CasinoSession[];
});
export type UsdtResult = { wallet: UsdtWallet; round: UsdtRound; replayed: boolean };
export function validUsdtRequest(value: unknown): value is UsdtRequest {
  const row = value as UsdtRequest;
  if (!row || Object.keys(row).sort().join(',') !== 'gameId,id,input,stakeUnits' || !gameAccountId(row.id)
    || !(USDT_BETS as readonly string[]).includes(row.stakeUnits) || !row.input || Array.isArray(row.input)) return false;
  if (row.gameId === 'royal-coins') return Object.keys(row.input).length === 0;
  if (row.gameId !== 'royal-roulette' || !('bet' in row.input)) return false;
  const input = row.input;
  return input.bet === 'number' ? Object.keys(input).sort().join(',') === 'bet,number' && Number.isInteger(input.number) && input.number >= 0 && input.number <= 36
    : ['red', 'black', 'even', 'odd'].includes(input.bet) && Object.keys(input).join(',') === 'bet';
}
export function validUsdtRound(value: unknown): value is UsdtRound {
  const row = value as UsdtRound;
  if (!row || !validUsdtRequest({ id: row.id, stakeUnits: row.stakeUnits, gameId: row.gameId, input: row.input })
    || row.rulesVersion !== 1 || !nileUnits(row.payoutUnits) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 1
    || !Number.isSafeInteger(row.multiplier) || row.multiplier < 0 || row.multiplier > 36
    || BigInt(row.payoutUnits) !== BigInt(row.stakeUnits) * BigInt(row.multiplier ?? -1)) return false;
  if (row.gameId === 'royal-coins') return isValidCoinsOutcome(row.outcome?.symbols, row.multiplier);
  const n = row.outcome?.number;
  if (!Number.isInteger(n) || n < 0 || n > 36) return false;
  const input = row.input;
  const won = input.bet === 'number' ? n === input.number : n !== 0 && (input.bet === 'red' ? rouletteRedNumbers.includes(n)
    : input.bet === 'black' ? !rouletteRedNumbers.includes(n) : input.bet === 'even' ? n % 2 === 0 : n % 2 === 1);
  return row.multiplier === (won ? input.bet === 'number' ? 36 : 2 : 0);
}
export function validUsdtWallet(value: unknown): value is UsdtWallet {
  const row = value as any;
  if (!row || Object.entries(USDT_SCOPE).some(([key, expected]) => row[key] !== expected)) return false;
  if (row.state === 'disabled' || row.state === 'unassigned') return true;
  return row.state === 'assigned' && [row.address, row.senderAddress].every(a => typeof a === 'string' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a))
    && nileUnits(row.balanceUnits) && typeof row.ready === 'boolean' && Number.isSafeInteger(row.updatedAt)
    && row.maxStakeUnits && ['royal-coins', 'royal-roulette'].every(id => nileUnits(row.maxStakeUnits[id]))
    && Array.isArray(row.deposits) && row.deposits.length <= 50 && row.deposits.every((d: any) => /^[a-f0-9]{64}$/.test(d.txId)
      && Number.isSafeInteger(d.logIndex) && d.logIndex >= 0 && Number.isSafeInteger(d.height) && d.height > 0 && nileUnits(d.amountUnits) && BigInt(d.amountUnits) > 0n)
    && Array.isArray(row.rounds) && row.rounds.length <= 50 && row.rounds.every(validUsdtRound)
    && (row.casinoRounds === undefined || Array.isArray(row.casinoRounds) && row.casinoRounds.length <= 50
      && row.casinoRounds.every((s: unknown) => validCasinoSession(s) && s.state !== 'active'));
}
