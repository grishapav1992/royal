import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function normalizeSandboxSecret(value, kind) {
  const label = { api: 'API Key', ipn: 'IPN Secret' }[kind];
  if (!label) throw new Error('Неизвестный тип тестового ключа.');
  const normalized = value.trim();
  if (!normalized) throw new Error(label + ' пуст. Скопируй значение из Sandbox, вставь его и нажми Enter.');
  if (normalized.length < 16) throw new Error(label + ' слишком короткий. Скопируй полное значение ключа.');
  if (!/^[A-Za-z0-9._~+\/=\-]{16,512}$/.test(normalized)) {
    throw new Error(label + ' содержит посторонние символы. Скопируй только значение ключа, без подписи и кавычек.');
  }
  return normalized;
}

export async function writeSandboxConfig(root, input) {
  const values = input.split(/\r?\n/);
  if (values.length !== 3 || values[2] !== '') {
    throw new Error('Ожидались два тестовых ключа, каждый на отдельной строке. Файл не создан.');
  }
  const apiKey = normalizeSandboxSecret(values[0], 'api');
  const ipnSecret = normalizeSandboxSecret(values[1], 'ipn');
  const path = resolve(root, '.env.nowpayments-sandbox');
  await writeFile(path, ['# Separate NOWPayments Sandbox credentials. Never commit this file.',
    'NOWPAYMENTS_SANDBOX_ENABLED=false', 'NOWPAYMENTS_SANDBOX_API_KEY=' + apiKey,
    'NOWPAYMENTS_SANDBOX_IPN_SECRET=' + ipnSecret, 'NOWPAYMENTS_SANDBOX_CURRENCY=btc', ''].join('\n'), { mode: 0o600, flag: 'wx' });
  return path;
}
async function main() {
  if (process.argv.length === 4 && process.argv[2] === '--validate') {
    normalizeSandboxSecret(readFileSync(0, 'utf8'), process.argv[3]);
    return;
  }
  if (process.argv.length !== 3) throw new Error('Supply the primary checkout directory');
  const path = await writeSandboxConfig(process.argv[2], readFileSync(0, 'utf8'));
  console.log('Ключи сохранены в ' + path + '. Sandbox остаётся выключен до проверки подключения.');
}
if (process.argv[1]?.endsWith('write-nowpayments-sandbox-config.mjs')) {
  main().catch(error => {
    console.error(error.code === 'EEXIST' ? 'Файл с тестовыми ключами уже существует и сохранён без изменений.' : error.message);
    process.exitCode = 1;
  });
}
