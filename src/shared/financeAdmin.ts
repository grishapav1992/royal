export type FinanceSource = 'payments' | 'nile' | 'mainnet';
export type FinanceKind = 'deposit' | 'withdrawal' | 'game' | 'adjustment' | 'capital';
export type FinanceStatus = 'finished' | 'pending' | 'review' | 'failed';
export type FinanceFilters = {
  from?: number; to?: number; playerIds?: string[]; game?: string; mode?: 'house' | 'pvp'; kind?: FinanceKind;
  status?: FinanceStatus; minUnits?: string; maxUnits?: string; page: number; size: number;
};
export type FinanceOperation = {
  id: string; playerId: string; opponentId: string; kind: FinanceKind; mode: string; game: string; roundId: string;
  status: FinanceStatus; providerStatus: string; amountUnits: string; deltaUnits: string; stakeUnits: string;
  payoutUnits: string; txId: string; currency: string; address: string; createdAt: number | null;
  actorId: string; reason: string; playerName?: string; playerEmail?: string; blocked?: boolean;
};
export type FinanceTotals = { count: number; deposits: string; withdrawals: string; stakes: string; payouts: string;
  ggr: string; adjustments: string; pending: number; undated: number };
export type FinanceGroup = { id: string; count: number; deposits: string; withdrawals: string; stakes: string;
  payouts: string; ggr: string; adjustments: string; name?: string; email?: string; blocked?: boolean };
export type FinanceBalances = { players: string; reserved: string; treasury: string | null; house: string | null;
  checkedAt: number | null; note?: string };
export type FinanceReport = {
  source: FinanceSource; environment: 'real' | 'test'; enabled: boolean; generatedAt: number;
  balances: FinanceBalances; totals: FinanceTotals; rows: FinanceOperation[]; players: FinanceGroup[];
  games: FinanceGroup[]; playerCount: number; gameCount: number; page: number; size: number;
  wallets: Record<string,{available:string;reserved:string}>; days: {date:string;deposits:string;withdrawals:string;ggr:string}[];
};
export type FinanceAdjustment = { id: string; actorId: string; playerId: string; deltaUnits: string; reason: string; createdAt: number };
export const FINANCE_SOURCES: Record<FinanceSource, string> = {
  payments: 'Реальные · NOWPayments', nile: 'Тестовые · USDT Nile', mainnet: 'Реальные · прямой USDT',
};
export const FINANCE_KINDS: Record<FinanceKind, string> = {
  deposit: 'Пополнение', withdrawal: 'Вывод', game: 'Игра', adjustment: 'Корректировка', capital: 'Резерв казино',
};
export const FINANCE_STATUSES: Record<FinanceStatus, string> = {
  finished: 'Завершено', pending: 'В обработке', review: 'Требует проверки', failed: 'Отменено / ошибка',
};
