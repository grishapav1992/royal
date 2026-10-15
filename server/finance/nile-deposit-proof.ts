import { NileTestLedger, NILE_TEST_ASSET } from './nile-test-ledger';
import { NILE_ORIGINS, type TronSource } from './tron-rpc';
import { integer, NILE_GENESIS, rejectTron } from './tron-protocol';
// This verifies one already credited event on a frozen, audited test snapshot.
// It neither imports events nor enables spending or signing.
export async function verifyNileDeposit(ledger: NileTestLedger, userId: string, sources: TronSource[], txId?: string, signal?: AbortSignal) {
    if (!ledger.config.addresses.some(account => account.userId === userId)
        || (txId !== undefined && !/^[a-f0-9]{64}$/.test(txId)))
        rejectTron('invalid_deposit_proof_request');
    if (sources.length !== 2 || new Set(sources.map(source => source.id)).size !== 2
        || new Set(sources.map(source => source.origin)).size !== 2
        || sources.some(source => !NILE_ORIGINS.includes(source.origin as typeof NILE_ORIGINS[number])))
        rejectTron('invalid_deposit_proof_sources');
    const audit = await ledger.audit(), status = await ledger.status();
    if (!status.ok || !audit.ok)
        rejectTron('deposit_proof_ledger_not_ready');
    const credit = txId === undefined
        ? await ledger.db.prepare('SELECT * FROM credits WHERE user_id=? ORDER BY height,tx_id,log_index LIMIT 1').get(userId) : await ledger.db.prepare('SELECT * FROM credits WHERE user_id=? AND tx_id=? ORDER BY log_index LIMIT 1').get(userId, txId);
    const base = { network: 'nile', asset: NILE_TEST_ASSET, testOnly: true, spendable: false, userId };
    if (!credit)
        return { ...base, ok: false as const, code: 'nile_deposit_pending', depositObserved: false };
    const height = Number(credit.height), saved = await ledger.db.prepare('SELECT * FROM blocks WHERE height=?').get(height);
    if (!saved || BigInt(String(credit.amount_units)) <= 0n)
        rejectTron('invalid_deposit_proof_event');
    const balance = audit.balances.find(account => account.userId === userId)!;
    if (BigInt(balance.availableUnits) < BigInt(String(credit.amount_units)))
        rejectTron('invalid_deposit_proof_balance');
    const deadline = AbortSignal.timeout(60000), budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const results = await Promise.allSettled(sources.map(async (source) => {
        if (await source.genesis(budget) !== NILE_GENESIS)
            rejectTron('wrong_network');
        const tip = await source.tip(budget);
        integer(tip.height, 1);
        integer(tip.timestamp, 1);
        if (!/^[a-f0-9]{64}$/.test(tip.hash) || tip.height < height || tip.timestamp < Date.now() - 300000
            || tip.timestamp > Date.now() + 30000)
            rejectTron('deposit_proof_source_not_ready');
        const block = await source.block(height, budget);
        // Compare the complete normalized block, including successful receipts and logs.
        if (block.height !== height || block.hash !== saved.hash || JSON.stringify(block) !== saved.payload)
            rejectTron('deposit_proof_receipt_mismatch');
        return { origin: source.origin, finalizedHeight: tip.height, blockHash: block.hash };
    }));
    for (const result of results)
        if (result.status === 'rejected')
            throw result.reason;
    const observed = results.map(result => { if (result.status !== 'fulfilled')
        throw result.reason; return result.value; });
    return { ...base, ok: true as const, code: null, depositObserved: true, receiptConfirmedByTwoRpcs: true,
        event: { txId: String(credit.tx_id), logIndex: Number(credit.log_index), height, blockHash: String(saved.hash),
            amountUnits: String(credit.amount_units), from: String(credit.from_address), to: String(credit.to_address) },
        userBalanceUnits: balance.availableUnits, ledgerHeight: Number(audit.cursorHeight), credits: audit.credits, observed };
}
