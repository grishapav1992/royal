import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeSandboxConfig } from '../deployment/write-nowpayments-sandbox-config.mjs';

const api = 'fixture-sandbox-api-1234567890';
const ipn = 'fixture-sandbox-ipn-1234567890';
const writer = resolve('deployment/write-nowpayments-sandbox-config.mjs');
const configName = '.env.nowpayments-sandbox';
const runWriter = (root, input) => spawnSync(process.execPath, [writer, root], { input, encoding: 'utf8' });
const outputOf = result => (result.stdout || '') + (result.stderr || '');
const noSecrets = result => {
  assert(!outputOf(result).includes(api));
  assert(!outputOf(result).includes(ipn));
};

test('pasted surrounding whitespace is removed, private permissions and disabled state are preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'royal-sandbox-input-'));
  try {
    const result = runWriter(root, '\u00a0 ' + api + ' \u00a0\r\n\t' + ipn + '\t\r\n');
    assert.equal(result.status, 0, outputOf(result));
    noSecrets(result);
    const path = join(root, configName), before = await readFile(path, 'utf8');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert(before.includes('NOWPAYMENTS_SANDBOX_ENABLED=false\n'));
    assert(before.includes('NOWPAYMENTS_SANDBOX_API_KEY=' + api + '\n'));
    assert(before.includes('NOWPAYMENTS_SANDBOX_IPN_SECRET=' + ipn + '\n'));
    await assert.rejects(writeSandboxConfig(root, 'replacement-sandbox-api\nreplacement-sandbox-ipn\n'), { code: 'EEXIST' });
    assert.equal(await readFile(path, 'utf8'), before);
  } finally { await rm(root, { recursive: true }); }
});

test('each missing or damaged key is identified without logging the key or writing a partial file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'royal-sandbox-input-'));
  try {
    for (const [input, label] of [
      [' \u00a0\n' + ipn + '\n', 'API Key пуст'],
      ['short\n' + ipn + '\n', 'API Key слишком короткий'],
      [api + '\n \u00a0\n', 'IPN Secret пуст'],
      [api + '\nshort\n', 'IPN Secret слишком короткий'],
      [api + '\n' + ipn + ' internal space\n', 'IPN Secret содержит посторонние символы'],
      [api + '\n' + ipn + ';INVALID=true\n', 'IPN Secret содержит посторонние символы'],
      [api + '\n' + ipn + '\nEXTRA=value\n', 'Ожидались два тестовых ключа'],
    ]) {
      const result = runWriter(root, input);
      assert.equal(result.status, 1);
      assert(outputOf(result).includes(label));
      noSecrets(result);
      assert(!existsSync(join(root, configName)));
    }
  } finally { await rm(root, { recursive: true }); }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'royal-sandbox-input-'));
  const git = existsSync('/Library/Developer/CommandLineTools/usr/bin/git') ? '/Library/Developer/CommandLineTools/usr/bin/git' : 'git';
  execFileSync(git, ['init', '--quiet', root]);
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'deployment'));
  await copyFile(resolve('scripts/connect-nowpayments-sandbox.command'), join(root, 'scripts/connect-nowpayments-sandbox.command'));
  await copyFile(writer, join(root, 'deployment/write-nowpayments-sandbox-config.mjs'));
  const run = input => spawnSync('bash', [join(root, 'scripts/connect-nowpayments-sandbox.command')], {
    input, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: join(process.execPath, '..') + ':' + process.env.PATH },
  });
  return { root, run };
}

test('interactive helper retries only the invalid field and never echoes pasted secrets', async () => {
  const f = await fixture();
  try {
    const result = f.run('\n\u00a0' + api + '\u00a0\nshort\n' + ipn + '\n');
    assert.equal(result.status, 0, outputOf(result));
    assert(outputOf(result).includes('API Key пуст'));
    assert(outputOf(result).includes('IPN Secret слишком короткий'));
    noSecrets(result);
    const content = await readFile(join(f.root, configName), 'utf8');
    assert(content.includes('NOWPAYMENTS_SANDBOX_API_KEY=' + api + '\n'));
    assert(content.includes('NOWPAYMENTS_SANDBOX_IPN_SECRET=' + ipn + '\n'));
  } finally { await rm(f.root, { recursive: true }); }
});

test('cancelled input leaves no partial credentials file', async () => {
  const f = await fixture();
  try {
    const result = f.run(api + '\n');
    assert.equal(result.status, 1);
    assert(outputOf(result).includes('Ввод отменён'));
    noSecrets(result);
    assert(!existsSync(join(f.root, configName)));
  } finally { await rm(f.root, { recursive: true }); }
});
