import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { NilePlayLedger, validateNilePlayConfig } from '../server/finance/nile-play-ledger';
if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile')
    throw new Error('test_scope_required');
const config = validateNilePlayConfig(JSON.parse(readFileSync('/config/play.json', 'utf8'))), file = process.env.NILE_PLAY_PROOF_SCHEMA ?? 'royal_nile_play_proof';
let ledger = new NilePlayLedger(file, config, false, () => 0);
const owner = randomUUID(), request = { id: randomUUID(), stakeUnits: '1000000' };
try {
    const initial = await ledger.audit();
    assert.equal(initial.bindings, 0);
    assert.equal(initial.rounds, 0);
    assert.equal(initial.totalUnits, '1000000000');
    await ledger.allocateReserve(config.reserveUserId, '800000000');
    await ledger.claim(owner, await ledger.invite(config.reserveUserId));
    const first = await ledger.spin(owner, request);
    assert.equal(first.round.payoutUnits, '12000000');
    assert.equal((first.wallet as any).balanceUnits, '211000000');
    await ledger.close();
    ledger = new NilePlayLedger(file, config, false, () => { throw new Error('replay_must_not_draw'); });
    await ledger.failure('simulated_lost_response');
    const replay = await ledger.spin(owner, request);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.round, first.round);
    const audit = await ledger.audit();
    assert.equal(audit.rounds, 1);
    assert.equal(audit.totalUnits, '1000000000');
    assert.equal(BigInt(audit.playerUnits) + BigInt(audit.houseUnits), 1000000000n);
    console.log(JSON.stringify({ ok: true, network: 'nile', testOnly: true, isolatedClone: true, productionBalancesChanged: false, sourceCredits: initial.credits, stakeUnits: request.stakeUnits, payoutUnits: first.round.payoutUnits, playerUnits: audit.playerUnits, houseUnits: audit.houseUnits, totalUnits: audit.totalUnits, restartReplayChecked: true, rounds: audit.rounds }));
}
finally {
    await ledger.close();
}
