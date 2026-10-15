import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { FINANCE_SCHEMA_VERSION } from './schema';
import { roleViolations } from './role-safety';

export const DEPOSIT_NETWORK = 'tron-sim-v1' as const;
export const DEPOSIT_TOKEN = 'simulation:usdt-test-v1' as const;
export const DEPOSIT_GENESIS = '0'.repeat(64);
export type DepositEvent = {
  txId: string; logIndex: number; contract: string; from: string; to: string;
  amountUnits: string; scale: number; success: boolean; symbol: string;
};
export type DepositBlock = { network: typeof DEPOSIT_NETWORK; height: number; hash: string; parentHash: string; events: DepositEvent[] };
export type DepositSource = {
  sourceId: string;
  finalizedTip(): Promise<{ network: string; height: number; hash: string }>;
  block(height: number): Promise<unknown>;
};
export class DepositScanError extends Error {
  constructor(readonly code: string) { super(code); }
}
const invalid = () => { throw new DepositScanError('invalid_simulation_source'); };
const object = (value: unknown, fields: string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== fields.length || fields.some(key => !Object.hasOwn(result, key))) return invalid();
  return result;
};
const height = (value: unknown, allowZero = false): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 999999999999999) return invalid();
  return value;
};
function normalizeEvent(value: unknown): DepositEvent {
  const event = object(value, ['txId', 'logIndex', 'contract', 'from', 'to', 'amountUnits', 'scale', 'success', 'symbol']);
  if (typeof event.txId !== 'string' || !/^[a-f0-9]{64}$/.test(event.txId)
    || typeof event.logIndex !== 'number' || !Number.isInteger(event.logIndex) || event.logIndex < 0 || event.logIndex > 99999999
    || typeof event.scale !== 'number' || !Number.isInteger(event.scale) || event.scale < 0 || event.scale > 99
    || typeof event.success !== 'boolean' || typeof event.amountUnits !== 'string' || event.amountUnits.length > 100
    || typeof event.symbol !== 'string' || event.symbol.length > 32
    || ['contract', 'from', 'to'].some(key => typeof event[key] !== 'string' || !/^simulation:[a-zA-Z0-9:_-]{1,120}$/.test(event[key] as string))) return invalid();
  return { txId: event.txId, logIndex: event.logIndex, contract: event.contract as string, from: event.from as string,
    to: event.to as string, amountUnits: event.amountUnits, scale: event.scale, success: event.success, symbol: event.symbol };
}
export function simulationBlock(blockHeight: number, parentHash: string, rawEvents: unknown[]): DepositBlock {
  height(blockHeight);
  if (!/^[a-f0-9]{64}$/.test(parentHash) || !Array.isArray(rawEvents) || rawEvents.length > 100) return invalid();
  const unique = new Map<string, DepositEvent>();
  for (const raw of rawEvents) {
    const event = normalizeEvent(raw), key = `${event.txId}:${event.logIndex}`, previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new DepositScanError('conflicting_event_identity');
    unique.set(key, event);
  }
  const events = [...unique.values()].sort((a, b) => a.txId < b.txId ? -1 : a.txId > b.txId ? 1 : a.logIndex - b.logIndex);
  const data = { network: DEPOSIT_NETWORK, height: blockHeight, parentHash, events };
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return { network: DEPOSIT_NETWORK, height: blockHeight, hash, parentHash, events };
}
function normalizeBlock(value: unknown): DepositBlock {
  const input = object(value, ['network', 'height', 'hash', 'parentHash', 'events']);
  if (input.network !== DEPOSIT_NETWORK || typeof input.parentHash !== 'string' || !Array.isArray(input.events)) return invalid();
  const normalized = simulationBlock(height(input.height), input.parentHash, input.events);
  if (input.hash !== normalized.hash) return invalid();
  return normalized;
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DepositScanError('source_timeout')), 10000);
  })]); } finally { clearTimeout(timer); }
}
async function agreedBlock(sources: readonly DepositSource[], requestedHeight: number) {
  const blocks = await bounded(Promise.all(sources.map(async source => normalizeBlock(await source.block(requestedHeight)))));
  if (blocks.some(block => block.height !== requestedHeight)) return invalid();
  if (JSON.stringify(blocks[0]) !== JSON.stringify(blocks[1])) throw new DepositScanError('source_disagreement');
  return blocks[0];
}
export async function checkDepositObserverRole(pool: Pool) {
  const meta = await pool.query('SELECT * FROM royal_finance.meta');
  if (await roleViolations(pool, 'observer') !== 0
    || meta.rows.length !== 1 || meta.rows[0].version !== FINANCE_SCHEMA_VERSION || meta.rows[0].environment !== 'simulation'
    || meta.rows[0].asset !== 'USDT_SIM') throw new DepositScanError('restricted_simulation_observer_required');
}
type BlockResult = { height: number; hash: string; credited: number; ignored: number; replayed: boolean; halted?: boolean };
async function commitBlock(client: PoolClient, block: DepositBlock, sources: readonly DepositSource[]): Promise<BlockResult> {
  const { rows } = await client.query('SELECT royal_finance.ingest_deposit_block($1::jsonb,$2::jsonb) AS result',
    [JSON.stringify(block), JSON.stringify(sources.map(source => source.sourceId).sort())]);
  if (rows[0].result.halted) throw new DepositScanError('finalized_block_changed');
  return rows[0].result;
}
export async function scanSimulatedDeposits(pool: Pool, sources: readonly DepositSource[], options: {
  maxBlocks?: number; overlap?: number; afterCommit?: (result: BlockResult) => Promise<void>;
} = {}) {
  if (sources.length !== 2 || sources.some(source => !/^[a-zA-Z0-9_-]{1,100}$/.test(source.sourceId))
    || sources[0].sourceId === sources[1].sourceId) throw new DepositScanError('two_distinct_sources_required');
  const maxBlocks = options.maxBlocks ?? 100, overlap = options.overlap ?? 3;
  if (!Number.isInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 100 || !Number.isInteger(overlap) || overlap < 1 || overlap > 20) return invalid();
  await checkDepositObserverRole(pool);
  const client = await pool.connect();
  let locked = false, connectionFailed = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended('royal-finance-deposit-tron-sim-v1',0)) AS locked")).rows[0].locked;
    if (!locked) return { network: DEPOSIT_NETWORK, busy: true, blocks: 0, credited: 0, ignored: 0 };
    const stream = (await client.query("SELECT * FROM royal_finance.deposit_streams WHERE network='tron-sim-v1'")).rows[0];
    if (!stream || stream.halted_reason) throw new DepositScanError('deposit_stream_halted');
    const cursor = height(Number(stream.cursor_height), true);
    const tips = await bounded(Promise.all(sources.map(source => source.finalizedTip())));
    for (const tip of tips) {
      if (tip.network !== DEPOSIT_NETWORK || !/^[a-f0-9]{64}$/.test(tip.hash)) return invalid();
      height(tip.height, true);
      if (tip.height === 0 && tip.hash !== DEPOSIT_GENESIS) return invalid();
    }
    const finalHeight = Math.min(...tips.map(tip => tip.height));
    if (finalHeight < cursor) throw new DepositScanError('source_behind_cursor');
    // Validate the saved finality boundary before scanning any newer block.
    for (let n = Math.max(1, cursor - overlap + 1); n <= cursor; n++) {
      const result = await commitBlock(client, await agreedBlock(sources, n), sources);
      if (!result.replayed) throw new DepositScanError('invalid_replay_boundary');
    }
    if (finalHeight > 0) {
      const finalBlock = await agreedBlock(sources, finalHeight);
      if (tips.some(tip => tip.height === finalHeight && tip.hash !== finalBlock.hash)) return invalid();
    }
    let blocks = 0, credited = 0, ignored = 0, lastHeight = cursor;
    for (let n = cursor + 1; n <= Math.min(finalHeight, cursor + maxBlocks); n++) {
      const result = await commitBlock(client, await agreedBlock(sources, n), sources);
      blocks++; credited += result.credited; ignored += result.ignored; lastHeight = n;
      await options.afterCommit?.(result);
    }
    return { network: DEPOSIT_NETWORK, busy: false, blocks, credited, ignored, cursorHeight: lastHeight, finalizedHeight: finalHeight };
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(hashtextextended('royal-finance-deposit-tron-sim-v1',0))"); }
      catch { connectionFailed = true; }
    }
    client.release(connectionFailed);
  }
}

export type SimulationManifest = { sourceId: string; network: typeof DEPOSIT_NETWORK; finalizedHeight: number; blocks: DepositBlock[] };
export function simulationSource(value: unknown): DepositSource {
  const input = object(value, ['sourceId', 'network', 'finalizedHeight', 'blocks']);
  if (typeof input.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.sourceId)
    || input.network !== DEPOSIT_NETWORK || !Array.isArray(input.blocks) || input.blocks.length > 10000) return invalid();
  const blocks = new Map<number, DepositBlock>();
  for (const raw of input.blocks) {
    const block = normalizeBlock(raw);
    if (blocks.has(block.height)) return invalid();
    blocks.set(block.height, block);
  }
  const finalizedHeight = height(input.finalizedHeight, true), finalBlock = blocks.get(finalizedHeight);
  if (finalizedHeight > 0 && !finalBlock) return invalid();
  return { sourceId: input.sourceId,
    async finalizedTip() { return { network: DEPOSIT_NETWORK, height: finalizedHeight, hash: finalBlock?.hash ?? DEPOSIT_GENESIS }; },
    async block(requestedHeight) {
      const block = blocks.get(requestedHeight);
      if (!block) throw new DepositScanError('source_block_missing');
      return block;
    } };
}
