import { createHash } from 'node:crypto';

export const NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc';
export const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export class TronReadError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function rejectTron(code = 'invalid_chain_data'): never { throw new TronReadError(code); }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rejectTron();
  return value as Record<string, unknown>;
}
export function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return rejectTron();
  return value;
}
export function hex(value: unknown, bytes?: number): string {
  if (typeof value !== 'string' || !/^(?:[a-fA-F0-9]{2})+$/.test(value) || (bytes !== undefined && value.length !== bytes * 2)) return rejectTron();
  return value.toLowerCase();
}
export function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function varint(value: number | bigint): Buffer {
  let n = BigInt(value); const bytes = [];
  do { bytes.push(Number(n & 127n) | (n > 127n ? 128 : 0)); n >>= 7n; } while (n);
  return Buffer.from(bytes);
}
function field(tag: number, value: Buffer | number): Buffer {
  if (typeof value === 'number') return value === 0 ? Buffer.alloc(0) : Buffer.concat([varint(tag << 3), varint(value)]);
  return Buffer.concat([varint((tag << 3) | 2), varint(value.length), value]);
}
// Field numbers follow protocol.BlockHeader.raw in tronprotocol/protocol/core/Tron.proto.
export function headerBytes(raw: Record<string, unknown>): Buffer {
  const fields: [string, number, 'int' | 'bytes'][] = [
    ['timestamp', 1, 'int'], ['txTrieRoot', 2, 'bytes'], ['parentHash', 3, 'bytes'], ['number', 7, 'int'],
    ['witness_id', 8, 'int'], ['witness_address', 9, 'bytes'], ['version', 10, 'int'], ['accountStateRoot', 11, 'bytes'],
  ];
  if (Object.keys(raw).some(key => !fields.some(([name]) => key === name))) return rejectTron('unsupported_header_field');
  return Buffer.concat(fields.flatMap(([name, tag, type]) => raw[name] === undefined ? [] :
    [field(tag, type === 'int' ? integer(raw[name]) : Buffer.from(hex(raw[name]), 'hex'))]));
}
export function headerId(raw: Record<string, unknown>): string {
  const id = Buffer.from(digest(headerBytes(raw)), 'hex');
  id.writeBigUInt64BE(BigInt(integer(raw.number ?? 0)), 0);
  return id.toString('hex');
}
export type TronHeader = { height: number; hash: string; parentHash: string; timestamp: number };
export type TronTransfer = { txId: string; logIndex: number; contract: string; from: string; to: string; amountUnits: string };
export type TronBlock = TronHeader & { txIds: string[]; outcomes: { txId: string; status: string }[]; transfers: TronTransfer[] };
export function normalizeHeader(value: unknown, requestedHeight?: number): TronHeader {
  const block = record(value), raw = record(record(block.block_header).raw_data), n = integer(raw.number ?? 0);
  if (requestedHeight !== undefined && n !== requestedHeight) return rejectTron('wrong_block_height');
  const hash = hex(block.blockID, 32), parentHash = hex(raw.parentHash, 32);
  if (headerId(raw) !== hash) return rejectTron('invalid_block_hash');
  if (n > 0) {
    hex(raw.txTrieRoot, 32); hex(raw.witness_address, 21);
    if (BigInt('0x' + parentHash.slice(0, 16)) !== BigInt(n - 1)) return rejectTron('invalid_parent_height');
  }
  return { height: n, hash, parentHash, timestamp: integer(raw.timestamp ?? 0) };
}
function protobufFields(bytes: Buffer): Map<number, (Buffer | bigint)[]> {
  let offset = 0;
  const read = () => {
    let value = 0n;
    for (let n = 0; n < 10; n++) {
      if (offset >= bytes.length) return rejectTron('invalid_transaction_bytes');
      const byte = bytes[offset++]; value |= BigInt(byte & 127) << BigInt(n * 7);
      if (byte < 128) return value;
    }
    return rejectTron('invalid_transaction_bytes');
  };
  const result = new Map<number, (Buffer | bigint)[]>();
  while (offset < bytes.length) {
    const key = read(), tag = Number(key >> 3n), wire = Number(key & 7n);
    if (tag < 1 || tag > 536870911) return rejectTron();
    let value: Buffer | bigint;
    if (wire === 0) value = read();
    else if (wire === 2) {
      const length = Number(read());
      if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - offset) return rejectTron();
      value = bytes.subarray(offset, offset + length); offset += length;
    } else return rejectTron('unsupported_transaction_encoding');
    const values = result.get(tag) ?? []; values.push(value); result.set(tag, values);
  }
  return result;
}
function contractType(bytes: Buffer): number {
  const contracts = protobufFields(bytes).get(11);
  if (contracts?.length !== 1 || !Buffer.isBuffer(contracts[0])) return rejectTron('unsupported_contract_count');
  const types = protobufFields(contracts[0]).get(1);
  // AccountCreateContract is enum value zero and may be omitted by proto3.
  if (!types) return 0;
  if (types.length !== 1 || typeof types[0] !== 'bigint') return rejectTron();
  return integer(Number(types[0]));
}
function logAddress(value: unknown): string {
  const address = hex(value);
  if (address.length === 40) return '41' + address;
  if (address.length === 42 && address.startsWith('41')) return address;
  return rejectTron('invalid_log_address');
}
const contractStatuses = new Set(['SUCCESS', 'REVERT', 'BAD_JUMP_DESTINATION', 'OUT_OF_MEMORY', 'PRECOMPILED_CONTRACT',
  'STACK_TOO_SMALL', 'STACK_TOO_LARGE', 'ILLEGAL_OPERATION', 'STACK_OVERFLOW', 'OUT_OF_ENERGY', 'OUT_OF_TIME',
  'JVM_STACK_OVER_FLOW', 'UNKNOWN', 'TRANSFER_FAILED', 'INVALID_CODE']);
export function normalizeTronBlock(value: unknown, receiptsValue: unknown, requestedHeight: number): TronBlock {
  const block = record(value), header = normalizeHeader(block, requestedHeight);
  const transactions = block.transactions ?? [];
  if (!Array.isArray(transactions) || transactions.length > 10000 || !Array.isArray(receiptsValue) || receiptsValue.length !== transactions.length) {
    return rejectTron('incomplete_receipt_set');
  }
  const receipts = new Map<string, Record<string, unknown>>();
  for (const value of receiptsValue) {
    const receipt = record(value), id = hex(receipt.id, 32);
    if (integer(receipt.blockNumber) !== requestedHeight || integer(receipt.blockTimeStamp) !== header.timestamp || receipts.has(id)) {
      return rejectTron('receipt_block_mismatch');
    }
    receipts.set(id, receipt);
  }
  const txIds: string[] = [], outcomes: TronBlock['outcomes'] = [], transfers: TronTransfer[] = [];
  for (const value of transactions) {
    const tx = record(value), txId = hex(tx.txID, 32), bytes = Buffer.from(hex(tx.raw_data_hex), 'hex');
    if (digest(bytes) !== txId || txIds.includes(txId)) return rejectTron('invalid_transaction_hash');
    txIds.push(txId);
    const type = contractType(bytes), receipt = receipts.get(txId);
    if (!receipt) return rejectTron('incomplete_receipt_set');
    const resource = record(receipt.receipt), smart = type === 30 || type === 31;
    if (receipt.result !== undefined && !['SUCESS', 'FAILED'].includes(receipt.result as string)) return rejectTron('unknown_receipt_status');
    const status = smart ? resource.result : receipt.result === 'FAILED' ? 'FAILED' : 'SUCCESS';
    if (typeof status !== 'string' || (smart && !contractStatuses.has(status))) return rejectTron('unknown_receipt_status');
    if (smart && status === 'SUCCESS' && receipt.result === 'FAILED') return rejectTron('contradictory_receipt_status');
    outcomes.push({ txId, status });
    const logs = receipt.log ?? [];
    if (!Array.isArray(logs) || logs.length > 5000) return rejectTron();
    if (status !== 'SUCCESS') continue;
    for (const [logIndex, value] of logs.entries()) {
      const log = record(value);
      if (!Array.isArray(log.topics)) return rejectTron();
      if (log.topics[0]?.toLowerCase?.() !== TRANSFER_TOPIC) continue;
      // TRC-721 uses the same signature with a fourth indexed topic.
      if (log.topics.length === 4) continue;
      if (!smart || log.topics.length !== 3) return rejectTron('invalid_transfer_log');
      const from = hex(log.topics[1], 32), to = hex(log.topics[2], 32), data = hex(log.data, 32);
      if (!from.startsWith('0'.repeat(24)) || !to.startsWith('0'.repeat(24))) return rejectTron('invalid_transfer_log');
      transfers.push({ txId, logIndex, contract: logAddress(log.address), from: '41' + from.slice(24), to: '41' + to.slice(24),
        amountUnits: BigInt('0x' + data).toString() });
      if (transfers.length > 10000) return rejectTron('block_event_limit');
    }
  }
  // Receipt order from the RPC is not relevant; transaction and log order are relevant.
  return { ...header, txIds, outcomes, transfers };
}
