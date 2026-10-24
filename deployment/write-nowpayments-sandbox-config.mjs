import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function writeSandboxConfig(root, input) {
  const values = input.split(/\r?\n/);
  if (values.length !== 3 || values[2] !== '' || !values.slice(0, 2).every(value => /^[A-Za-z0-9._~+\/=\-]{16,512}$/.test(value))) {
    throw new Error('Invalid Sandbox API key or IPN secret; no file was written');
  }
  const path = resolve(root, '.env.nowpayments-sandbox');
  await writeFile(path, ['# Separate NOWPayments Sandbox credentials. Never commit this file.',
    'NOWPAYMENTS_SANDBOX_ENABLED=false', 'NOWPAYMENTS_SANDBOX_API_KEY=' + values[0],
    'NOWPAYMENTS_SANDBOX_IPN_SECRET=' + values[1], 'NOWPAYMENTS_SANDBOX_CURRENCY=btc', ''].join('\n'), { mode: 0o600, flag: 'wx' });
  return path;
}
if (process.argv[1]?.endsWith('write-nowpayments-sandbox-config.mjs')) {
  try {
    if (process.argv.length !== 3) throw new Error('Supply the primary checkout directory');
    const path = await writeSandboxConfig(process.argv[2], readFileSync(0, 'utf8'));
    console.log('Sandbox keys saved in ' + path + '. Sandbox remains disabled until verification.');
  } catch (error) { console.error(error.code === 'EEXIST' ? 'Sandbox config already exists; it was preserved.' : error.message); process.exitCode = 1; }
}
