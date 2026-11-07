import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type AuditCsvColumn<Row> = {
  header: string;
  kind: 'text' | 'units';
  value: (row: Row) => string | null;
};

type AuditCsvOptions<Row> = {
  destination: string;
  columns: readonly AuditCsvColumn<Row>[];
  rows: AsyncIterable<Row>;
  maxRows: number;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

type ErrorCode = 'invalid-options' | 'invalid-cell' | 'row-limit' | 'byte-limit' |
  'timeout' | 'cancelled' | 'destination-exists';

export class AuditCsvExportError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'AuditCsvExportError';
  }
}

const nonnegativeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
const escapes: Record<string, string> = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function textCell(value: string): string {
  const escaped = value.replace(/[\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, character =>
    escapes[character] ?? '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  const formula = /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(value);
  return '"' + (formula ? "'" : '') + escaped.replaceAll('"', '""') + '"';
}

function cell<Row>(column: AuditCsvColumn<Row>, row: Row): string {
  const value = column.value(row);
  if (value === null) return '';
  if (typeof value !== 'string') throw new AuditCsvExportError('invalid-cell');
  if (column.kind === 'text') return textCell(value);
  // The audit contract uses signed integers of up to 78 digits in the asset's smallest unit.
  if (!/^(0|-?[1-9][0-9]{0,77})$/.test(value)) throw new AuditCsvExportError('invalid-cell');
  return value;
}

function nextRow<Row>(iterator: AsyncIterator<Row>, signal: AbortSignal): Promise<IteratorResult<Row>> {
  signal.throwIfAborted();
  return new Promise((resolveNext, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    // Only one pending read and one abort listener, even for large streams.
    void Promise.resolve().then(() => {
      signal.throwIfAborted();
      return iterator.next();
    }).then(result => {
      signal.removeEventListener('abort', abort);
      resolveNext(result);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

/** Writes one UTF-8 LF record per row, then publishes the complete CSV without replacing a destination. */
export async function writeAuditCsv<Row>(options: AuditCsvOptions<Row>): Promise<{ rowCount: number; bytes: number; cleanupPending?: string }> {
  const { columns, maxRows, maxBytes, timeoutMs, signal } = options;
  if (!options.destination || !columns.length ||
    columns.some(column => !column.header || !['text', 'units'].includes(column.kind)) ||
    new Set(columns.map(column => column.header)).size !== columns.length ||
    !nonnegativeInteger(maxRows) || !nonnegativeInteger(maxBytes) ||
    !nonnegativeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new AuditCsvExportError('invalid-options');
  }
  const destination = resolve(options.destination);
  const temporary = join(dirname(destination), '.royal-audit-' + randomUUID() + '.part');
  const controller = new AbortController();
  const cancel = () => controller.abort(new AuditCsvExportError('cancelled'));
  const timeout = () => controller.abort(new AuditCsvExportError('timeout'));
  const deadline = performance.now() + timeoutMs;
  const timer = setTimeout(timeout, timeoutMs);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const checkActive = () => {
    if (performance.now() >= deadline) timeout();
    controller.signal.throwIfAborted();
  };
  let file: FileHandle | undefined;
  let ownsTemporary = false;
  let published = false;
  let iterator: AsyncIterator<Row> | undefined;
  let exhausted = false;
  let rowCount = 0, bytes = 0;
  const write = async (output: FileHandle, line: string) => {
    checkActive();
    const size = Buffer.byteLength(line, 'utf8');
    if (size > maxBytes - bytes) throw new AuditCsvExportError('byte-limit');
    await output.writeFile(line, 'utf8');
    bytes += size;
  };
  try {
    checkActive();
    await lstat(destination).then(() => { throw new AuditCsvExportError('destination-exists'); }, error => {
      if (errorCode(error) !== 'ENOENT') throw error;
    });
    checkActive();
    file = await open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    await write(file, columns.map(column => textCell(column.header)).join(',') + '\n');
    iterator = options.rows[Symbol.asyncIterator]();
    for (;;) {
      checkActive();
      const next = await nextRow(iterator, controller.signal);
      checkActive();
      if (next.done) {
        exhausted = true;
        break;
      }
      if (rowCount === maxRows) throw new AuditCsvExportError('row-limit');
      await write(file, columns.map(column => cell(column, next.value)).join(',') + '\n');
      rowCount++;
    }
    await file.sync();
    await file.close();
    file = undefined;
    checkActive();
    // Linking in the same directory is the commit point. A racing file or symlink wins.
    await link(temporary, destination).catch(error => {
      if (errorCode(error) === 'EEXIST') throw new AuditCsvExportError('destination-exists');
      throw error;
    });
    published = true;
    try { await unlink(temporary); }
    catch (error) {
      if (errorCode(error) !== 'ENOENT') return { rowCount, bytes, cleanupPending: temporary };
    }
    return { rowCount, bytes };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    // An iterator blocked in next() may queue return(). Do not defer file cleanup until it unblocks.
    if (iterator && !exhausted) void Promise.resolve().then(() => iterator?.return?.()).catch(() => {});
    try { await file?.close(); }
    finally {
      if (ownsTemporary && !published) await unlink(temporary).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error;
      });
    }
  }
}
