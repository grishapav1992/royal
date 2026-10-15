import { gameAccountId, nileUnits, type NileDeposit } from './nileWallet';
import { isValidCoinsOutcome } from './gameCore';

export const NILE_PLAY_SCOPE = { network: 'nile', asset: 'USDT_NILE_TEST', scale: 6, testOnly: true, spendable: true, withdrawable: false, game: 'royal-coins' } as const;
export const NILE_BETS = ['1000000', '2000000', '5000000', '10000000'] as const;
export type NileRoundRequest = { id: string; stakeUnits: string };
export type NileRound = NileRoundRequest & { payoutUnits: string; symbols: number[]; multiplier: number; createdAt: number };
export type NilePlayWallet = typeof NILE_PLAY_SCOPE & ({ state: 'disabled' } | { state: 'unassigned' } | {
  state: 'assigned'; address: string; balanceUnits: string; updatedAt: number; ready: boolean;
  maxStakeUnits: string; reserveAllocatedUnits: string; deposits: (NileDeposit & { playerUnits: string; reserveUnits: string })[]; rounds: NileRound[];
});
export type NilePlayResult = { wallet: NilePlayWallet; round: NileRound; replayed: boolean };
export function validNileRoundRequest(value: unknown): value is NileRoundRequest {
  const row = value as NileRoundRequest;
  return !!row && Object.keys(row).sort().join(',') === 'id,stakeUnits' && !!gameAccountId(row.id)
    && (NILE_BETS as readonly string[]).includes(row.stakeUnits);
}
export function validNilePlayWallet(value: unknown): value is NilePlayWallet {
  const row = value as any;
  if (!row || Object.entries(NILE_PLAY_SCOPE).some(([key, expected]) => row[key] !== expected)) return false;
  if (row.state === 'disabled' || row.state === 'unassigned') return true;
  return row.state === 'assigned' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(row.address)
    && nileUnits(row.balanceUnits) && nileUnits(row.maxStakeUnits) && nileUnits(row.reserveAllocatedUnits) && typeof row.ready === 'boolean'
    && Number.isSafeInteger(row.updatedAt) && Array.isArray(row.deposits) && row.deposits.length <= 50
    && row.deposits.every((d: any) => /^[a-f0-9]{64}$/.test(d.txId) && Number.isSafeInteger(d.logIndex) && d.logIndex >= 0
      && Number.isSafeInteger(d.height) && d.height > 0 && nileUnits(d.amountUnits) && nileUnits(d.playerUnits) && nileUnits(d.reserveUnits)
      && BigInt(d.playerUnits) + BigInt(d.reserveUnits) === BigInt(d.amountUnits))
    && Array.isArray(row.rounds) && row.rounds.length <= 50 && row.rounds.every(validNileRound);
}
export function validNileRound(row: any): row is NileRound {
  return !!row && !!gameAccountId(row.id) && (NILE_BETS as readonly string[]).includes(row.stakeUnits)
    && nileUnits(row.payoutUnits) && isValidCoinsOutcome(row.symbols,row.multiplier)
    && BigInt(row.payoutUnits) === BigInt(row.stakeUnits) * BigInt(row.multiplier)
    && Number.isSafeInteger(row.createdAt) && row.createdAt > 0;
}
