import { createHash, randomBytes } from 'node:crypto';
import { PostgresDatabase, type DatabaseRow } from '../database';
import { ledgerTrigger, immutableLedgerTables } from './pg-ledger-schema';
import { migrateFinanceQueries } from './performance-migrations';
import { gameAccountId, nileUnits } from '../../src/shared/nileWallet';
import { NILE_PLAY_SCOPE, NILE_BETS, validNileRound, validNileRoundRequest, type NileRound, type NilePlayWallet } from '../../src/shared/nilePlay';
import { NileTestLedger, validateNileTestConfig, type NileTestConfig } from './nile-test-ledger';
import { nileBase58 } from './nile-address';
import { COINS_MAX_MULTIPLIER } from '../../src/shared/gameCore';
import { playRoyalCoins } from '../games/core';
import { sealNileDepositPool, depositPoolDigest, type NileDepositPool } from './nile-deposit-pool';
import { applyPvpMoneyEvent, pvpEventId, isPvpMoneyGame, type PvpMoneyEvent, type PvpMoneyMatch } from './pvp-money';
import { validPvpStake } from '../../src/shared/pvp';
import {nativeMoneyEntries,type NativeMoneyEvent} from './native-game-money';
import { adjustmentRequest, requireFinanceAdmin, sameAdjustment } from '../admin/validation';
import { queryFinanceReport, nileReportSql } from '../admin/report';
import type { FinanceAdjustment } from '../../src/shared/financeAdmin';
export type NilePlayConfig = {
    version: 1;
    source: NileTestConfig;
    houseUserId: string;
    reserveUserId: string;
    initialReserveUnits: string;
};
import {NilePlayError} from './nile-play-error';
export {NilePlayError} from './nile-play-error';
const fail = (code: string, status = 409): never => { throw new NilePlayError(code, status); };
export const playDigest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function validateNilePlayConfig(value: unknown): NilePlayConfig {
    const config = value as NilePlayConfig;
    if (!config || Object.keys(config).sort().join(',') !== 'houseUserId,initialReserveUnits,reserveUserId,source,version'
        || config.version !== 1 || !nileUnits(config.initialReserveUnits) || BigInt(config.initialReserveUnits) > 1000000000n)
        return fail('invalid_play_config');
    validateNileTestConfig(config.source);
    if (config.houseUserId === config.reserveUserId || ![config.houseUserId, config.reserveUserId].every(id => config.source.addresses.some(a => a.userId === id)))
        fail('invalid_play_config');
    return config;
}
type Funding = {
    txId: string;
    logIndex: number;
    height: number;
    userId: string;
    amountUnits: string;
    playerUnits: string;
    reserveUnits: string;
};
type StoredRound = NileRound & {
    accountId: string;
    userId: string;
};
type Entry = {
    account: string;
    units: string;
};
type Reserve = {
    userId: string;
    units: string;
    createdAt: number;
};
type Adjustment = FinanceAdjustment & {userId:string};
const adjustmentEntries = (row: Adjustment): Entry[] => [{account:'player:'+row.userId,units:row.deltaUnits},{account:'house',units:(-BigInt(row.deltaUnits)).toString()}];
const reserveEntries = (row: Reserve): Entry[] => [{ account: 'player:' + row.userId, units: '-' + row.units }, { account: 'house', units: row.units }];
function fundingEntries(row: Funding): Entry[] {
    return [{ account: 'external', units: '-' + row.amountUnits }, { account: 'player:' + row.userId, units: row.playerUnits }, { account: 'house', units: row.reserveUnits }];
}
function roundEntries(row: StoredRound): Entry[] {
    return [{ account: 'player:' + row.userId, units: '-' + row.stakeUnits }, { account: 'house', units: row.stakeUnits },
        { account: 'house', units: row.payoutUnits === '0' ? '0' : '-' + row.payoutUnits }, { account: 'player:' + row.userId, units: row.payoutUnits }];
}
export class NilePlayLedger {
    readonly db: PostgresDatabase;
    readonly ready: Promise<void>;
    readonly config: NilePlayConfig;
    readonly pool?: NileDepositPool;
    get addresses() { return [...this.config.source.addresses, ...(this.pool?.addresses ?? [])]; }
    private async bindings() { await this.ready; return [...await this.db.prepare('SELECT * FROM bindings').all(), ...(this.pool ? await this.db.prepare('SELECT * FROM auto_bindings').all() : [])]; }
    private async binding(accountId: string) { await this.ready; return (await this.bindings()).find(b => b.account_id === accountId); }
    constructor(readonly file: string, config: NilePlayConfig, readOnly = false, private draw?: () => number, pool?: NileDepositPool, database?: PostgresDatabase) {
        this.config = validateNilePlayConfig(config);
        this.db = database ?? new PostgresDatabase(file, { readOnly });
        this.pool = pool;
        this.ready = this.initialize(readOnly);
    }
    private async initialize(readOnly: boolean) {
        if (!readOnly)
            await this.db.transaction(async () => {
                await this.db.exec(`CREATE TABLE IF NOT EXISTS state(id BIGINT PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, halted TEXT,
        source_at BIGINT, reconciled_at BIGINT, source_credits BIGINT, source_units TEXT, source_height BIGINT, source_hash TEXT, last_error TEXT);
        CREATE TABLE IF NOT EXISTS events(seq BIGINT PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('funding','round','reserve')),
          payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb)='object'), sha256 TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entries(seq BIGINT NOT NULL REFERENCES events(seq), line BIGINT NOT NULL, account TEXT NOT NULL, units TEXT NOT NULL, PRIMARY KEY(seq,line));
        CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS bindings(account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, invite_hash TEXT NOT NULL UNIQUE REFERENCES invites(hash), created_at BIGINT NOT NULL);`);
                await this.db.exec(`ALTER TABLE events DROP CONSTRAINT IF EXISTS events_kind_check;
                  ALTER TABLE events ADD CONSTRAINT events_kind_check CHECK(kind IN ('funding','round','reserve','pvp','native','adjustment'));
                  CREATE INDEX IF NOT EXISTS play_pvp_match_seq ON events((payload::jsonb->>'matchId'),seq) WHERE kind='pvp';`);
                await ledgerTrigger(this.db, 'state', 'sealed_state', 'UPDATE', `
        IF NEW.config IS DISTINCT FROM OLD.config OR NEW.id IS DISTINCT FROM OLD.id OR (OLD.halted IS NOT NULL AND NEW.halted IS DISTINCT FROM OLD.halted)
        THEN RAISE EXCEPTION 'sealed play state'; END IF;`);
                await ledgerTrigger(this.db, 'state', 'protected_state', 'DELETE', "RAISE EXCEPTION 'protected play state';");
                await immutableLedgerTables(this.db, ['events', 'entries', 'invites', 'bindings'], 'immutable play journal');
                await this.db.prepare('INSERT INTO state(id,config) VALUES(1,?) ON CONFLICT DO NOTHING').run(JSON.stringify(this.config));
                await sealNileDepositPool(this.db, this.pool, this.config.source.addresses, this.config.source.startHeight, false);
                if (this.pool) {
                    await this.db.exec(`CREATE TABLE IF NOT EXISTS auto_bindings(account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL, source_height BIGINT NOT NULL);`);
                    await immutableLedgerTables(this.db, ['auto_bindings'], 'immutable wallet owner');
                }
            });
        if (!readOnly)
            await migrateFinanceQueries(this.db, 'nile-play');
        const state = await this.db.prepare('SELECT * FROM state WHERE id=1').get();
        if (!state || state.config !== JSON.stringify(this.config)) {
            await this.db.close();
            fail('saved_play_config_mismatch');
        }
        await sealNileDepositPool(this.db, this.pool, this.config.source.addresses, this.config.source.startHeight, true);
        await this.db.transaction(() => this.auditRows(), { readOnly: true });
    }
    async state() { await this.ready; return (await this.db.prepare('SELECT * FROM state WHERE id=1').get())!; }
    async failure(code: string) { await this.ready; await this.db.prepare('UPDATE state SET last_error=? WHERE id=1').run(code); }
    async halt(code: string) { await this.ready; await this.db.prepare('UPDATE state SET halted=COALESCE(halted,?),last_error=? WHERE id=1').run(code, code); }
    private async transaction<T>(action: () => Promise<T>, write = true): Promise<T> {
        await this.ready;
        return this.db.transaction(action, { readOnly: !write });
    }
    private async append(id: string, kind: string, payload: Funding | StoredRound | Reserve | PvpMoneyEvent | NativeMoneyEvent | Adjustment, entries: Entry[]) {
        await this.ready;
        const text = JSON.stringify(payload);
        const seq = (await this.db.prepare('INSERT INTO events(seq,id,kind,payload,sha256) SELECT COALESCE(MAX(seq),0)+1,?,?,?,? FROM events RETURNING seq').run(id, kind, text, playDigest(text))).lastInsertRowid;
        for (const [line, entry] of entries.entries()) await this.db.prepare('INSERT INTO entries VALUES(?,?,?,?)').run(seq, line, entry.account, entry.units);
    }
    private async balance(account: string) {
        await this.ready;
        return BigInt(String((await this.db.prepare('SELECT COALESCE(SUM(units::numeric),0)::text AS units FROM entries WHERE account=?').get(account))!.units));
    }
    private async importedReserve() {
        await this.ready;
        return BigInt(String((await this.db.prepare(`SELECT COALESCE(SUM((payload::jsonb->>'reserveUnits')::numeric),0)::text AS units
            FROM events WHERE kind='funding' AND (payload::jsonb->>'userId')=?`).get(this.config.reserveUserId))!.units));
    }
    private allocate(userId: string, amount: bigint, reserved: bigint) {
        const remaining = BigInt(this.config.initialReserveUnits) - reserved;
        return userId === this.config.houseUserId ? amount : userId === this.config.reserveUserId && remaining > 0n ? (amount < remaining ? amount : remaining) : 0n;
    }
    async sync(source: NileTestLedger, reconciliation: any, now?: number) {
        const clock = now === undefined ? Date.now : () => now!;
        await this.ready;
        if (JSON.stringify(source.config) !== JSON.stringify(this.config.source) || depositPoolDigest(source.pool) !== depositPoolDigest(this.pool))
            fail('play_source_config_mismatch', 503);
        await source.ready;
        return source.db.transaction(async () => {
            // The source heartbeat belongs to the snapshot captured before its full audit.
            const status = await source.status(), audit = await source.audit();
            now = clock();
            const total = audit.balances.reduce((sum, a) => sum + BigInt(a.availableUnits), 0n).toString();
            const at = Date.parse(reconciliation?.checked_at);
            if ((reconciliation?.poolSha256 ?? null) !== depositPoolDigest(this.pool) || !status.ok || reconciliation?.ok !== true || reconciliation.network !== 'nile' || reconciliation.asset !== 'USDT_NILE_TEST'
                || reconciliation.testOnly !== true || reconciliation.spendable !== false || reconciliation.deficitUnits !== '0'
                || reconciliation.liabilitiesUnits !== total || reconciliation.credits !== audit.credits
                || !Number.isSafeInteger(at) || at > now + 30000 || now - at > 600000)
                fail('play_source_not_ready', 503);
            await this.audit();
            try {
                return await this.transaction(async () => {
                    const state = await this.state();
                    if (state.halted) fail('play_halted', 503);
                    if (Number(state.source_height ?? 0) > Number(status.cursorHeight)) fail('play_source_rewound', 503);
                    const importedCount = Number((await this.db.prepare("SELECT count(*) AS n FROM events WHERE kind='funding'").get())!.n);
                    if (importedCount > audit.credits) fail('play_source_rewound', 503);
                    let reserved = await this.importedReserve(), seen = 0, importedSeq = 0;
                    let after: { height: number; txId: string; logIndex: number } | undefined;
                    while (true) {
                        const select = 'SELECT tx_id AS "txId",log_index AS "logIndex",height,user_id AS "userId",amount_units AS "amountUnits" FROM credits';
                        const credits = (after ? await source.db.prepare(select + ' WHERE (height,tx_id,log_index)>(?,?,?) ORDER BY height,tx_id,log_index LIMIT 128').all(after.height, after.txId, after.logIndex)
                            : await source.db.prepare(select + ' ORDER BY height,tx_id,log_index LIMIT 128').all()) as unknown as Omit<Funding, 'playerUnits' | 'reserveUnits'>[];
                        if (credits.length === 0) break;
                        const imported = seen < importedCount ? await this.db.prepare("SELECT seq,id,payload FROM events WHERE kind='funding' AND seq>? ORDER BY seq LIMIT 128").all(importedSeq) : [];
                        for (let i = 0; i < credits.length; i++) {
                            const row = credits[i], id = 'funding:' + row.txId + ':' + row.logIndex;
                            if (seen < importedCount) {
                                const prior = imported[i], previous = prior ? JSON.parse(String(prior.payload)) : undefined;
                                if (!prior || prior.id !== id || Object.entries(row).some(([k, v]) => previous[k] !== v)) fail('play_source_changed', 503);
                                importedSeq = Number(prior.seq);
                            } else {
                                const reserve = this.allocate(row.userId, BigInt(row.amountUnits), reserved);
                                const funding = { ...row, playerUnits: (BigInt(row.amountUnits) - reserve).toString(), reserveUnits: reserve.toString() };
                                await this.append(id, 'funding', funding, fundingEntries(funding));
                                if (row.userId === this.config.reserveUserId) reserved += reserve;
                            }
                            seen++;
                        }
                        after = credits.at(-1)!;
                    }
                    if (seen !== audit.credits) fail('play_source_changed', 503);
                    await this.db.prepare('UPDATE state SET source_at=?,reconciled_at=?,source_credits=?,source_units=?,source_height=?,source_hash=?,last_error=NULL WHERE id=1')
                        .run(clock(), at, audit.credits, total, status.cursorHeight, status.cursorHash);
                    return seen - importedCount;
                });
            } catch (error) {
                if (error instanceof NilePlayError && ['play_source_rewound', 'play_source_changed'].includes(error.code)) await this.halt(error.code);
                throw error;
            }
        }, { readOnly: true });
    }
    async isReady(now = Date.now()) {
        await this.ready;
        const state = await this.state();
        return !state.halted && !state.last_error && Number(state.source_at ?? 0) <= now + 30000 && now - Number(state.source_at ?? 0) < 90000
            && Number(state.reconciled_at ?? 0) <= now + 30000 && now - Number(state.reconciled_at ?? 0) < 600000;
    }
    async provision(accountId: string, now = Date.now()): Promise<NilePlayWallet> {
        await this.ready;
        if (!gameAccountId(accountId))
            fail('invalid_play_account', 400);
        return await this.transaction(async () => {
            if (await this.binding(accountId))
                return await this.wallet(accountId, now);
            const pool = this.pool;
            if (!pool)
                return fail('play_deposit_unavailable', 503);
            if (!await this.isReady(now))
                fail('play_source_not_ready', 503);
            if (Number((await this.state()).source_height) < pool.startHeight - 1)
                fail('play_deposit_unavailable', 503);
            const used = new Set((await this.bindings()).map(b => b.user_id));
            // Never hand an already funded or previously assigned address to another account.
            let address: NileDepositPool['addresses'][number] | undefined;
            for (const candidate of pool.addresses) {
                if (!used.has(candidate.userId) && !await this.db.prepare("SELECT 1 FROM events WHERE kind='funding' AND (payload::jsonb->>'userId')=?").get(candidate.userId)) {
                    address = candidate; break;
                }
            }
            if (!address)
                return fail('play_deposit_pool_exhausted', 503);
            await this.db.prepare('INSERT INTO auto_bindings VALUES(?,?,?,?)').run(accountId, address.userId, now, (await this.state()).source_height);
            return await this.wallet(accountId, now);
        });
    }
    async invite(userId: string, now = Date.now()) {
        await this.ready;
        if (!this.config.source.addresses.some(a => a.userId === userId) || userId === this.config.houseUserId)
            fail('invalid_invite_user');
        return await this.transaction(async () => {
            if (await this.db.prepare('SELECT 1 FROM bindings WHERE user_id=?').get(userId))
                fail('play_already_assigned');
            const code = randomBytes(32).toString('base64url');
            await this.db.prepare('INSERT INTO invites VALUES(?,?,?,?)').run(playDigest(code), userId, now, now + 86400000);
            return code;
        });
    }
    async allocateReserve(userId: string, units: string, now = Date.now()) {
        await this.ready;
        if (userId !== this.config.reserveUserId || !nileUnits(units) || BigInt(units) < 1n || BigInt(units) > 1000000000n)
            return fail('invalid_reserve_allocation');
        return await this.transaction(async () => {
            if (!await this.isReady(now))
                fail('play_source_not_ready', 503);
            if (await this.db.prepare('SELECT 1 FROM bindings WHERE user_id=?').get(userId))
                fail('reserve_requires_unassigned_wallet');
            if (await this.db.prepare("SELECT 1 FROM events WHERE kind='round' OR id=?").get('reserve:' + userId))
                fail('reserve_already_started');
            if (await this.balance('player:' + userId) < BigInt(units))
                fail('play_insufficient_balance');
            const row = { userId, units, createdAt: now };
            await this.append('reserve:' + userId, 'reserve', row, reserveEntries(row));
            return await this.auditAfterAllocation();
        });
    }
    private async auditAfterAllocation() { await this.ready; return { ok: true, houseUnits: (await this.balance('house')).toString(), playerUnits: (await this.balance('player:' + this.config.reserveUserId)).toString() }; }
    async claim(accountId: string, code: unknown, now = Date.now()) {
        await this.ready;
        if (!gameAccountId(accountId) || typeof code !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(code))
            return fail('invalid_play_invite', 400);
        return await this.transaction(async () => {
            if ((await this.state()).halted)
                fail('play_halted', 503);
            const hash = playDigest(code), existing = await this.db.prepare('SELECT * FROM bindings WHERE invite_hash=?').get(hash);
            if (existing?.account_id === accountId)
                return await this.wallet(accountId, now);
            const invite = await this.db.prepare('SELECT * FROM invites WHERE hash=?').get(hash);
            if (!invite || existing || Number(invite.expires_at) <= now || Number(invite.created_at) > now)
                return fail('invalid_play_invite', 400);
            if (await this.binding(accountId) || (await this.bindings()).some(b => b.user_id === invite.user_id))
                fail('play_binding_conflict');
            await this.db.prepare('INSERT INTO bindings VALUES(?,?,?,?)').run(accountId, invite.user_id, hash, now);
            return await this.wallet(accountId, now);
        });
    }
    async wallet(accountId: string, now = Date.now()): Promise<NilePlayWallet> {
        await this.ready;
        return this.db.transaction(async () => {
        if (!gameAccountId(accountId))
            return fail('invalid_play_account', 400);
        const binding = await this.binding(accountId);
        if (!binding)
            return { ...NILE_PLAY_SCOPE, state: 'unassigned' };
        const userId = String(binding.user_id), state = await this.state(), house = await this.balance('house');
        const max = [...NILE_BETS].reverse().find(bet => house >= BigInt(bet) * BigInt(COINS_MAX_MULTIPLIER - 1)) ?? '0';
        const deposits = (await this.db.prepare("SELECT payload FROM events WHERE kind='funding' AND (payload::jsonb->>'userId')=? ORDER BY seq DESC LIMIT 50").all(userId)).map(e => {
            const { txId, logIndex, height, amountUnits, playerUnits, reserveUnits } = JSON.parse(String(e.payload)) as Funding;
            return { txId, logIndex, height, amountUnits, playerUnits, reserveUnits };
        });
        const rounds = (await this.db.prepare("SELECT payload FROM events WHERE kind='round' AND (payload::jsonb->>'accountId')=? ORDER BY seq DESC LIMIT 50").all(accountId)).map(e => this.publicRound(JSON.parse(String(e.payload))));
        const allocation = await this.db.prepare('SELECT payload FROM events WHERE id=?').get('reserve:' + userId);
        return { ...NILE_PLAY_SCOPE, state: 'assigned', address: nileBase58(this.addresses.find(a => a.userId === userId)!.address),
            balanceUnits: (await this.balance('player:' + userId)).toString(),
            reservedUnits: String(BigInt(String((await this.db.prepare("SELECT COALESCE(SUM(units::numeric),0)::text AS units FROM entries WHERE account LIKE 'pvp:%' AND right(account,length(?)+1)=':'||?").get(userId,userId))!.units)) + await this.balance('games-reserved:'+userId)),
            revision:Number((await this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get())!.seq),
            updatedAt: Number(state.source_at ?? 0), ready: await this.isReady(now), maxStakeUnits: max, reserveAllocatedUnits: allocation ? JSON.parse(String(allocation.payload)).units : '0', deposits, rounds };
        }, { readOnly: true });
    }
    private publicRound(row: StoredRound): NileRound { const { id, stakeUnits, payoutUnits, symbols, multiplier, createdAt } = row; return { id, stakeUnits, payoutUnits, symbols, multiplier, createdAt }; }
    async spin(accountId: string, request: unknown, now = Date.now()) {
        await this.ready;
        if (!gameAccountId(accountId) || !validNileRoundRequest(request))
            return fail('invalid_play_request', 400);
        return await this.transaction(async () => {
            const key = 'round:' + accountId + ':' + request.id, previous = await this.db.prepare('SELECT payload FROM events WHERE id=?').get(key);
            if (previous) {
                const row = JSON.parse(String(previous.payload)) as StoredRound;
                if (row.stakeUnits !== request.stakeUnits)
                    fail('play_idempotency_conflict');
                return { wallet: await this.wallet(accountId, now), round: this.publicRound(row), replayed: true };
            }
            if (!await this.isReady(now))
                fail('play_source_not_ready', 503);
            const binding = await this.binding(accountId);
            if (!binding)
                return fail('play_wallet_unassigned');
            const userId = String(binding.user_id), stake = BigInt(request.stakeUnits);
            if (await this.balance('player:' + userId) < stake)
                fail('play_insufficient_balance');
            // Cover the largest possible net payout before drawing any random symbols.
            if (await this.balance('house') < stake * BigInt(COINS_MAX_MULTIPLIER - 1))
                fail('play_reserve_insufficient');
            const count = (await this.db.prepare("SELECT count(*) AS n FROM events WHERE kind='round' AND (payload::jsonb->>'accountId')=? AND ((payload::jsonb->>'createdAt')::bigint)>?").get(accountId, now - 60000))!;
            if (Number(count.n) >= 60)
                fail('play_rate_limit', 429);
            // This sealed journal remains pinned to Royal Coins rules v1 and its legacy payload.
            const result = playRoyalCoins(stake, this.draw);
            const row: StoredRound = { ...request, accountId, userId, symbols: result.outcome.symbols, multiplier: result.multiplier, payoutUnits: result.payoutUnits, createdAt: now };
            if (!validNileRound(row))
                fail('invalid_play_draw', 503);
            await this.append(key, 'round', row, roundEntries(row));
            return { wallet: await this.wallet(accountId, now), round: this.publicRound(row), replayed: false };
        });
    }
    async audit() {
        await this.ready;
        return this.db.transaction(() => this.auditRows(), { readOnly: true });
    }
    async nativeTransaction<T>(accountId:string,action:(context:{userId:string;available:bigint;reserved:bigint;house:bigint;ready:boolean;
        post:(after:bigint,reserved:bigint,requestHash:string)=>Promise<void>})=>Promise<T>,now=Date.now()):Promise<T>{
        if(!gameAccountId(accountId))return fail('invalid_play_account',400);
        return this.transaction(async()=>{
            const binding=await this.binding(accountId);if(!binding)return fail('play_wallet_unassigned');
            const userId=String(binding.user_id),available=await this.balance('player:'+userId),reserved=await this.balance('games-reserved:'+userId),house=await this.balance('house');
            return action({userId,available,reserved,house,ready:await this.isReady(now),post:async(after,afterReserve,requestHash)=>{
                if(after<0n||afterReserve<0n||house+available-after+reserved-afterReserve<0n)fail('play_reserve_insufficient');
                const id=randomBytes(16);id[6]=(id[6]&15)|64;id[8]=(id[8]&63)|128;
                const uuid=id.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
                const event:NativeMoneyEvent={version:1,id:uuid,accountId,userId,beforeUnits:String(available),afterUnits:String(after),beforeReserveUnits:String(reserved),afterReserveUnits:String(afterReserve),createdAt:now,requestHash};
                await this.append('native:'+uuid,'native',event,nativeMoneyEntries(event));
            }});
        });
    }
    private async pvpMatch(matchId: string) {
        const matches = new Map<string, PvpMoneyMatch>();
        for (const event of await this.db.prepare("SELECT payload FROM events WHERE kind='pvp' AND (payload::jsonb->>'matchId')=? ORDER BY seq").all(matchId)) {
            applyPvpMoneyEvent(JSON.parse(String(event.payload)), matches);
        }
        return matches;
    }
    async pvpHold(accountId: string, value: unknown, now = Date.now()) {
        const row = value as { matchId: string; gameId: string; stakeUnits: string };
        if (!gameAccountId(accountId) || !row || Object.keys(row).sort().join(',') !== 'gameId,matchId,stakeUnits'
            || !gameAccountId(row.matchId) || !isPvpMoneyGame(row.gameId) || !validPvpStake(row.stakeUnits)) return fail('invalid_pvp_request',400);
        const gameId = row.gameId;
        return this.transaction(async () => {
            const matches = await this.pvpMatch(row.matchId), match = matches.get(row.matchId);
            if (match?.participants.some(owner => owner.accountId === accountId)) {
                if (match.gameId !== gameId || match.stakeUnits !== row.stakeUnits) fail('play_idempotency_conflict');
                return { wallet: await this.wallet(accountId, now), replayed: true };
            }
            if (match?.final || match && (match.gameId !== gameId || match.stakeUnits !== row.stakeUnits || match.participants.length >= 2)) fail('pvp_unavailable');
            if (!await this.isReady(now)) fail('play_source_not_ready',503);
            const binding = await this.binding(accountId);
            if (!binding) return fail('play_wallet_unassigned');
            const userId = String(binding.user_id);
            if (await this.balance('player:' + userId) < BigInt(row.stakeUnits)) fail('play_insufficient_balance');
            const event: PvpMoneyEvent = {version:1,action:'hold',matchId:row.matchId,gameId,stakeUnits:row.stakeUnits,
                participants:[{accountId,userId}],winnerId:null,reason:'hold',createdAt:now};
            const entries = applyPvpMoneyEvent(event,matches);
            await this.append(pvpEventId(event),'pvp',event,entries);
            return {wallet:await this.wallet(accountId,now),replayed:false};
        });
    }
    /** Only trusted backend adjudication calls this method; it is never a public player endpoint. */
    async pvpFinish(accountId: string, value: unknown, now = Date.now()) {
        const row = value as {matchId:string;winnerId:string|null;reason:string};
        if (!gameAccountId(accountId)||!row||Object.keys(row).sort().join(',')!=='matchId,reason,winnerId'||!gameAccountId(row.matchId)
            ||row.winnerId!==null&&!gameAccountId(row.winnerId)||!['win','draw','cancel','expired','server','disconnect','resign','timeout'].includes(row.reason)) return fail('invalid_pvp_request',400);
        return this.transaction(async()=>{
            const matches=await this.pvpMatch(row.matchId),match=matches.get(row.matchId);
            if(!match||!match.participants.some(owner=>owner.accountId===accountId)) return fail('pvp_unavailable');
            if(match.final){
                if(match.final.winnerId!==row.winnerId||match.final.reason!==row.reason)fail('play_idempotency_conflict');
                return {wallet:await this.wallet(accountId,now),replayed:true};
            }
            const event:PvpMoneyEvent={version:1,action:row.winnerId===null?'refund':'settle',matchId:row.matchId,gameId:match.gameId,
                stakeUnits:match.stakeUnits,participants:match.participants,winnerId:row.winnerId,reason:row.reason,createdAt:now};
            let entries:Entry[];try{entries=applyPvpMoneyEvent(event,matches);}catch{return fail('invalid_pvp_result',409);}
            await this.append(pvpEventId(event),'pvp',event,entries);
            return {wallet:await this.wallet(accountId,now),replayed:false};
        });
    }
    async adminReport(filters:unknown) {
        await this.ready;
        return queryFinanceReport(this.db,nileReportSql(!!this.pool,await this.db.hasTable('demo_ledger')),'nile',filters,async()=>{
            const state=await this.state(),house=await this.balance('house'),total=-(await this.balance('external'));
            const held=BigInt((await this.db.prepare("SELECT coalesce(sum(units::numeric),0)::text AS n FROM entries WHERE account LIKE 'pvp:%' OR account LIKE 'games-reserved:%'").get())!.n);
            return {players:(total-house-held).toString(),reserved:held.toString(),house:house.toString(),treasury:total.toString(),checkedAt:Number(state.reconciled_at)||null,
              note:await this.isReady()?'Тестовый USDT Nile. Суммы не являются реальными деньгами.':'Сверка Nile устарела или контур остановлен. Показан сохранённый журнал.'};
        },true,async ids=>{
            const owned=(await this.bindings()).filter(b=>ids.includes(b.account_id));
            return Object.fromEntries(await Promise.all(owned.map(async b=>{const w=await this.wallet(b.account_id);return[b.account_id,{available:w.state==='assigned'?w.balanceUnits:'0',reserved:w.state==='assigned'?w.reservedUnits??'0':'0'}];})));
        });
    }
    async adminAdjust(value:unknown,ids?:Set<string>) {
        const op=adjustmentRequest(value);requireFinanceAdmin(op.actorId,ids);
        return this.transaction(async()=>{
            const prior=await this.db.prepare('SELECT payload FROM events WHERE id=?').get('adjustment:'+op.id);
            if(prior){const row=JSON.parse(prior.payload) as Adjustment;sameAdjustment(row,op);return{adjustment:row,replayed:true};}
            if(!await this.isReady())fail('play_source_not_ready',503);
            const binding=await this.binding(op.playerId);if(!binding)fail('play_wallet_unassigned',404);
            const row:Adjustment={...op,userId:String(binding!.user_id),createdAt:Date.now()},delta=BigInt(op.deltaUnits);
            if(await this.balance('player:'+row.userId)+delta<0n||await this.balance('house')-delta<0n)fail('play_insufficient_balance');
            await this.append('adjustment:'+op.id,'adjustment',row,adjustmentEntries(row));
            return{adjustment:row,replayed:false};
        });
    }
    private async auditRows() {
        await this.db.integrityCheck();
        if ((await this.db.prepare('SELECT * FROM state WHERE id=1').get())!.config !== JSON.stringify(this.config)) fail('play_journal_corrupted', 503);
        const triggers = (await this.db.triggers()).sort();
        await sealNileDepositPool(this.db, this.pool, this.config.source.addresses, this.config.source.startHeight, true);
        const expected = ['sealed_state', 'protected_state', ...['events', 'entries', 'invites', 'bindings', ...(this.pool ? ['deposit_pool', 'auto_bindings'] : [])].flatMap(t => ['UPDATE', 'DELETE'].map(o => `immutable_${t}_${o}`))].sort();
        if (JSON.stringify(triggers) !== JSON.stringify(expected))
            fail('play_journal_corrupted', 503);
        const bindings = [...await this.db.prepare('SELECT * FROM bindings').all(), ...(this.pool ? await this.db.prepare('SELECT * FROM auto_bindings').all() : [])];
        if (new Set(bindings.map(b => b.account_id)).size !== bindings.length || new Set(bindings.map(b => b.user_id)).size !== bindings.length)
            fail('play_journal_corrupted', 503);
        const invalidInvite = await this.db.prepare(`SELECT 1 FROM invites WHERE hash !~ '^[a-f0-9]{64}$' OR NOT(user_id=ANY(?::text[])) OR user_id=?
            OR created_at NOT BETWEEN 1 AND 9007199254740991 OR expires_at NOT BETWEEN 1 AND 9007199254740991
            OR expires_at::numeric<>created_at::numeric+86400000 LIMIT 1`)
            .get(this.config.source.addresses.map(a => a.userId), this.config.houseUserId);
        if (invalidInvite) fail('play_journal_corrupted', 503);
        const invites = await this.db.prepare('SELECT i.* FROM invites i JOIN bindings b ON b.invite_hash=i.hash').all();
        for (const b of bindings) {
            if (b.invite_hash === undefined) {
                if (!gameAccountId(b.account_id) || !this.pool?.addresses.some(a => a.userId === b.user_id) || !Number.isSafeInteger(b.created_at) || Number(b.created_at) < 1 || !Number.isSafeInteger(b.source_height) || Number(b.source_height) < this.pool.startHeight - 1)
                    fail('play_journal_corrupted', 503);
                const earlier = await this.db.prepare("SELECT 1 FROM events WHERE kind='funding' AND (payload::jsonb->>'userId')=? AND ((payload::jsonb->>'height')::bigint)<=?").get(b.user_id, b.source_height);
                if (earlier)
                    fail('play_journal_corrupted', 503);
                continue;
            }
            const invite = invites.find(i => i.hash === b.invite_hash);
            if (!gameAccountId(b.account_id) || !invite || invite.user_id !== b.user_id || Number(b.created_at) < Number(invite.created_at) || Number(b.created_at) >= Number(invite.expires_at))
                fail('play_journal_corrupted', 503);
        }
        const balances = new Map<string, bigint>();
        const pvpMatches = new Map<string, PvpMoneyMatch>();
        let total = 0n, reserved = 0n, fundings = 0, rounds = 0, lines = 0, lastSeq = 0;
        while (true) {
            const page = lastSeq === 0 ? await this.db.prepare('SELECT * FROM events ORDER BY seq LIMIT 128').all()
                : await this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 128').all(lastSeq);
            if (page.length === 0) break;
            const saved = await this.db.prepare('SELECT seq,account,units FROM entries WHERE seq BETWEEN ? AND ? ORDER BY seq,line')
                .all(page[0].seq, page.at(-1)!.seq);
            const entriesBySeq = new Map<number, DatabaseRow[]>();
            for (const { seq, ...entry } of saved) {
                const entries = entriesBySeq.get(seq) ?? [];
                entries.push(entry);
                entriesBySeq.set(seq, entries);
            }
            for (const event of page) {
                if (Number(event.seq) !== ++lastSeq || event.sha256 !== playDigest(String(event.payload)))
                    fail('play_journal_corrupted', 503);
                const row = JSON.parse(String(event.payload));
                let entries: Entry[] = [];
                if (event.kind === 'funding') {
                    if (Object.keys(row).sort().join(',') !== 'amountUnits,height,logIndex,playerUnits,reserveUnits,txId,userId'
                        || !/^[a-f0-9]{64}$/.test(row.txId) || !Number.isSafeInteger(row.logIndex) || row.logIndex < 0
                        || !Number.isSafeInteger(row.height) || row.height < this.config.source.startHeight
                        || !this.addresses.some(a => a.userId === row.userId) || (this.pool?.addresses.some(a => a.userId === row.userId) && row.height < this.pool.startHeight) || !nileUnits(row.amountUnits) || BigInt(row.amountUnits) < 1n || BigInt(row.amountUnits) > 10n ** 30n
                        || !nileUnits(row.playerUnits) || !nileUnits(row.reserveUnits) || BigInt(row.playerUnits) + BigInt(row.reserveUnits) !== BigInt(row.amountUnits)
                        || BigInt(row.reserveUnits) !== this.allocate(row.userId, BigInt(row.amountUnits), reserved)
                        || event.id !== 'funding:' + row.txId + ':' + row.logIndex)
                        fail('play_journal_corrupted', 503);
                    if (row.userId === this.config.reserveUserId)
                        reserved += BigInt(row.reserveUnits);
                    total += BigInt(row.amountUnits);
                    fundings++;
                    entries = fundingEntries(row);
                }
                else if (event.kind === 'reserve') {
                    if (Object.keys(row).sort().join(',') !== 'createdAt,units,userId' || row.userId !== this.config.reserveUserId || !nileUnits(row.units) || BigInt(row.units) < 1n || BigInt(row.units) > 1000000000n
                        || !Number.isSafeInteger(row.createdAt) || row.createdAt < 1 || event.id !== 'reserve:' + row.userId || rounds !== 0
                        || bindings.some(b => b.user_id === row.userId && Number(b.created_at) < row.createdAt) || (balances.get('player:' + row.userId) ?? 0n) < BigInt(row.units))
                        fail('play_journal_corrupted', 503);
                    entries = reserveEntries(row);
                }
                else if (event.kind === 'pvp') {
                    if(event.id!==pvpEventId(row)||!row.participants?.every((owner:any)=>bindings.some(b=>b.account_id===owner.accountId&&b.user_id===owner.userId&&Number(b.created_at)<=row.createdAt))) fail('play_journal_corrupted',503);
                    try{entries=applyPvpMoneyEvent(row,pvpMatches);}catch{fail('play_journal_corrupted',503);}
                }
                else if(event.kind==='native'){
                    if(event.id!=='native:'+row.id||!bindings.some(b=>b.account_id===row.accountId&&b.user_id===row.userId&&Number(b.created_at)<=row.createdAt)
                        ||(balances.get('player:'+row.userId)??0n)!==BigInt(row.beforeUnits)||(balances.get('games-reserved:'+row.userId)??0n)!==BigInt(row.beforeReserveUnits))fail('play_journal_corrupted',503);
                    try{entries=nativeMoneyEntries(row);}catch{fail('play_journal_corrupted',503);}
                }
                else if(event.kind==='adjustment') {
                    const {createdAt,userId,...request}=row;
                    try{adjustmentRequest(request);}catch{fail('play_journal_corrupted',503);}
                    if(!Number.isSafeInteger(createdAt)||createdAt<1||event.id!=='adjustment:'+row.id
                      ||!bindings.some(b=>b.account_id===row.playerId&&b.user_id===userId&&Number(b.created_at)<=createdAt))fail('play_journal_corrupted',503);
                    entries=adjustmentEntries(row);
                }
                else {
                    const owned = row as StoredRound;
                    if (event.kind !== 'round' || Object.keys(row).sort().join(',') !== 'accountId,createdAt,id,multiplier,payoutUnits,stakeUnits,symbols,userId'
                        || !validNileRound(row) || !bindings.some(b => b.account_id === owned.accountId && b.user_id === owned.userId && Number(b.created_at) <= row.createdAt)
                        || event.id !== 'round:' + owned.accountId + ':' + row.id || (balances.get('player:' + owned.userId) ?? 0n) < BigInt(row.stakeUnits)
                        || (balances.get('house') ?? 0n) < BigInt(row.stakeUnits) * BigInt(COINS_MAX_MULTIPLIER - 1))
                        fail('play_journal_corrupted', 503);
                    rounds++;
                    entries = roundEntries(row);
                }
                const actual = entriesBySeq.get(event.seq) ?? [];
                if (JSON.stringify(actual) !== JSON.stringify(entries) || entries.reduce((s, e) => s + BigInt(e.units), 0n) !== 0n)
                    fail('play_journal_corrupted', 503);
                for (const entry of entries)
                    balances.set(entry.account, (balances.get(entry.account) ?? 0n) + BigInt(entry.units));
                for (const [account, balance] of balances)
                    if (account !== 'external' && balance < 0n)
                        fail('play_journal_corrupted', 503);
                lines += entries.length;
            }
        }
        const state = (await this.db.prepare('SELECT * FROM state WHERE id=1').get())!, held = [...balances].filter(([a]) => a !== 'external').reduce((s, [, v]) => s + v, 0n);
        if (held !== total || (balances.get('external') ?? 0n) !== -total || Number((await this.db.prepare('SELECT count(*) AS n FROM entries').get())!.n) !== lines
            || (state.source_credits !== null && (Number(state.source_credits) !== fundings || state.source_units !== total.toString())))
            fail('play_journal_corrupted', 503);
        return { ok: true, ...NILE_PLAY_SCOPE, schemaVersion: 1, ...(this.pool ? { poolSha256: depositPoolDigest(this.pool), poolCapacity: this.pool.addresses.length, autoBindings: bindings.filter(b => b.invite_hash === undefined).length } : {}), credits: fundings, rounds, bindings: bindings.length, totalUnits: total.toString(), houseUnits: (balances.get('house') ?? 0n).toString(),
            playerUnits: (held - (balances.get('house') ?? 0n)).toString(), sourceAt: state.source_at, sourceHeight: state.source_height, sourceHash: state.source_hash, halted: state.halted, lastError: state.last_error };

    }
    async close() { await this.ready.catch(() => {}); await this.db.close(); }
}
