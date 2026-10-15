import { PostgresDatabase, type DatabaseRow } from '../database';
import { readBlockAuditPage } from './block-audit-pages';
import { ledgerTrigger, immutableLedgerTables } from './pg-ledger-schema';
import { digest, integer, NILE_GENESIS, rejectTron, type TronBlock } from './tron-protocol';
export type ReaderConfig = {
    network: 'nile';
    startHeight: number;
    origins: string[];
};
export class TronReadStore {
    readonly db: PostgresDatabase;
    readonly ready: Promise<void>;
    constructor(readonly file: string, readonly config: ReaderConfig, readOnly = false, database?: PostgresDatabase) {
        integer(config.startHeight, 2);
        if (config.network !== 'nile' || config.origins.length !== 2 || config.origins[0] === config.origins[1])
            rejectTron('invalid_reader_config');
        this.db = database ?? new PostgresDatabase(file, { readOnly });
        this.ready = this.initialize(readOnly);
    }
    private async initialize(readOnly: boolean) {
        if (!readOnly)
            await this.db.transaction(async () => {
                await this.db.exec(`CREATE TABLE IF NOT EXISTS reader_state (
        id BIGINT PRIMARY KEY CHECK(id=1), version BIGINT NOT NULL CHECK(version=1), network TEXT NOT NULL CHECK(network='nile'),
        genesis TEXT NOT NULL, start_height BIGINT NOT NULL, origins TEXT NOT NULL,
        cursor_height BIGINT, cursor_hash TEXT, halted_reason TEXT,
        lease_owner TEXT, lease_until BIGINT, last_checked_at BIGINT, last_success_at BIGINT,
        last_error TEXT, finalized_height BIGINT, last_backup_at BIGINT,
        CHECK ((cursor_height IS NULL)=(cursor_hash IS NULL)));
        CREATE TABLE IF NOT EXISTS blocks (height BIGINT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, parent_hash TEXT NOT NULL,
          payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb)='object'), payload_sha256 TEXT NOT NULL, committed_at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS transfers (tx_id TEXT NOT NULL, log_index BIGINT NOT NULL CHECK(log_index>=0), height BIGINT NOT NULL REFERENCES blocks(height),
          contract TEXT NOT NULL, from_address TEXT NOT NULL, to_address TEXT NOT NULL, amount_units TEXT NOT NULL,
          PRIMARY KEY(tx_id,log_index), CHECK(length(amount_units) BETWEEN 1 AND 78 AND amount_units ~ '^[0-9]+$'));
        CREATE INDEX IF NOT EXISTS transfers_height_order ON transfers(height,tx_id,log_index);`);
                await ledgerTrigger(this.db, 'reader_state', 'sealed_reader_config', 'UPDATE', `
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.network IS DISTINCT FROM OLD.network
          OR NEW.genesis IS DISTINCT FROM OLD.genesis OR NEW.start_height IS DISTINCT FROM OLD.start_height OR NEW.origins IS DISTINCT FROM OLD.origins
          OR (OLD.halted_reason IS NOT NULL AND NEW.halted_reason IS DISTINCT FROM OLD.halted_reason)
        THEN RAISE EXCEPTION 'reader configuration and halt are sealed'; END IF;`);
                await ledgerTrigger(this.db, 'reader_state', 'protected_reader_state', 'DELETE', "RAISE EXCEPTION 'protected state';");
                for (const table of ['blocks', 'transfers'])
                    for (const operation of ['UPDATE', 'DELETE']) {
                        await ledgerTrigger(this.db, table, `protected_${table}_${operation.toLowerCase()}`, operation, "RAISE EXCEPTION 'immutable reader journal';");
                    }
                await this.db.prepare(`INSERT INTO reader_state(id,version,network,genesis,start_height,origins) VALUES(1,1,'nile',?,?,?) ON CONFLICT DO NOTHING`)
                    .run(NILE_GENESIS, this.config.startHeight, JSON.stringify([...this.config.origins].sort()));
            });
        const state = await this.db.prepare('SELECT * FROM reader_state WHERE id=1').get();
        if (!state || state.version !== 1 || state.genesis !== NILE_GENESIS || state.start_height !== this.config.startHeight
            || state.origins !== JSON.stringify([...this.config.origins].sort())) {
            await this.db.close();
            rejectTron('saved_config_mismatch');
        }
    }
    async state() { await this.ready; return (await this.db.prepare('SELECT * FROM reader_state WHERE id=1').get())!; }
    private async transaction<T>(action: () => Promise<T>, write = true): Promise<T> {
        await this.ready;
        return this.db.transaction(action, { readOnly: !write });
    }
    async acquire(owner: string, now = Date.now()): Promise<boolean> {
        await this.ready;
        return await this.transaction(async () => {
            const state = await this.state();
            if (state.halted_reason)
                rejectTron('reader_halted');
            if (Number(state.lease_until ?? 0) > now && state.lease_owner !== owner)
                return false;
            await this.db.prepare('UPDATE reader_state SET lease_owner=?,lease_until=? WHERE id=1').run(owner, now + 90000);
            return true;
        });
    }
    async release(owner: string) { await this.ready; await this.db.prepare('UPDATE reader_state SET lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?').run(owner); }
    private async checkLease(owner: string) {
        await this.ready;
        const state = await this.state();
        if (state.lease_owner !== owner || Number(state.lease_until) <= Date.now())
            rejectTron('reader_lease_expired');
        if (state.halted_reason)
            rejectTron('reader_halted');
        return state;
    }
    async halt(owner: string, reason: 'finalized_block_changed' | 'saved_data_corrupted') {
        await this.ready;
        await this.transaction(async () => {
            await this.checkLease(owner);
            await this.db.prepare('UPDATE reader_state SET halted_reason=?,last_error=? WHERE id=1').run(reason, reason);
        });
    }
    async verifySaved(owner: string, block: TronBlock) {
        await this.ready;
        await this.checkLease(owner);
        const saved = await this.db.prepare('SELECT payload,payload_sha256 FROM blocks WHERE height=?').get(block.height);
        if (!saved || digest(String(saved.payload)) !== saved.payload_sha256) {
            await this.halt(owner, 'saved_data_corrupted');
            rejectTron('saved_data_corrupted');
        }
        if (saved.payload !== JSON.stringify(block)) {
            await this.halt(owner, 'finalized_block_changed');
            rejectTron('finalized_block_changed');
        }
    }
    async commit(owner: string, block: TronBlock, anchor = false) {
        await this.ready;
        await this.transaction(async () => {
            const state = await this.checkLease(owner);
            if (anchor) {
                if (state.cursor_height !== null || block.height !== this.config.startHeight - 1)
                    rejectTron('invalid_anchor');
            }
            else if (block.height !== Number(state.cursor_height) + 1 || block.parentHash !== state.cursor_hash)
                rejectTron('chain_gap');
            const payload = JSON.stringify(block);
            await this.db.prepare('INSERT INTO blocks(height,hash,parent_hash,payload,payload_sha256,committed_at) VALUES(?,?,?,?,?,?)')
                .run(block.height, block.hash, block.parentHash, payload, digest(payload), Date.now());
            if (!anchor) {
                const insert = this.db.prepare('INSERT INTO transfers(tx_id,log_index,height,contract,from_address,to_address,amount_units) VALUES(?,?,?,?,?,?,?)');
                for (const event of block.transfers)
                    await insert.run(event.txId, event.logIndex, block.height, event.contract, event.from, event.to, event.amountUnits);
            }
            await this.db.prepare('UPDATE reader_state SET cursor_height=?,cursor_hash=? WHERE id=1').run(block.height, block.hash);
        });
    }
    async success(owner: string, finalizedHeight: number) {
        await this.ready;
        await this.transaction(async () => {
            await this.checkLease(owner);
            await this.db.prepare('UPDATE reader_state SET last_checked_at=?,last_success_at=?,last_error=NULL,finalized_height=? WHERE id=1')
                .run(Date.now(), Date.now(), finalizedHeight);
        });
    }
    async finalized(owner: string, height: number) {
        await this.ready;
        await this.transaction(async () => {
            await this.checkLease(owner);
            await this.db.prepare('UPDATE reader_state SET finalized_height=? WHERE id=1').run(height);
        });
    }
    async failure(code: string) {
        await this.ready;
        await this.db.prepare('UPDATE reader_state SET last_checked_at=?,last_error=? WHERE id=1').run(Date.now(), code);
    }
    async status() {
        await this.ready;
        return await this.transaction(async () => {
            const state = await this.state();
            const counts = (await this.db.prepare('SELECT (SELECT count(*) FROM blocks) AS blocks,(SELECT count(*) FROM transfers) AS transfers').get())!;
            const ok = !state.halted_reason && !state.last_error && state.last_success_at !== null
                && Date.now() - Number(state.last_success_at) < 180000
                && Number(state.finalized_height) - Number(state.cursor_height) <= 100;
            return { ok, mode: 'watch-only', network: 'nile', schemaVersion: 1, startHeight: state.start_height, cursorHeight: state.cursor_height,
                cursorHash: state.cursor_hash, finalizedHeight: state.finalized_height, haltedReason: state.halted_reason, lastError: state.last_error,
                lastSuccessAt: state.last_success_at, lastCheckedAt: state.last_checked_at, lastBackupAt: state.last_backup_at,
                blocks: counts.blocks, transfers: counts.transfers,
                moneyCredited: false, hasSigningKeys: false };
        }, false);
    }
    async audit() {
        await this.ready;
        return await this.transaction(async () => {
            await this.db.integrityCheck();
            const state = await this.state();
            const transferRange = (await this.db.prepare(`SELECT pg_catalog.count(*) AS n,
                pg_catalog.min(height) AS first_height,pg_catalog.max(height) AS last_height FROM transfers`).get())!;
            let blocks = 0, transfers = 0, height = this.config.startHeight - 2;
            let hash: string | null = null, after: number | undefined;
            while (true) {
                const rows = await readBlockAuditPage(this.db, after);
                if (rows.length === 0) break;
                if (rows.some(row => row.payload === null)) rejectTron('saved_data_corrupted');
                const hasSavedTransfers = transferRange.first_height !== null && rows[0].height <= transferRange.last_height
                    && rows.at(-1)!.height >= transferRange.first_height;
                const saved = hasSavedTransfers ? await this.db.prepare(`SELECT height,tx_id,log_index,contract,from_address,to_address,amount_units FROM transfers
                    WHERE height BETWEEN ? AND ? ORDER BY height,tx_id,log_index`).all(rows[0].height, rows.at(-1)!.height) : [];
                const eventsByHeight = new Map<number, DatabaseRow[]>();
                for (const { height, ...event } of saved) {
                    const events = eventsByHeight.get(height) ?? [];
                    events.push(event);
                    eventsByHeight.set(height, events);
                }
                for (const row of rows) {
                    const payload = String(row.payload);
                    if (digest(payload) !== row.payload_sha256) rejectTron('saved_data_corrupted');
                    const block = JSON.parse(payload) as TronBlock;
                    if (!block || typeof block !== 'object' || !Number.isSafeInteger(block.height)
                        || typeof block.hash !== 'string' || typeof block.parentHash !== 'string'
                        || row.height !== block.height || row.hash !== block.hash || row.parent_hash !== block.parentHash
                        || block.height !== height + 1 || (hash !== null && block.parentHash !== hash))
                        rejectTron('saved_chain_gap');
                    const events = eventsByHeight.get(block.height) ?? [];
                    if (blocks !== 0 && !Array.isArray(block.transfers)) rejectTron('saved_event_mismatch');
                    const expected = blocks === 0 ? [] : block.transfers.map(event => ({ tx_id: event.txId, log_index: event.logIndex,
                        contract: event.contract, from_address: event.from, to_address: event.to, amount_units: event.amountUnits }))
                        .sort((a, b) => a.tx_id.localeCompare(b.tx_id) || a.log_index - b.log_index);
                    if (JSON.stringify(events) !== JSON.stringify(expected)) rejectTron('saved_event_mismatch');
                    blocks++;
                    transfers += events.length;
                    height = block.height;
                    hash = block.hash;
                }
                after = rows.at(-1)!.height;
            }
            if (blocks ? height !== state.cursor_height || hash !== state.cursor_hash : state.cursor_height !== null)
                rejectTron('saved_cursor_mismatch');
            if (Number(transferRange.n) !== transfers)
                rejectTron('saved_event_mismatch');
            return { ok: true, blocks, transfers, cursorHeight: state.cursor_height, schemaVersion: 1, network: 'nile' };
        }, false);
    }
    async close() { await this.ready.catch(() => {}); await this.db.close(); }
}
