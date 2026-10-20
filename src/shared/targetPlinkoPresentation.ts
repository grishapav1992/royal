import { DEMO_BETS } from './demoWallet';
import { plinkoTargetMatches, plinkoTargetMultiplier, plinkoTargetWinningCount, type PlinkoTarget } from './casinoBatchVariants';
import { studioPlinkoTable } from './studioGames';

export type TargetPlinkoPresentationGame = 'variant-target-plinko' | 'studio-obsidian-drop';
export type TargetPlinkoDirection = 0 | 1;
export type ObsidianPlinkoRisk = 'low' | 'medium' | 'high';
type CommonPresentation = Readonly<{
  outcomeId: string;
  rows: 12;
  path: readonly TargetPlinkoDirection[];
  bucket: number;
  multiplier: number;
  stakeUnits: string;
  returnedUnits: string;
}>;
export type TargetZonePresentation = CommonPresentation & Readonly<{
  gameId: 'variant-target-plinko';
  target: PlinkoTarget;
  won: boolean;
  winningBuckets: readonly number[];
  winningPathCount: number;
  totalPaths: 4096;
}>;
export type ObsidianPlinkoPresentation = CommonPresentation & Readonly<{
  gameId: 'studio-obsidian-drop';
  risk: ObsidianPlinkoRisk;
  table: readonly number[];
}>;
export type TargetPlinkoPresentation = TargetZonePresentation | ObsidianPlinkoPresentation;

const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key =>
    typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
};
const fields = (value: Record<string, unknown>, expected: string) => Reflect.ownKeys(value).sort().join(',') === expected.split(',').sort().join(',');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const units = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(value);
const dense = (value: unknown, length: number): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length === length
  && Reflect.ownKeys(value).length === length + 1 && Array.from({ length }, (_, index) =>
    Object.hasOwn(value, index) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index))!, 'value')).every(Boolean);
const target = (value: unknown): value is PlinkoTarget => value === 'center' || value === 'corridor' || value === 'edges';
const risk = (value: unknown): value is ObsidianPlinkoRisk => value === 'low' || value === 'medium' || value === 'high';
const fixed = (value: number): bigint => {
  const scaled = Math.round(value * 10000);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(scaled) || Math.abs(value * 10000 - scaled) > 0.000001) throw Error('Invalid fixed multiplier');
  return BigInt(scaled);
};
const paid = (stake: string, multiplier: number) => (BigInt(stake) * fixed(multiplier) / 10000n).toString();

function canonical(session: unknown, game: TargetPlinkoPresentationGame, key: 'variant' | 'studio') {
  if (!record(session) || !fields(session, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view') || !uuid(session.id)
    || session.gameId !== game || session.rulesVersion !== 1 || session.state !== 'settled' || !units(session.stakeUnits)
    || !DEMO_BETS.some(bet => String(bet * 100) === session.stakeUnits) || session.spentUnits !== session.stakeUnits || !units(session.returnedUnits)
    || !record(session.view)) return null;
  const view = session.view;
  if (!fields(view, `player,dealer,community,actions,phase,ended,message,${key}`) || view.phase !== 1 || view.ended !== true || typeof view.message !== 'string'
    || ![view.player, view.dealer, view.community, view.actions].every(value => dense(value, 0)) || !record(view[key])) return null;
  return { session, value: view[key] };
}
function currentPath(value: Record<string, unknown>): readonly TargetPlinkoDirection[] | null {
  if (!dense(value.path, 12) || !value.path.every(bit => bit === 0 || bit === 1) || typeof value.bucket !== 'number'
    || !Number.isSafeInteger(value.bucket) || value.bucket !== (value.path as TargetPlinkoDirection[]).reduce<number>((sum, bit) => sum + bit, 0)) return null;
  return Object.freeze([...value.path]) as readonly TargetPlinkoDirection[];
}
function binding(request: unknown, session: Record<string, unknown>, key: 'variant' | 'studio', choice: 'target' | 'risk', mode: string): boolean {
  if (!record(request) || !fields(request, 'id,action,gameId,stakeUnits,settings') || request.action !== 'start' || request.id !== session.id
    || request.gameId !== session.gameId || request.stakeUnits !== session.stakeUnits || !record(request.settings) || !fields(request.settings, key)
    || !record(request.settings[key]) || !fields(request.settings[key], choice)) return false;
  return request.settings[key][choice] === mode;
}

/** A captured start is required for live binding; omission is for a confirmed static receipt only. */
export function targetPlinkoPresentation(session: unknown, capturedStart?: unknown): TargetZonePresentation | null {
  try {
    const checked = canonical(session, 'variant-target-plinko', 'variant');
    if (!checked) return null;
    const { session: saved, value } = checked;
    if (!fields(value, 'kind,target,path,bucket,won,multiplier') || value.kind !== 'target-plinko' || !target(value.target) || typeof value.won !== 'boolean') return null;
    const path = currentPath(value), multiplier = plinkoTargetMultiplier(value.target);
    if (!path || value.multiplier !== multiplier || value.won !== plinkoTargetMatches(value.target, Number(value.bucket))
      || saved.returnedUnits !== (value.won ? paid(saved.stakeUnits as string, multiplier) : '0')
      || capturedStart !== undefined && !binding(capturedStart, saved, 'variant', 'target', value.target)) return null;
    return Object.freeze({ gameId: 'variant-target-plinko', outcomeId: saved.id as string, rows: 12, path, bucket: value.bucket as number, multiplier,
      stakeUnits: saved.stakeUnits as string, returnedUnits: saved.returnedUnits as string, target: value.target, won: value.won,
      winningBuckets: Object.freeze(Array.from({ length: 13 }, (_, bucket) => bucket).filter(bucket => plinkoTargetMatches(value.target as PlinkoTarget, bucket))),
      winningPathCount: Number(plinkoTargetWinningCount(value.target)), totalPaths: 4096 });
  } catch { return null; }
}

/** The table, path and award are exclusively the current settled Obsidian result. */
export function obsidianPlinkoPresentation(session: unknown, capturedStart?: unknown): ObsidianPlinkoPresentation | null {
  try {
    const checked = canonical(session, 'studio-obsidian-drop', 'studio');
    if (!checked) return null;
    const { session: saved, value } = checked;
    if (!fields(value, 'kind,risk,path,bucket,table,multiplier') || value.kind !== 'plinko' || !risk(value.risk) || !dense(value.table, 13)) return null;
    const path = currentPath(value), table = studioPlinkoTable(value.risk);
    if (!path || !value.table.every((multiplier, bucket) => multiplier === table[bucket]) || value.multiplier !== table[value.bucket as number]
      || saved.returnedUnits !== paid(saved.stakeUnits as string, table[value.bucket as number])
      || capturedStart !== undefined && !binding(capturedStart, saved, 'studio', 'risk', value.risk)) return null;
    table.forEach(fixed);
    return Object.freeze({ gameId: 'studio-obsidian-drop', outcomeId: saved.id as string, rows: 12, path, bucket: value.bucket as number,
      multiplier: table[value.bucket as number], stakeUnits: saved.stakeUnits as string, returnedUnits: saved.returnedUnits as string, risk: value.risk, table: Object.freeze([...table]) });
  } catch { return null; }
}
