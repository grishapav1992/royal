import { PostgresDatabase, type DatabaseRow } from '../database';
import { ledgerTrigger, immutableLedgerTables } from './pg-ledger-schema';
import { digest, integer, NILE_GENESIS, rejectTron, type TronBlock } from './tron-protocol';
import { NILE_ORIGINS } from './tron-rpc';
import { nileBase58, nilePublicKeyAddress } from './nile-address';
import { sealNileDepositPool, depositPoolDigest, type NileDepositPool } from './nile-deposit-pool';
import { migrateFinanceQueries } from './performance-migrations';
import { readBlockAuditPage } from './block-audit-pages';
export const NILE_TEST_TOKEN = '41eca9bc828a3005b9a3b909f2cc5c2a54794de05f';
export const NILE_TEST_ASSET = 'USDT_NILE_TEST';
const zero = '410000000000000000000000000000000000000000';
const maxUnits = 10n ** 30n;
export type NileTestConfig = {
    version: 1;
    network: 'nile';
    genesis: string;
    token: string;
    scale: 6;
    asset: typeof NILE_TEST_ASSET;
    startHeight: number;
    readerStartHeight: number;
    origins: string[];
    addresses: {
        userId: string;
        address: string;
        publicKey: string;
    }[];
};
export function validateNileTestConfig(value: unknown): NileTestConfig {
    const config = value as NileTestConfig;
    if (!config || Object.keys(config).sort().join(',') !== 'addresses,asset,genesis,network,origins,readerStartHeight,scale,startHeight,token,version'
        || config.version !== 1 || config.network !== 'nile' || config.genesis !== NILE_GENESIS || config.token !== NILE_TEST_TOKEN
        || config.scale !== 6 || config.asset !== NILE_TEST_ASSET || !Array.isArray(config.origins)
        || JSON.stringify([...config.origins].sort()) !== JSON.stringify([...NILE_ORIGINS].sort())
        || !Array.isArray(config.addresses) || config.addresses.length < 1 || config.addresses.length > 100)
        return rejectTron('invalid_test_config');
    integer(config.startHeight, 2);
    integer(config.readerStartHeight, 2);
    if (config.startHeight < config.readerStartHeight)
        rejectTron('invalid_test_config');
    const users = new Set(), addresses = new Set();
    for (const account of config.addresses) {
        if (!account || Object.keys(account).sort().join(',') !== 'address,publicKey,userId'
            || !/^[a-zA-Z0-9_-]{1,64}$/.test(account.userId) || users.has(account.userId) || addresses.has(account.address)
            || nilePublicKeyAddress(account.publicKey) !== account.address || account.address === zero || account.address === NILE_TEST_TOKEN)
            rejectTron('invalid_test_config');
        users.add(account.userId);
        addresses.add(account.address);
    }
    return config;
}
function blockShape(block: TronBlock) {
    integer(block.height, 1);
    integer(block.timestamp, 1);
    if (typeof block.hash !== 'string' || typeof block.parentHash !== 'string'
        || !/^[a-f0-9]{64}$/.test(block.hash) || !/^[a-f0-9]{64}$/.test(block.parentHash)
        || BigInt('0x' + block.hash.slice(0, 16)) !== BigInt(block.height)
        || BigInt('0x' + block.parentHash.slice(0, 16)) !== BigInt(block.height - 1)
        || !Array.isArray(block.txIds) || !Array.isArray(block.outcomes) || !Array.isArray(block.transfers)
        || block.txIds.length > 10000 || block.transfers.length > 10000 || new Set(block.txIds).size !== block.txIds.length
        || block.outcomes.length !== block.txIds.length)
        rejectTron('invalid_test_block');
    if (block.outcomes.some(row => !row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.txId !== 'string' || typeof row.status !== 'string'))
        rejectTron('invalid_test_block');
    const outcomes = new Map(block.outcomes.map(row => [row.txId, row.status]));
    if (outcomes.size !== block.txIds.length || block.txIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || !outcomes.has(id)))
        rejectTron('invalid_test_block');
    const events = new Set();
    for (const event of block.transfers) {
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.txId !== 'string')
            rejectTron('invalid_test_block');
        integer(event.logIndex, 0);
        const key = event.txId + ':' + event.logIndex;
        if (events.has(key) || outcomes.get(event.txId) !== 'SUCCESS'
            || ![event.contract, event.from, event.to].every(address => typeof address === 'string' && /^41[a-f0-9]{40}$/.test(address))
            || typeof event.amountUnits !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(event.amountUnits) || BigInt(event.amountUnits) >= 2n ** 256n)
            rejectTron('invalid_test_block');
        events.add(key);
    }
}
export function eligibleNileTransfers(config: NileTestConfig, block: TronBlock, pool?: NileDepositPool) {
    const addresses = new Map([...config.addresses, ...(pool && block.height >= pool.startHeight ? pool.addresses : [])].map(row => [row.address, row.userId]));
    return eligibleTransfersWithAddresses(config, block, addresses);
}
function eligibleTransfersWithAddresses(config: NileTestConfig, block: TronBlock, addresses: ReadonlyMap<string, string>) {
    blockShape(block);
    return block.height < config.startHeight ? [] : block.transfers.filter(event => event.contract === config.token
        && addresses.has(event.to) && !addresses.has(event.from) && event.from !== zero && event.to !== zero && BigInt(event.amountUnits) > 0n)
        .map(event => ({ ...event, userId: addresses.get(event.to)! }));
}
export class NileTestLedger {
    readonly db: PostgresDatabase;
    readonly ready: Promise<void>;
    readonly config: NileTestConfig;
    readonly pool?: NileDepositPool;
    get addresses() { return [...this.config.addresses, ...(this.pool?.addresses ?? [])]; }
    constructor(readonly file: string, config: NileTestConfig, readOnly = false, pool?: NileDepositPool, database?: PostgresDatabase) {
        this.config = validateNileTestConfig(config);
        this.db = database ?? new PostgresDatabase(file, { readOnly });
        this.pool = pool;
        this.ready = this.initialize(readOnly);
    }
    private async initialize(readOnly: boolean) {
        if (!readOnly)
            await this.db.transaction(async () => {
                await this.db.exec(`CREATE TABLE IF NOT EXISTS state (
        id BIGINT PRIMARY KEY CHECK(id=1), config TEXT NOT NULL CHECK(jsonb_typeof(config::jsonb)='object'), cursor_height BIGINT NOT NULL,
        cursor_hash TEXT, halted_reason TEXT, last_success_at BIGINT, last_error TEXT, last_backup_at BIGINT);
        CREATE TABLE IF NOT EXISTS addresses (user_id TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS blocks (height BIGINT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, parent_hash TEXT NOT NULL,
          payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb)='object'), payload_sha256 TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS credits (tx_id TEXT NOT NULL, log_index BIGINT NOT NULL, height BIGINT NOT NULL REFERENCES blocks(height),
          user_id TEXT NOT NULL REFERENCES addresses(user_id), contract TEXT NOT NULL, from_address TEXT NOT NULL, to_address TEXT NOT NULL,
          amount_units TEXT NOT NULL CHECK(length(amount_units) BETWEEN 1 AND 31 AND amount_units ~ '^[0-9]+$' AND amount_units<>'0'),
          PRIMARY KEY(tx_id,log_index));
        CREATE TABLE IF NOT EXISTS entries (tx_id TEXT NOT NULL, log_index BIGINT NOT NULL, account TEXT NOT NULL, amount_units TEXT NOT NULL,
          PRIMARY KEY(tx_id,log_index,account), FOREIGN KEY(tx_id,log_index) REFERENCES credits(tx_id,log_index));
        CREATE TABLE IF NOT EXISTS account_bindings (account_id TEXT PRIMARY KEY, user_id TEXT UNIQUE REFERENCES addresses(user_id),
          address TEXT NOT NULL, bound_at BIGINT NOT NULL CHECK(bound_at>0));
        CREATE INDEX IF NOT EXISTS credits_height_order ON credits(height,tx_id,log_index);`);
                await ledgerTrigger(this.db, 'state', 'sealed_state', 'UPDATE', `
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.config IS DISTINCT FROM OLD.config
          OR (OLD.halted_reason IS NOT NULL AND NEW.halted_reason IS DISTINCT FROM OLD.halted_reason)
        THEN RAISE EXCEPTION 'sealed test state'; END IF;`);
                await ledgerTrigger(this.db, 'state', 'protected_state', 'DELETE', "RAISE EXCEPTION 'protected state';");
                await immutableLedgerTables(this.db, ['addresses', 'blocks', 'credits', 'entries', 'account_bindings'], 'immutable test journal');
                const first = await this.db.prepare('INSERT INTO state(id,config,cursor_height) VALUES(1,?,?) ON CONFLICT DO NOTHING').run(JSON.stringify(this.config), this.config.startHeight - 1);
                await this.installPolicies(false);
                if (first.changes)
                    for (const account of this.config.addresses)
                        await this.db.prepare('INSERT INTO addresses VALUES(?,?,?)').run(account.userId, account.address, account.publicKey);
                await sealNileDepositPool(this.db, this.pool, this.config.addresses, this.config.startHeight, false);
                if (this.pool) {
                    await this.installPolicies(true);
                    for (const a of this.pool.addresses)
                        await this.db.prepare('INSERT INTO addresses VALUES(?,?,?) ON CONFLICT DO NOTHING').run(a.userId, a.address, a.publicKey);
                }
            });
        if (!readOnly)
            await migrateFinanceQueries(this.db, 'nile-deposits');
        const state = await this.db.prepare('SELECT * FROM state WHERE id=1').get();
        if (!state || state.config !== JSON.stringify(this.config)) {
            await this.db.close();
            rejectTron('saved_test_config_mismatch');
        }
        await sealNileDepositPool(this.db, this.pool, this.config.addresses, this.config.startHeight, true);
    }
    private async installPolicies(withPool: boolean) {
        const permittedPool = withPool ? ` OR EXISTS(SELECT 1 FROM deposit_pool, jsonb_array_elements(deposit_pool.manifest::jsonb->'addresses') a(value)
      WHERE a.value->>'userId'=NEW.user_id AND a.value->>'address'=NEW.address AND a.value->>'publicKey'=NEW.public_key)` : '';
        await ledgerTrigger(this.db, 'addresses', 'address_policy', 'INSERT', `
      IF NOT (EXISTS(SELECT 1 FROM state, jsonb_array_elements(state.config::jsonb->'addresses') a(value)
        WHERE a.value->>'userId'=NEW.user_id AND a.value->>'address'=NEW.address AND a.value->>'publicKey'=NEW.public_key) ${permittedPool})
      THEN RAISE EXCEPTION 'unassigned address'; END IF;`);
        await ledgerTrigger(this.db, 'account_bindings', 'account_binding_policy', 'INSERT', `
      IF NEW.account_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        OR NEW.bound_at>9007199254740991 OR NEW.bound_at>floor(extract(epoch FROM clock_timestamp())*1000)+30000
        OR NOT EXISTS(SELECT 1 FROM state, jsonb_array_elements(state.config::jsonb->'addresses') a(value)
          WHERE a.value->>'userId'=NEW.user_id AND a.value->>'address'=NEW.address)
      THEN RAISE EXCEPTION 'invalid manual binding'; END IF;`);
        await ledgerTrigger(this.db, 'credits', 'credit_policy', 'INSERT', `
      IF NEW.contract IS DISTINCT FROM (SELECT config::jsonb->>'token' FROM state)
        OR NEW.height<(SELECT (config::jsonb->>'startHeight')::bigint FROM state)
        OR NOT EXISTS(SELECT 1 FROM addresses WHERE user_id=NEW.user_id AND address=NEW.to_address)
        OR EXISTS(SELECT 1 FROM addresses WHERE address=NEW.from_address) OR NEW.from_address='${zero}'
        OR NOT EXISTS(SELECT 1 FROM blocks, jsonb_array_elements(blocks.payload::jsonb->'transfers') e(value) WHERE blocks.height=NEW.height
          AND e.value->>'txId'=NEW.tx_id AND (e.value->>'logIndex')::bigint=NEW.log_index
          AND e.value->>'amountUnits'=NEW.amount_units AND e.value->>'contract'=NEW.contract
          AND e.value->>'from'=NEW.from_address AND e.value->>'to'=NEW.to_address)
      THEN RAISE EXCEPTION 'invalid credit'; END IF;`);
        await ledgerTrigger(this.db, 'entries', 'entry_policy', 'INSERT', `
      IF NOT EXISTS(SELECT 1 FROM credits c WHERE c.tx_id=NEW.tx_id AND c.log_index=NEW.log_index
        AND ((NEW.account='user:'||c.user_id AND NEW.amount_units=c.amount_units)
          OR (NEW.account='external' AND NEW.amount_units='-'||c.amount_units)))
      THEN RAISE EXCEPTION 'invalid entry'; END IF;`);
    }
    async state() { await this.ready; return (await this.db.prepare('SELECT * FROM state WHERE id=1').get())!; }
    async halt(reason: string) {
        await this.ready;
        if (!(await this.state()).halted_reason)
            await this.db.prepare('UPDATE state SET halted_reason=?,last_error=? WHERE id=1').run(reason, reason);
    }
    async failure(code: string) { await this.ready; await this.db.prepare('UPDATE state SET last_error=? WHERE id=1').run(code); }
    async verifySaved(block: TronBlock) {
        await this.ready;
        const saved = await this.db.prepare('SELECT payload,payload_sha256 FROM blocks WHERE height=?').get(block.height);
        if (!saved || saved.payload_sha256 !== digest(String(saved.payload)) || saved.payload !== JSON.stringify(block)) {
            await this.halt('test_chain_changed');
            rejectTron('test_chain_changed');
        }
    }
    async ingest(block: TronBlock, anchor = false) {
        await this.ready;
        const eligible = eligibleNileTransfers(this.config, block, this.pool);
        if (eligible.some(event => BigInt(event.amountUnits) > maxUnits)) {
            await this.halt('test_amount_limit');
            rejectTron('test_amount_limit');
        }
        return this.db.transaction(async () => {
            const state = await this.state();
            if (state.halted_reason)
                rejectTron('test_ledger_halted');
            if (anchor) {
                if (state.cursor_hash !== null || block.height !== this.config.startHeight - 1)
                    rejectTron('invalid_test_anchor');
            }
            else if (block.height !== Number(state.cursor_height) + 1 || block.parentHash !== state.cursor_hash)
                rejectTron('test_chain_gap');
            const payload = JSON.stringify(block);
            await this.db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?)').run(block.height, block.hash, block.parentHash, payload, digest(payload));
            if (!anchor)
                for (const event of eligible) {
                    await this.db.prepare('INSERT INTO credits VALUES(?,?,?,?,?,?,?,?)').run(event.txId, event.logIndex, block.height, event.userId, event.contract, event.from, event.to, event.amountUnits);
                    const insert = this.db.prepare('INSERT INTO entries VALUES(?,?,?,?)');
                    await insert.run(event.txId, event.logIndex, 'external', '-' + event.amountUnits);
                    await insert.run(event.txId, event.logIndex, 'user:' + event.userId, event.amountUnits);
                }
            await this.db.prepare('UPDATE state SET cursor_height=?,cursor_hash=?,last_success_at=?,last_error=NULL WHERE id=1').run(block.height, block.hash, Date.now());
            return anchor ? 0 : eligible.length;
        });
    }
    async success() { await this.ready; await this.db.prepare('UPDATE state SET last_success_at=?,last_error=NULL WHERE id=1').run(Date.now()); }
    async snapshot(userId: string) {
        await this.ready;
        const account = await this.db.prepare('SELECT * FROM addresses WHERE user_id=?').get(userId);
        if (!account)
            return rejectTron('test_user_not_found');
        const units = String((await this.db.prepare('SELECT COALESCE(SUM(amount_units::numeric),0)::text AS units FROM entries WHERE account=?')
            .get('user:' + userId))!.units);
        return { userId, network: 'nile', asset: NILE_TEST_ASSET, scale: 6, testOnly: true,
            address: nileBase58(String(account.address)), availableUnits: units, spendable: false };
    }
    private async snapshots() {
        const totals = await this.db.prepare("SELECT account,SUM(amount_units::numeric)::text AS units FROM entries WHERE account<>'external' GROUP BY account").all();
        const balances = new Map(totals.map(row => [String(row.account), String(row.units)]));
        return this.addresses.map(account => ({ userId: account.userId, network: 'nile', asset: NILE_TEST_ASSET, scale: 6, testOnly: true,
            address: nileBase58(account.address), availableUnits: balances.get('user:' + account.userId) ?? '0', spendable: false }));
    }
    async status() {
        await this.ready;
        return this.db.transaction(async () => {
            const state = await this.state();
            const balances = await this.snapshots();
            return { ok: !state.halted_reason && !state.last_error && Number(state.last_success_at ?? 0) > Date.now() - 180000,
                network: 'nile', asset: NILE_TEST_ASSET, testOnly: true, hasSigningKeys: false, schemaVersion: 1,
                cursorHeight: state.cursor_height, cursorHash: state.cursor_hash, haltedReason: state.halted_reason,
                lastError: state.last_error, lastSuccessAt: state.last_success_at, lastBackupAt: state.last_backup_at,
                credits: (await this.db.prepare('SELECT count(*) AS count FROM credits').get())!.count,
                balances };
        }, { readOnly: true });
    }
    async audit() {
        await this.ready;
        return this.db.transaction(async () => {
            await sealNileDepositPool(this.db, this.pool, this.config.addresses, this.config.startHeight, true);
            await this.db.integrityCheck();
            const actual = await this.db.prepare("SELECT user_id AS \"userId\",address,public_key AS \"publicKey\" FROM addresses ORDER BY user_id").all();
            if (JSON.stringify(actual) !== JSON.stringify([...this.addresses].sort((a, b) => a.userId < b.userId ? -1 : 1)))
                rejectTron('test_ledger_corrupted');
            const state = await this.state();
            const creditRange = (await this.db.prepare(`SELECT pg_catalog.count(*) AS n,
                pg_catalog.min(height) AS first_height,pg_catalog.max(height) AS last_height FROM credits`).get())!;
            let height = this.config.startHeight - 2, parent: string | null = null, credits = 0, blocks = 0;
            let lastHeight: number | undefined;
            // Reuse the sealed address sets for this snapshot while validating every block.
            const originalAddresses = new Map(this.config.addresses.map(row => [row.address, row.userId]));
            const pooledAddresses = new Map([...this.config.addresses, ...(this.pool?.addresses ?? [])].map(row => [row.address, row.userId]));
            while (true) {
                const rows = await readBlockAuditPage(this.db, lastHeight);
                if (rows.length === 0)
                    break;
                if (rows.some(row => row.payload === null)) rejectTron('test_ledger_corrupted');
                const hasSavedCredits = creditRange.first_height !== null && rows[0].height <= creditRange.last_height
                    && rows.at(-1)!.height >= creditRange.first_height;
                const saved = hasSavedCredits ? await this.db.prepare('SELECT * FROM credits WHERE height BETWEEN ? AND ? ORDER BY height,tx_id,log_index')
                    .all(rows[0].height, rows.at(-1)!.height) : [];
                const savedEntries = saved.length ? await this.db.prepare(`SELECT c.height,e.tx_id,e.log_index,e.account,e.amount_units FROM entries e
                    JOIN credits c ON c.tx_id=e.tx_id AND c.log_index=e.log_index
                    WHERE c.height BETWEEN ? AND ? ORDER BY c.height,e.tx_id,e.log_index,e.account`)
                    .all(rows[0].height, rows.at(-1)!.height) : [];
                const creditsByHeight = new Map<number, Map<string, DatabaseRow>>();
                for (const credit of saved) {
                    const atHeight = creditsByHeight.get(credit.height) ?? new Map<string, DatabaseRow>();
                    atHeight.set(credit.tx_id + ':' + credit.log_index, credit);
                    creditsByHeight.set(credit.height, atHeight);
                }
                const entriesByEvent = new Map<string, DatabaseRow[]>();
                for (const entry of savedEntries) {
                    const key = entry.tx_id + ':' + entry.log_index;
                    const entries = entriesByEvent.get(key) ?? [];
                    entries.push(entry);
                    entriesByEvent.set(key, entries);
                }
                for (const row of rows) {
                    const payload = String(row.payload), block = JSON.parse(payload) as TronBlock;
                    const events = eligibleTransfersWithAddresses(this.config, block,
                        this.pool && block.height >= this.pool.startHeight ? pooledAddresses : originalAddresses);
                    if (row.payload_sha256 !== digest(payload) || row.height !== height + 1 || row.height !== block.height
                        || row.hash !== block.hash || row.parent_hash !== block.parentHash || (parent && block.parentHash !== parent))
                        rejectTron('test_ledger_corrupted');
                    const atHeight = creditsByHeight.get(block.height);
                    if (events.length !== (atHeight?.size ?? 0)) rejectTron('test_ledger_corrupted');
                    for (const event of events) {
                        const key = event.txId + ':' + event.logIndex, found = atHeight?.get(key);
                        if (!found || found.user_id !== event.userId || found.contract !== event.contract || found.from_address !== event.from
                            || found.to_address !== event.to || found.amount_units !== event.amountUnits || BigInt(event.amountUnits) > maxUnits)
                            rejectTron('test_ledger_corrupted');
                        const entries = entriesByEvent.get(key) ?? [];
                        if (entries.length !== 2 || entries[0].account !== 'external' || entries[0].amount_units !== '-' + event.amountUnits
                            || entries[1].account !== 'user:' + event.userId || entries[1].amount_units !== event.amountUnits)
                            rejectTron('test_ledger_corrupted');
                    }
                    credits += events.length;
                    blocks++;
                    height = block.height;
                    parent = block.hash;
                }
                lastHeight = rows.at(-1)!.height;
            }
            if (Number(state.cursor_height) !== (blocks ? height : this.config.startHeight - 1) || state.cursor_hash !== parent
                || Number(creditRange.n) !== credits
                || Number((await this.db.prepare('SELECT count(*) AS n FROM entries').get())!.n) !== credits * 2)
                rejectTron('test_ledger_corrupted');
            const balances = await this.snapshots();
            return { ok: true, network: 'nile', asset: NILE_TEST_ASSET, testOnly: true, blocks, credits,
                cursorHeight: state.cursor_height, totalUnits: '0', ...(this.pool ? { poolSha256: depositPoolDigest(this.pool) } : {}), balances };
        }, { readOnly: true });
    }
    async close() { await this.ready.catch(() => {}); await this.db.close(); }
}
