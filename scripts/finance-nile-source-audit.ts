import { readFileSync } from 'node:fs';
import { loadNileDepositPool } from '../server/finance/nile-deposit-pool';
import { validateNilePlayConfig } from '../server/finance/nile-play-ledger';
import { NileTestLedger } from '../server/finance/nile-test-ledger';
import { AUDIT_ROW_LIMIT, AUDIT_PAYLOAD_LIMIT } from '../server/finance/block-audit-pages';

if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile')
    throw new Error('test_scope_required');
const config = validateNilePlayConfig(JSON.parse(readFileSync(process.env.NILE_PLAY_CONFIG_FILE ?? '/config/play.json', 'utf8')));
const source = new NileTestLedger(process.env.NILE_TEST_SCHEMA ?? 'royal_nile_deposits', config.source, true, loadNileDepositPool());
const started = Date.now();
try {
    const audit = await source.audit();
    console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - started, pageRowLimit: AUDIT_ROW_LIMIT,
        pageByteLimit: AUDIT_PAYLOAD_LIMIT, blocks: audit.blocks, credits: audit.credits }));
}
finally {
    await source.close();
}
