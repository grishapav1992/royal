import { depositPoolDigest } from './nile-deposit-pool';
import { setTimeout as delay } from 'node:timers/promises';
import { NileRpc, NILE_ORIGINS } from './tron-rpc';
import { integer, NILE_GENESIS, record, rejectTron, TronReadError, type TronHeader } from './tron-protocol';
import { NileTestLedger, NILE_TEST_ASSET, NILE_TEST_TOKEN } from './nile-test-ledger';
export type NileBalanceSource = {
    id: string;
    origin: string;
    genesis(signal?: AbortSignal): Promise<string>;
    tip(signal?: AbortSignal): Promise<TronHeader>;
    anchor(height: number, signal?: AbortSignal): Promise<TronHeader>;
    decimals(signal?: AbortSignal): Promise<bigint>;
    balance(address: string, signal?: AbortSignal): Promise<bigint>;
};
export class NileBalanceRpc implements NileBalanceSource {
    private chain: NileRpc;
    private tail: Promise<void> = Promise.resolve();
    private nextRequestAt = 0;
    constructor(readonly id: string, readonly origin: string, private transport: typeof fetch = fetch) {
        this.chain = new NileRpc(id, origin, (input, init) => this.request(input, init));
    }
    private request(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
        // Pace all selectors together by request start, including header reads.
        const result = this.tail.then(async () => {
            for (let attempt = 0;; attempt++) {
                const pause = Math.max(0, this.nextRequestAt - Date.now());
                if (pause)
                    await delay(pause, undefined, { signal: init?.signal ?? undefined });
                this.nextRequestAt = Date.now() + 500;
                const response = await this.transport(input, init);
                if (attempt > 0 || ![429, 502, 503, 504].includes(response.status))
                    return response;
                await response.body?.cancel();
                await delay(2000, undefined, { signal: init?.signal ?? undefined });
            }
        });
        this.tail = result.then(() => { }, () => { });
        return result;
    }
    genesis(signal?: AbortSignal) { return this.chain.genesis(signal); }
    tip(signal?: AbortSignal) { return this.chain.tip(signal); }
    anchor(height: number, signal?: AbortSignal) { return this.chain.block(height, signal); }
    decimals(signal?: AbortSignal) { return this.constant('decimals()', '', signal); }
    async balance(address: string, signal?: AbortSignal) {
        if (!/^41[a-f0-9]{40}$/.test(address))
            return rejectTron('invalid_nile_address');
        return this.constant('balanceOf(address)', address.slice(2).padStart(64, '0'), signal);
    }
    private async constant(selector: 'decimals()' | 'balanceOf(address)', parameter: string, signal?: AbortSignal): Promise<bigint> {
        for (let attempt = 0;; attempt++) {
            try {
                const deadline = AbortSignal.timeout(10000);
                const response = await this.request(this.origin + '/walletsolidity/triggerconstantcontract', {
                    method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
                    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
                    body: JSON.stringify({ owner_address: NILE_TEST_TOKEN, contract_address: NILE_TEST_TOKEN, function_selector: selector, parameter, visible: false }),
                });
                if (response.status === 429)
                    rejectTron('rpc_rate_limited');
                if (!response.ok || !response.body)
                    rejectTron('rpc_unavailable');
                if (Number(response.headers.get('content-length') ?? 0) > 65536)
                    rejectTron('rpc_response_limit');
                const reader = response.body.getReader(), chunks: Uint8Array[] = [];
                let size = 0;
                try {
                    for (;;) {
                        const part = await reader.read();
                        if (part.done)
                            break;
                        size += part.value.length;
                        if (size > 65536) {
                            await reader.cancel();
                            rejectTron('rpc_response_limit');
                        }
                        chunks.push(part.value);
                    }
                }
                finally {
                    reader.releaseLock();
                }
                const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                if (Object.hasOwn(body, 'Error') || record(body.result).result !== true || !Array.isArray(body.constant_result)
                    || body.constant_result.length !== 1 || typeof body.constant_result[0] !== 'string'
                    || !/^[a-f0-9]{64}$/.test(body.constant_result[0]))
                    rejectTron('invalid_token_response');
                // A successful HTTP/API request is insufficient when the simulated TVM call failed.
                const transaction = record(body.transaction);
                if (!Array.isArray(transaction.ret) || transaction.ret.length !== 1)
                    rejectTron('invalid_token_response');
                const ret = record(transaction.ret[0]);
                if (ret.ret !== undefined && ret.ret !== 'SUCCESS')
                    rejectTron('token_execution_failed');
                return BigInt('0x' + body.constant_result[0]);
            }
            catch (error) {
                const normalized = error instanceof TronReadError ? error : new TronReadError(signal?.aborted ? 'reconciliation_deadline' : 'rpc_unavailable');
                if (attempt === 0 && ['rpc_unavailable', 'rpc_rate_limited'].includes(normalized.code))
                    continue;
                throw normalized;
            }
        }
    }
}
function freshHeader(header: TronHeader, cursor: number) {
    integer(header.height, 1);
    integer(header.timestamp, 1);
    if (!/^[a-f0-9]{64}$/.test(header.hash) || header.height < cursor)
        rejectTron('reconciliation_source_behind');
    if (header.timestamp < Date.now() - 300000 || header.timestamp > Date.now() + 30000)
        rejectTron('reconciliation_source_stale');
}
// Call only with a static, fully audited PostgreSQL snapshot. The original journal stays read-only.
export async function reconcileNileSnapshot(ledger: NileTestLedger, sources: NileBalanceSource[], signal?: AbortSignal) {
    // Check freshness when entering the snapshot, before the complete historical audit.
    // The repeatable-read snapshot cannot see the creditor's subsequent heartbeats.
    const status = await ledger.status(), audit = await ledger.audit(), config = ledger.config;
    if (!status.ok || !audit.ok || status.asset !== NILE_TEST_ASSET)
        rejectTron('reconciliation_ledger_not_ready');
    if (sources.length !== 2 || new Set(sources.map(source => source.id)).size !== 2
        || new Set(sources.map(source => source.origin)).size !== 2
        || sources.some(source => !NILE_ORIGINS.includes(source.origin as typeof NILE_ORIGINS[number])))
        rejectTron('invalid_balance_sources');
    const cursor = Number(audit.cursorHeight), cursorHash = String((await ledger.state()).cursor_hash);
    if (cursor < config.startHeight || !/^[a-f0-9]{64}$/.test(cursorHash))
        rejectTron('reconciliation_ledger_empty');
    const liabilities = audit.balances.reduce((total, account) => total + BigInt(account.availableUnits), 0n);
    const deadline = AbortSignal.timeout(ledger.pool ? 90000 : 60000), budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const initialized = await Promise.allSettled(sources.map(async (source) => {
        if (await source.genesis(budget) !== NILE_GENESIS)
            rejectTron('wrong_network');
        if (await source.decimals(budget) !== 6n)
            rejectTron('test_token_scale_mismatch');
        const anchor = await source.anchor(cursor, budget);
        if (anchor.height !== cursor || anchor.hash !== cursorHash)
            rejectTron('reconciliation_ledger_anchor_changed');
    }));
    for (const result of initialized)
        if (result.status === 'rejected')
            throw result.reason;
    if (ledger.pool) {
        // Verify complete balance vectors twice on both independently anchored nodes.
        // Tips may advance during a pass; stable vectors and per-address coverage are
        // required. This does not claim a simultaneous multi-address block snapshot.
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const results = await Promise.allSettled(sources.map(async (source) => {
                    let previous = await source.tip(budget);
                    freshHeader(previous, cursor);
                    const passes = [];
                    for (let pass = 0; pass < 2; pass++) {
                        const balances = [];
                        for (const address of ledger.addresses) {
                            const units = await source.balance(address.address, budget);
                            if (typeof units !== 'bigint' || units < 0n || units >= 2n ** 256n)
                                rejectTron('invalid_token_amount');
                            balances.push({ userId: address.userId, address: address.address, units: units.toString() });
                        }
                        const after = await source.tip(budget);
                        freshHeader(after, cursor);
                        if (after.height < previous.height || (after.height === previous.height && after.hash !== previous.hash))
                            rejectTron('reconciliation_boundary_changed');
                        previous = after;
                        passes.push(balances);
                    }
                    if (JSON.stringify(passes[0]) !== JSON.stringify(passes[1]))
                        rejectTron('reconciliation_sources_disagree');
                    return { origin: source.origin, height: previous.height, hash: previous.hash, balances: passes[1] };
                }));
                for (const r of results)
                    if (r.status === 'rejected')
                        throw r.reason;
                const observed = results.map(r => { if (r.status !== 'fulfilled')
                    throw r.reason; return r.value; });
                const spread = Math.abs(observed[0].height - observed[1].height);
                if (spread > 6 || (spread === 0 && observed[0].hash !== observed[1].hash) || JSON.stringify(observed[0].balances) !== JSON.stringify(observed[1].balances))
                    rejectTron('reconciliation_sources_disagree');
                let assets = 0n, deficit = 0n;
                for (const address of observed[0].balances) {
                    const units = BigInt(address.units), owed = BigInt(audit.balances.find(a => a.userId === address.userId)!.availableUnits);
                    assets += units;
                    if (units < owed)
                        deficit += owed - units;
                }
                return { ok: deficit === 0n, code: deficit === 0n ? null : 'nile_test_deficit', testOnly: true, network: 'nile', asset: NILE_TEST_ASSET,
                    checkedAt: new Date().toISOString(), ledgerHeight: cursor, ledgerHash: cursorHash, credits: audit.credits,
                    liabilitiesUnits: liabilities.toString(), assetsUnits: assets.toString(), excessUnits: (assets > liabilities ? assets - liabilities : 0n).toString(), deficitUnits: deficit.toString(),
                    depositObserved: audit.credits > 0, spendable: false, poolSha256: depositPoolDigest(ledger.pool), viewMode: 'matching_rpc_balances_two_passes', sameConfirmedBoundary: false, sourceHeightSpread: spread, observed };
            }
            catch (e) {
                if (attempt === 2 || !(e instanceof TronReadError) || !['reconciliation_boundary_changed', 'reconciliation_sources_disagree'].includes(e.code))
                    throw e;
                await delay(300, undefined, { signal: budget });
            }
        }
        return rejectTron('reconciliation_not_ready');
    }
    for (let attempt = 0; attempt < 12; attempt++) {
        try {
            const results = await Promise.allSettled(sources.map(async (source) => {
                const before = await source.tip(budget);
                freshHeader(before, cursor);
                const balances = [];
                for (const address of config.addresses) {
                    const units = await source.balance(address.address, budget);
                    if (typeof units !== 'bigint' || units < 0n || units >= 2n ** 256n)
                        rejectTron('invalid_token_amount');
                    balances.push({ userId: address.userId, address: address.address, units: units.toString() });
                }
                const after = await source.tip(budget);
                freshHeader(after, cursor);
                if (before.height !== after.height || before.hash !== after.hash)
                    rejectTron('reconciliation_boundary_changed');
                return { origin: source.origin, height: after.height, hash: after.hash, balances };
            }));
            for (const result of results)
                if (result.status === 'rejected')
                    throw result.reason;
            const observed = results.map(result => { if (result.status !== 'fulfilled')
                throw result.reason; return result.value; });
            const heightSpread = Math.abs(observed[0].height - observed[1].height);
            // RPC nodes may solidify at different heights. Each view must be stable,
            // share the audited ledger anchor, and return identical token balances.
            if (heightSpread > 6 || (heightSpread === 0 && observed[0].hash !== observed[1].hash)
                || JSON.stringify(observed[0].balances) !== JSON.stringify(observed[1].balances))
                rejectTron('reconciliation_sources_disagree');
            const assets = observed[0].balances.reduce((total, address) => total + BigInt(address.units), 0n), covered = assets >= liabilities;
            return { ok: covered, code: covered ? null : 'nile_test_deficit', testOnly: true, network: 'nile', asset: NILE_TEST_ASSET,
                checkedAt: new Date().toISOString(), ledgerHeight: cursor, ledgerHash: cursorHash, credits: audit.credits,
                liabilitiesUnits: liabilities.toString(), assetsUnits: assets.toString(),
                excessUnits: (assets > liabilities ? assets - liabilities : 0n).toString(), deficitUnits: (covered ? 0n : liabilities - assets).toString(),
                depositObserved: audit.credits > 0, spendable: false, viewMode: 'matching_rpc_balances',
                sameConfirmedBoundary: heightSpread === 0, sourceHeightSpread: heightSpread, observed };
        }
        catch (error) {
            if (attempt === 11 || !(error instanceof TronReadError) || !['reconciliation_boundary_changed', 'reconciliation_sources_disagree'].includes(error.code))
                throw error;
            // Vary the delay so retries cannot repeatedly hit the same block update phase.
            await delay(125 + (attempt * 137) % 500, undefined, { signal: budget });
        }
    }
    return rejectTron('reconciliation_not_ready');
}
