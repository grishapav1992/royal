import { gameAccountId } from '../../src/shared/nileWallet';
import type { FinanceAdjustment, FinanceFilters } from '../../src/shared/financeAdmin';
import { CryptoError } from '../crypto/config';

export function adminIds(env: NodeJS.ProcessEnv = process.env) {
  const ids = (env.FINANCE_ADMIN_ACCOUNT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.some(id => !gameAccountId(id))) throw new Error('Invalid FINANCE_ADMIN_ACCOUNT_IDS');
  return new Set(ids);
}
export function requireFinanceAdmin(actor: unknown, ids = adminIds()): asserts actor is string {
  if (typeof actor !== 'string' || !ids.has(actor)) throw new CryptoError(403, 'Доступ к финансовому кабинету закрыт.');
}
export function financeFilters(value: unknown): FinanceFilters {
  const v = value as Record<string, any>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['from','to','playerIds','game','mode','kind','status','minUnits','maxUnits','page','size'].includes(k)))
    throw new CryptoError(400, 'Некорректные фильтры.');
  const f: FinanceFilters = { page: v.page ?? 1, size: v.size ?? 25 };
  if (!Number.isSafeInteger(f.page) || f.page < 1 || f.page > 100000 || ![25,50,100].includes(f.size)) throw new CryptoError(400, 'Некорректная страница.');
  for (const k of ['from','to'] as const) if (v[k] !== undefined) {
    if (!Number.isSafeInteger(v[k]) || v[k] < 0 || v[k] > 8640000000000000) throw new CryptoError(400, 'Некорректная дата.'); f[k] = v[k];
  }
  if (f.from !== undefined && f.to !== undefined && f.from >= f.to) throw new CryptoError(400, 'Начало периода должно быть раньше конца.');
  if (v.playerIds !== undefined) {
    if (!Array.isArray(v.playerIds) || v.playerIds.length > 100 || !v.playerIds.every(gameAccountId)) throw new CryptoError(400, 'Некорректный игрок.');
    f.playerIds = [...new Set(v.playerIds)] as string[];
  }
  if (v.game !== undefined) {
    if (typeof v.game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(v.game)) throw new CryptoError(400, 'Некорректная игра.'); f.game = v.game;
  }
  for (const [k, values] of Object.entries({ mode:['house','pvp'], kind:['deposit','withdrawal','game','adjustment','capital'], status:['finished','pending','review','failed'] })) {
    if (v[k] !== undefined) { if (!values.includes(v[k])) throw new CryptoError(400, 'Некорректный фильтр.'); (f as any)[k] = v[k]; }
  }
  for (const k of ['minUnits','maxUnits'] as const) if (v[k] !== undefined) {
    if (typeof v[k] !== 'string' || !/^(0|[1-9]\d{0,29})$/.test(v[k])) throw new CryptoError(400, 'Некорректная сумма.'); f[k] = v[k];
  }
  if (f.minUnits && f.maxUnits && BigInt(f.minUnits) > BigInt(f.maxUnits)) throw new CryptoError(400, 'Минимальная сумма больше максимальной.');
  return f;
}
export function adjustmentRequest(value: unknown): Omit<FinanceAdjustment, 'createdAt'> {
  const v = value as FinanceAdjustment;
  if (!v || Object.keys(v).sort().join(',') !== 'actorId,deltaUnits,id,playerId,reason'
    || ![v.id,v.actorId,v.playerId].every(gameAccountId) || typeof v.deltaUnits !== 'string' || !/^-?[1-9]\d{0,12}$/.test(v.deltaUnits)
    || BigInt(v.deltaUnits) < -1000000000000n || BigInt(v.deltaUnits) > 1000000000000n
    || typeof v.reason !== 'string' || v.reason.trim().length < 5 || v.reason.length > 500 || /[\x00-\x1f\x7f]/.test(v.reason))
    throw new CryptoError(400, 'Укажи игрока, сумму и причину от 5 до 500 символов.');
  return { id:v.id,actorId:v.actorId,playerId:v.playerId,deltaUnits:v.deltaUnits,reason:v.reason.trim() };
}
export function sameAdjustment(previous: FinanceAdjustment, request: Omit<FinanceAdjustment, 'createdAt'>) {
  if (['id','actorId','playerId','deltaUnits','reason'].some(k => (previous as any)[k] !== (request as any)[k]))
    throw new CryptoError(409, 'Этот номер действия уже использован с другими параметрами.');
}
