import { depositPoolDigest } from './nile-deposit-pool';
import { createHash } from 'node:crypto';
import { NILE_WALLET_SCOPE, gameAccountId } from '../../src/shared/nileWallet';
import { NileTestLedger, type NileTestConfig } from './nile-test-ledger';
import { rejectTron } from './tron-protocol';
export type NileBindings = {
    version: 1;
    network: 'nile';
    asset: 'USDT_NILE_TEST';
    configSha256: string;
    bindings: {
        accountId: string;
        userId: string;
        address: string;
        boundAt: number;
    }[];
};
export const nileConfigSha256 = (config: NileTestConfig) => createHash('sha256').update(JSON.stringify(config)).digest('hex');
export function validateNileBindings(value: unknown, config: NileTestConfig): NileBindings {
    const manifest = value as NileBindings;
    if (!manifest || Object.keys(manifest).sort().join(',') !== 'asset,bindings,configSha256,network,version'
        || manifest.version !== 1 || manifest.network !== 'nile' || manifest.asset !== 'USDT_NILE_TEST'
        || manifest.configSha256 !== nileConfigSha256(config) || !Array.isArray(manifest.bindings)
        || manifest.bindings.length > config.addresses.length)
        return rejectTron('invalid_nile_bindings');
    const ids = new Set(), users = new Set();
    for (const row of manifest.bindings) {
        if (!row || Object.keys(row).sort().join(',') !== 'accountId,address,boundAt,userId'
            || !gameAccountId(row.accountId) || ids.has(row.accountId) || users.has(row.userId)
            || !Number.isSafeInteger(row.boundAt) || row.boundAt < 1 || row.boundAt > Date.now() + 30000
            || !config.addresses.some(account => account.userId === row.userId && account.address === row.address))
            rejectTron('invalid_nile_bindings');
        ids.add(row.accountId);
        users.add(row.userId);
    }
    return manifest;
}
export function addNileBinding(manifest: NileBindings, config: NileTestConfig, accountId: string, userId: string) {
    validateNileBindings(manifest, config);
    const address = config.addresses.find(account => account.userId === userId)?.address;
    if (!gameAccountId(accountId) || !address)
        rejectTron('invalid_nile_binding_target');
    const previous = manifest.bindings.find(row => row.accountId === accountId || row.userId === userId);
    if (previous) {
        if (previous.accountId !== accountId || previous.userId !== userId)
            rejectTron('nile_binding_conflict');
        return manifest;
    }
    return validateNileBindings({ ...manifest, bindings: [...manifest.bindings, { accountId, userId, address, boundAt: Date.now() }] }, config);
}
export async function readNileBindings(ledger: NileTestLedger): Promise<NileBindings> {
    await ledger.ready;
    const rows = await ledger.db.prepare(`SELECT account_id AS "accountId",user_id AS "userId",address,bound_at AS "boundAt"
        FROM account_bindings ORDER BY bound_at,account_id`).all();
    return validateNileBindings({ version: 1, network: 'nile', asset: 'USDT_NILE_TEST', configSha256: nileConfigSha256(ledger.config),
        bindings: rows.map(row => ({ accountId: row.accountId, userId: row.userId, address: row.address, boundAt: row.boundAt })) }, ledger.config);
}
export async function buildNileAccountViews(ledger: NileTestLedger, value: unknown, reconciliation: any, now = Date.now()) {
    const manifest = validateNileBindings(value, ledger.config);
    await ledger.ready;
    return ledger.db.transaction(async () => {
        const audit = await ledger.audit(), status = await ledger.status();
        const total = audit.balances.reduce((sum, row) => sum + BigInt(row.availableUnits), 0n).toString();
        const reconciledAt = Date.parse(reconciliation?.checked_at);
        if ((reconciliation?.poolSha256 ?? null) !== depositPoolDigest(ledger.pool) || !status.ok || !Number.isSafeInteger(reconciledAt) || now - reconciledAt > 600000 || reconciledAt > now + 30000
            || reconciliation.ok !== true || reconciliation.network !== 'nile' || reconciliation.asset !== 'USDT_NILE_TEST'
            || reconciliation.testOnly !== true || reconciliation.spendable !== false
            || reconciliation.liabilitiesUnits !== total || reconciliation.credits !== audit.credits
            || reconciliation.deficitUnits !== '0')
            rejectTron('nile_account_view_not_ready');
        const balances = new Map(audit.balances.map(wallet => [wallet.userId, wallet]));
        const recent = await ledger.db.prepare(`SELECT a.user_id,c.* FROM addresses a CROSS JOIN LATERAL (
            SELECT tx_id AS "txId",log_index AS "logIndex",height,amount_units AS "amountUnits"
            FROM credits WHERE user_id=a.user_id ORDER BY height DESC,tx_id,log_index LIMIT 50
        ) c WHERE a.user_id=ANY(?::text[]) ORDER BY a.user_id,c.height DESC,c."txId",c."logIndex"`).all(manifest.bindings.map(binding => binding.userId));
        const depositsByUser = new Map<string, { txId: string; logIndex: number; height: number; amountUnits: string }[]>();
        for (const { user_id: userId, ...deposit } of recent) {
            const deposits = depositsByUser.get(userId) ?? [];
            deposits.push(deposit as { txId: string; logIndex: number; height: number; amountUnits: string });
            depositsByUser.set(userId, deposits);
        }
        return {
            version: 1, ...NILE_WALLET_SCOPE, ready: true, generatedAt: now, ledgerHeight: Number(status.cursorHeight),
            ledgerHash: status.cursorHash, reconciledAt, bindingsSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
            wallets: manifest.bindings.map(binding => {
                const wallet = balances.get(binding.userId)!;
                return { accountId: binding.accountId, address: wallet.address, balanceUnits: wallet.availableUnits, deposits: depositsByUser.get(binding.userId) ?? [] };
            }),
        };
    }, { readOnly: true });
}
