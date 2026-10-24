import { gameAccountId, nileUnits } from './nileWallet';
import type { NilePlayWallet } from './nilePlay';
import type { DemoWallet } from './demoWallet';

export const VIRTUAL_PVP_SCOPE = 'virtual-usdt-v1' as const;
export type VirtualPvpWallet = { scope: typeof VIRTUAL_PVP_SCOPE; state:'assigned'; ready:true;
  balanceUnits:string; reservedUnits:string; wallet:DemoWallet };
export function validVirtualPvpWallet(value: unknown): value is VirtualPvpWallet {
  const row=value as VirtualPvpWallet;
  return !!row && row.scope===VIRTUAL_PVP_SCOPE && row.state==='assigned' && row.ready===true
    && nileUnits(row.balanceUnits) && nileUnits(row.reservedUnits) && !!row.wallet
    && !row.wallet.asset && Number.isFinite(row.wallet.balance) && row.wallet.balance>=0 && Array.isArray(row.wallet.entries)
    && BigInt(row.balanceUnits)===BigInt(Math.round(row.wallet.balance*100))*10000n;
}
export const validVirtualPvpStake = (value:unknown):value is string => validPvpStake(value) && BigInt(value)%100000n===0n;

export const PVP_GAMES = {
  hockey: 'Аэрохоккей', pool: 'Бильярд', chess: 'Шахматы',
  durak: 'Подкидной дурак', 'transfer-durak': 'Переводной дурак', 'crazy-eights': 'Восьмёрки',
} as const;
export type PvpGameId = keyof typeof PVP_GAMES;
export type PvpCardGameId = Extract<PvpGameId, 'durak' | 'transfer-durak' | 'crazy-eights'>;
export const isPvpGame = (id: unknown): id is PvpGameId => typeof id === 'string' && Object.hasOwn(PVP_GAMES, id);
export const isPvpCardGame = (id: unknown): id is PvpCardGameId => ['durak', 'transfer-durak', 'crazy-eights'].includes(String(id));
export const PVP_RECONNECT_MS = 60_000;
export const PVP_INVITE_MS = 120_000;
export const PVP_ARRIVAL_MS = 180_000;
export const PVP_MOVE_MS = 60_000;
export const PVP_MIN_STAKE = 1_000_000n;
export const PVP_MAX_STAKE = 500_000_000n;
export const validPvpStake = (value: unknown): value is string => nileUnits(value)
  && BigInt(value) >= PVP_MIN_STAKE && BigInt(value) <= PVP_MAX_STAKE && BigInt(value) % 10_000n === 0n;

/** The commission is 5% of the whole pot, including the winner's stake. */
export function pvpPayout(stakeUnits: string) {
  if (!validPvpStake(stakeUnits)) throw Error('Недопустимая ставка.');
  const pot = BigInt(stakeUnits) * 2n, fee = pot * 5n / 100n;
  return { potUnits: String(pot), feeUnits: String(fee), payoutUnits: String(pot - fee) };
}
export type CardSuit = 0 | 1 | 2 | 3;
export type PvpCard = number;
export const cardSuit = (card: PvpCard): CardSuit => Math.floor(card / 13) as CardSuit;
export const cardRank = (card: PvpCard) => card % 13 + 2;
export const cardLabel = (card: PvpCard) => (({ 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' } as Record<number, string>)[cardRank(card)] ?? String(cardRank(card))) + ['♠', '♥', '♦', '♣'][cardSuit(card)];
export type PvpCardMove = { kind: 'play' | 'attack' | 'defend' | 'transfer'; card: PvpCard; target?: number; suit?: CardSuit }
  | { kind: 'take' | 'done' | 'draw' | 'pass' };
export type PvpCardView = {
  gameId: PvpCardGameId; revision: number; phase: 'playing' | 'finished';
  hand: PvpCard[]; opponentCount: number; stockCount: number; discardCount: number;
  trump: PvpCard | null; suit: CardSuit; table: { attack: PvpCard; defense?: PvpCard }[];
  actor: number; attacker: number; self: number; collecting: boolean;
  winner: number | null; message: string; moves: PvpCardMove[];
};
export type PvpChallenge = {
  id: string; gameId: PvpGameId; creatorId: string; creatorName: string;
  targetId: string | null; opponentId: string | null; opponentName: string;
  stakeUnits: string; potUnits: string; feeUnits: string; payoutUnits: string;
  status: 'open' | 'arriving' | 'playing' | 'finished' | 'cancelled';
  createdAt: number; expiresAt: number; ready: string[]; winnerId: string | null;
  reason: string; revision: number; disconnected: { accountId: string; until: number }[];
};
export type PvpRequest = ({ id: string; action: 'create'; gameId: PvpGameId; stakeUnits: string; targetId: string | null }
  | { id: string; action: 'accept' | 'cancel' | 'ready' | 'resign'; challengeId: string }
  | { id: string; action: 'move'; challengeId: string; revision: number; move: PvpCardMove }) & { walletScope?:typeof VIRTUAL_PVP_SCOPE };
export type PvpPerson = { accountId: string; name: string; available: boolean };
export type PvpSnapshot = { challenges: PvpChallenge[]; active: PvpChallenge | null; cards: PvpCardView | null;
  people: PvpPerson[]; wallet: NilePlayWallet | VirtualPvpWallet; now: number; error?: string; requestId?: string };
export function validPvpRequest(value: unknown): value is PvpRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as PvpRequest;
  if (!gameAccountId(row.id)) return false;
  if(row.walletScope!==undefined && row.walletScope!==VIRTUAL_PVP_SCOPE)return false;
  const keys = Object.keys(row).filter(k=>k!=='walletScope').sort().join(',');
  if (row.action === 'create') return keys === 'action,gameId,id,stakeUnits,targetId' && isPvpGame(row.gameId)
    && validPvpStake(row.stakeUnits) && (row.targetId === null || gameAccountId(row.targetId));
  if (!('challengeId' in row) || !gameAccountId(row.challengeId)) return false;
  if (row.action === 'move') return keys === 'action,challengeId,id,move,revision' && Number.isSafeInteger(row.revision)
    && row.revision >= 0 && !!row.move && typeof row.move === 'object' && !Array.isArray(row.move);
  return keys === 'action,challengeId,id' && ['accept', 'cancel', 'ready', 'resign'].includes(row.action);
}
