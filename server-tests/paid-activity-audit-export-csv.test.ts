import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { AuditCsvExportError, writeAuditCsv, type AuditCsvColumn } from '../server/audit/export-csv';
import { writeAuditJson } from '../server/audit/export-json';

type Row = { text: string | null; units: string | null };
const columns: readonly AuditCsvColumn<Row>[] = [
  { header: 'text', kind: 'text', value: row => row.text },
  { header: 'units', kind: 'units', value: row => row.units },
];

async function* stream(rows: Row[]): AsyncIterable<Row> {
  yield* rows;
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-csv-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, 'report.csv');
  const unrelated = '.royal-audit-unrelated.part';
  await writeFile(join(directory, unrelated), 'unrelated');
  const options = { destination, columns, maxRows: 100, maxBytes: 4096, timeoutMs: 5000 };
  const assertOnlyUnrelated = async () => {
    assert.deepEqual(await readdir(directory), [unrelated]);
    assert.equal(await readFile(join(directory, unrelated), 'utf8'), 'unrelated');
  };
  return { directory, destination, unrelated, options, assertOnlyUnrelated };
}

const withCode = (code: string) => (error: unknown) => error instanceof AuditCsvExportError && error.code === code;

test('writes one UTF-8 line per row with strict quoting, safe text, and exact signed units', async t => {
  const f = await fixture(t);
  const rows = [
    { text: 'а,"б"\r\nв\\end', units: '900719925474099312345' },
    { text: '=SUM(1,2)', units: '-' + '8'.repeat(78) },
    { text: ' \t+2', units: '0' },
    { text: '\ufeff@SUM(1)', units: null },
    { text: '＝1', units: null },
    { text: '', units: null },
    { text: null, units: null },
  ];
  const expected = [
    '"text","units"',
    '"а,""б""\\r\\nв\\\\end",900719925474099312345',
    '"\'=SUM(1,2)",-' + '8'.repeat(78),
    '"\' \\t+2",0',
    '"\'\ufeff@SUM(1)",',
    '"\'＝1",',
    '"",',
    ',',
  ].join('\n') + '\n';
  const bytes = Buffer.byteLength(expected);
  assert.deepEqual(await writeAuditCsv({ ...f.options, rows: stream(rows), maxRows: rows.length, maxBytes: bytes }),
    { rowCount: rows.length, bytes });
  assert.deepEqual(await readFile(f.destination), Buffer.from(expected));
  assert.equal((await stat(f.destination)).mode & 0o077, 0);
  assert.deepEqual((await readdir(f.directory)).sort(), [f.unrelated, 'report.csv']);
});

test('invalid unit cells and a failed row source never publish a file', async t => {
  const f = await fixture(t);
  for (const units of ['-0', '1e20', '1.5', '1\n', '8'.repeat(79)]) {
    await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([{ text: 'ok', units }]) }), withCode('invalid-cell'));
    await f.assertOnlyUnrelated();
  }
  const sourceError = new Error('row source failed');
  async function* brokenRows() {
    yield { text: 'written to the part', units: '1' };
    throw sourceError;
  }
  await assert.rejects(writeAuditCsv({ ...f.options, rows: brokenRows() }), error => error === sourceError);
  await f.assertOnlyUnrelated();
});

test('row and byte limits include all data records and byte counting includes the header', async t => {
  const f = await fixture(t);
  const row = { text: 'ёж', units: '1' };
  await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([row, row]), maxRows: 1 }), withCode('row-limit'));
  await f.assertOnlyUnrelated();
  const header = '"text","units"\n';
  await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([]), maxBytes: header.length - 1 }), withCode('byte-limit'));
  await f.assertOnlyUnrelated();
  const content = header + '"ёж",1\n';
  await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([row]), maxBytes: content.length }), withCode('byte-limit'));
  await f.assertOnlyUnrelated();
  assert.deepEqual(await writeAuditCsv({ ...f.options, rows: stream([]), maxRows: 0, maxBytes: header.length }),
    { rowCount: 0, bytes: header.length });
});

test('cancellation closes the owned part promptly when a row is pending', { timeout: 4000 }, async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  let start!: () => void;
  const reading = new Promise<void>(resolve => { start = resolve; });
  let returned = false;
  const rows: AsyncIterable<Row> = {
    [Symbol.asyncIterator]: () => ({
      next() {
        start();
        return new Promise(() => {});
      },
      return() {
        returned = true;
        return new Promise(() => {});
      },
    }),
  };
  const writing = writeAuditCsv({ ...f.options, rows, signal: controller.signal });
  const rejected = assert.rejects(writing, withCode('cancelled'));
  await reading;
  assert.equal((await readdir(f.directory)).length, 2);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
  controller.abort();
  await rejected;
  assert.equal(returned, true);
  await f.assertOnlyUnrelated();
  await assert.rejects(writeAuditCsv({ ...f.options, rows, signal: controller.signal }), withCode('cancelled'));
  await f.assertOnlyUnrelated();
});

test('deadline leaves no final or owned part when next is blocked', async t => {
  const f = await fixture(t);
  const rows: AsyncIterable<Row> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  await assert.rejects(writeAuditCsv({ ...f.options, rows, timeoutMs: 50 }), withCode('timeout'));
  await f.assertOnlyUnrelated();
});

test('an existing path or a racing writer owns the destination', async t => {
  const f = await fixture(t);
  const target = join(f.directory, f.unrelated);
  async function* racingRows() {
    yield { text: 'partially written', units: '1' };
    const part = (await readdir(f.directory)).find(name => name !== f.unrelated)!;
    assert.equal(await readFile(join(f.directory, part), 'utf8'), '"text","units"\n"partially written",1\n');
    await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
    await symlink(target, f.destination);
  }
  await assert.rejects(writeAuditCsv({ ...f.options, rows: racingRows() }), withCode('destination-exists'));
  assert.equal(await readFile(f.destination, 'utf8'), 'unrelated');
  assert.deepEqual((await readdir(f.directory)).sort(), [f.unrelated, 'report.csv']);
  async function* forbiddenRead(): AsyncIterable<Row> {
    assert.fail('An existing destination must be rejected before pulling rows');
  }
  await assert.rejects(writeAuditCsv({ ...f.options, rows: forbiddenRead() }), withCode('destination-exists'));
  assert.equal(await readFile(target, 'utf8'), 'unrelated');
});

test('authorization wraps publication of a complete private CSV and denial removes its part', async t => {
  const f = await fixture(t);
  const expected = '"text","units"\n"settled",7\n';
  const error = new Error('Publication denied');
  let attempts = 0;
  await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([{ text: 'settled', units: '7' }]),
    async publish() {
      attempts++;
      const part = (await readdir(f.directory)).find(name => name !== f.unrelated);
      assert(part);
      const path = join(f.directory, part);
      assert.equal(await readFile(path, 'utf8'), expected);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      await assert.rejects(stat(f.destination), { code: 'ENOENT' });
      throw error;
    },
  }), caught => caught === error);
  assert.equal(attempts, 1);
  await f.assertOnlyUnrelated();
  await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([]), publish: async () => {} }),
    /skipped its commit callback/);
  await f.assertOnlyUnrelated();
});

test('cancellation and a racing output still win before the publication callback links', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([]), signal: controller.signal,
    async publish(linkOutput) {
      controller.abort();
      await linkOutput();
    },
  }), withCode('cancelled'));
  await f.assertOnlyUnrelated();

  await assert.rejects(writeAuditCsv({ ...f.options, rows: stream([]),
    async publish(linkOutput) {
      await writeFile(f.destination, 'racing owner', { flag: 'wx' });
      await linkOutput();
    },
  }), withCode('destination-exists'));
  assert.equal(await readFile(f.destination, 'utf8'), 'racing owner');
  assert.deepEqual((await readdir(f.directory)).sort(), [f.unrelated, 'report.csv']);
});

test('JSON uses the same publication wrapper and a post-link error preserves the final file', async t => {
  const f = await fixture(t);
  const destination = join(f.directory, 'report.json');
  const input = { destination, value: { ok: true }, maxBytes: 128, signal: new AbortController().signal };
  const denied = new Error('Publication denied');
  await assert.rejects(writeAuditJson({ ...input, publish: async () => { throw denied; } }), error => error === denied);
  await f.assertOnlyUnrelated();

  const afterLink = new Error('Post-publication failure');
  await assert.rejects(writeAuditJson({ ...input, async publish(linkOutput) {
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    await linkOutput();
    assert.equal(await readFile(destination, 'utf8'), '{"ok":true}\n');
    throw afterLink;
  } }), error => error === afterLink);
  assert.equal(await readFile(destination, 'utf8'), '{"ok":true}\n');
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(f.directory)).sort(), [f.unrelated, 'report.json']);
});
