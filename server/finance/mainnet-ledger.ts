import { PostgresDatabase, type DatabaseRow } from '../database';
import { ledgerTrigger, immutableLedgerTables } from './pg-ledger-schema';
import { migrateFinanceQueries } from './performance-migrations';
import { MAINNET_USDT_TOKEN, validateMainnetConfig, usdtFail, type MainnetConfig } from './mainnet-config';
import { nileHex } from './nile-address';
import { digest, type TronBlock, type TronTransfer } from './tron-protocol';
import { prepareGame, verifyGameRound } from '../games/core';
import { USDT_SCOPE, USDT_BETS, validUsdtRequest, type UsdtWallet, type UsdtRound, type UsdtDeposit } from '../../src/shared/usdtWallet';
import { gameAccountId } from '../../src/shared/nileWallet';
import { casinoActionKey, validCasinoAction, type CasinoAction } from '../../src/shared/casinoSessions';
import { publicSession, sessionReservation, type SessionState } from '../games/casinoSessions';
import { casinoStates, casinoReserved, makeCasinoEvent, verifyCasinoEvent, publicCasinoStates, type CasinoEvent } from './mainnet-casino';
import { adjustmentRequest, requireFinanceAdmin, sameAdjustment } from '../admin/validation';
import { queryFinanceReport, mainnetReportSql } from '../admin/report';
import type { FinanceAdjustment } from '../../src/shared/financeAdmin';
type Entry = {
    account: 'player' | 'house' | 'unallocated' | 'external';
    units: string;
};
type ChainEvent = UsdtDeposit & {
    from: string;
    to: string;
    direction: 'in' | 'out';
    owner: 'player' | 'house' | 'unallocated';
};
type StoredRound = UsdtRound & {
    accountId: string;
};
const exactUnits = (n: unknown): n is string => typeof n === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(n);
const eventEntries = (row: ChainEvent): Entry[] => {
    const amount = BigInt(row.amountUnits) * (row.direction === 'in' ? 1n : -1n);
    return [{ account: row.owner, units: amount.toString() }, { account: 'external', units: (-amount).toString() }];
};
const roundEntries = (row: StoredRound): Entry[] => {
    const amount = BigInt(row.payoutUnits) - BigInt(row.stakeUnits);
    return [{ account: 'player', units: amount.toString() }, { account: 'house', units: (-amount).toString() }];
};
export class MainnetLedger {
    readonly db: PostgresDatabase;
    readonly ready: Promise<void>;
    readonly config: MainnetConfig;
    private player: string;
    private service: string;
    constructor(file: string, config: MainnetConfig, private draw?: (max: number) => number, database?: PostgresDatabase) {
        this.config = validateMainnetConfig(config);
        this.player = nileHex(config.playerAddress);
        this.service = nileHex(config.serviceAddress);
        this.db = database ?? new PostgresDatabase(file);
        this.ready = this.initialize();
    }
    private async initialize() {
        await this.db.transaction(async () => {
            await this.db.exec(`CREATE TABLE IF NOT EXISTS state(id BIGINT PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, reconciled_at BIGINT NOT NULL DEFAULT 0, error TEXT, halted TEXT);
        CREATE TABLE IF NOT EXISTS blocks(height BIGINT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, parent TEXT NOT NULL, timestamp BIGINT NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(seq BIGINT PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('transfer','round')), payload TEXT NOT NULL, sha256 TEXT NOT NULL, previous TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entries(seq BIGINT NOT NULL REFERENCES events(seq), line BIGINT NOT NULL, account TEXT NOT NULL CHECK(account IN ('player','house','unallocated','external')), units TEXT NOT NULL, PRIMARY KEY(seq,line));`);
            // Preserve the original journal and add one versioned event kind for progressive games.
            await this.db.exec(`ALTER TABLE events DROP CONSTRAINT IF EXISTS events_kind_check;
              ALTER TABLE events ADD CONSTRAINT events_kind_check CHECK(kind IN ('transfer','round','casino','adjustment'));
              CREATE INDEX IF NOT EXISTS mainnet_casino_sessions ON events ((payload::jsonb->'session'->>'id'),seq DESC) WHERE kind='casino';`);
            await ledgerTrigger(this.db, 'state', 'sealed_config', 'UPDATE OF config', "RAISE EXCEPTION 'sealed mainnet config';");
            await ledgerTrigger(this.db, 'state', 'sealed_state', 'DELETE', "RAISE EXCEPTION 'sealed mainnet state';");
            await ledgerTrigger(this.db, 'state', 'sealed_halt', 'UPDATE OF halted', `
        IF OLD.halted IS NOT NULL AND NEW.halted IS DISTINCT FROM OLD.halted THEN RAISE EXCEPTION 'sealed mainnet halt'; END IF;`);
            await immutableLedgerTables(this.db, ['blocks', 'events', 'entries'], 'immutable mainnet ledger');
            await this.db.prepare('INSERT INTO state(id,config) VALUES(1,?) ON CONFLICT DO NOTHING').run(JSON.stringify(this.config));
        });
        await migrateFinanceQueries(this.db, 'mainnet');
        const state = await this.db.prepare('SELECT * FROM state WHERE id=1').get();
        if (!state || state.config !== JSON.stringify(this.config)) {
            await this.db.close();
            usdtFail('mainnet_ledger_corrupted', 503);
        }
        await this.db.transaction(() => this.auditRows(), { readOnly: true });
    }
    async state() { await this.ready; return (await this.db.prepare('SELECT * FROM state WHERE id=1').get())!; }
    async cursor() { await this.ready; const row = await this.db.prepare('SELECT height,hash FROM blocks ORDER BY height DESC LIMIT 1').get(); return row ? { height: Number(row.height), hash: String(row.hash) } : { height: this.config.anchorHeight, hash: this.config.anchorHash }; }
    async fail(code: string) { await this.ready; await this.db.prepare('UPDATE state SET error=?,reconciled_at=0 WHERE id=1').run(code); }
    async halt(code: string) { await this.ready; await this.db.prepare('UPDATE state SET halted=COALESCE(halted,?),error=?,reconciled_at=0 WHERE id=1').run(code, code); }
    private async transaction<T>(action: () => Promise<T>, write = true): Promise<T> {
        await this.ready;
        return this.db.transaction(action, { readOnly: !write });
    }
    private async append(id: string, kind: string, row: ChainEvent | StoredRound | CasinoEvent | FinanceAdjustment, entries: Entry[]) {
        await this.ready;
        const payload = JSON.stringify(row), previous = String((await this.db.prepare('SELECT sha256 FROM events ORDER BY seq DESC LIMIT 1').get())?.sha256 ?? digest(JSON.stringify(this.config)));
        const sha256 = digest(JSON.stringify({ id, kind, payload, previous }));
        const seq = (await this.db.prepare('INSERT INTO events(seq,id,kind,payload,sha256,previous) SELECT COALESCE(MAX(seq),0)+1,?,?,?,?,? FROM events RETURNING seq').run(id, kind, payload, sha256, previous)).lastInsertRowid;
        for (const [line, entry] of entries.entries()) await this.db.prepare('INSERT INTO entries VALUES(?,?,?,?)').run(seq, line, entry.account, entry.units);
    }
    async balances() {
        await this.ready;
        const balances = { player: 0n, house: BigInt(this.config.openingReserveUnits), unallocated: 0n, external: -BigInt(this.config.openingReserveUnits) };
        for (const row of await this.db.prepare('SELECT account,SUM(units::numeric)::text AS units FROM entries GROUP BY account').all())
            balances[row.account as keyof typeof balances] += BigInt(String(row.units));
        return balances;
    }
    private transfers(block: TronBlock): ChainEvent[] {
        const seen = new Set<string>();
        return block.transfers.flatMap((row: TronTransfer) => {
            const key = row.txId + ':' + row.logIndex;
            if (!/^[a-f0-9]{64}$/.test(row.txId) || !Number.isSafeInteger(row.logIndex) || row.logIndex < 0 || seen.has(key)
                || !/^41[a-f0-9]{40}$/.test(row.from) || !/^41[a-f0-9]{40}$/.test(row.to) || !exactUnits(row.amountUnits)
                || !block.txIds.includes(row.txId) || !block.outcomes.some(o => o.txId === row.txId && o.status === 'SUCCESS'))
                usdtFail('invalid_mainnet_transfer', 503);
            seen.add(key);
            if (row.contract !== MAINNET_USDT_TOKEN || row.amountUnits === '0' || row.from === row.to || (row.to !== this.service && row.from !== this.service))
                return [];
            const direction = row.to === this.service ? 'in' : 'out';
            const owner = direction === 'out' ? 'house' : row.from === this.player ? 'player' : 'unallocated';
            return [{ txId: row.txId, logIndex: row.logIndex, height: block.height, amountUnits: row.amountUnits, from: row.from, to: row.to, direction, owner }];
        });
    }
    async ingest(block: TronBlock) {
        await this.ready;
        if (!Number.isSafeInteger(block.height) || block.height <= this.config.anchorHeight || !/^[a-f0-9]{64}$/.test(block.hash)
            || BigInt('0x' + block.hash.slice(0, 16)) !== BigInt(block.height) || !/^[a-f0-9]{64}$/.test(block.parentHash)
            || !Number.isSafeInteger(block.timestamp) || block.timestamp < 1)
            usdtFail('invalid_mainnet_block', 503);
        const transfers = this.transfers(block), payload = JSON.stringify(transfers), sha256 = digest(payload);
        try { return await this.transaction(async () => {
        const previous = await this.db.prepare('SELECT * FROM blocks WHERE height=?').get(block.height);
        if (previous) {
            if (previous.hash !== block.hash || previous.parent !== block.parentHash || previous.timestamp !== block.timestamp || previous.sha256 !== sha256 || previous.payload !== payload) {
                await this.halt('mainnet_finalized_block_changed');
                usdtFail('mainnet_finalized_block_changed', 503);
            }
            return 0;
        }
            if ((await this.state()).halted)
                usdtFail('mainnet_halted', 503);
            const cursor = await this.cursor();
            if (block.height !== cursor.height + 1 || block.parentHash !== cursor.hash)
                usdtFail('mainnet_block_gap', 503);
            await this.db.prepare('UPDATE state SET reconciled_at=0 WHERE id=1').run();
            await this.db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?)').run(block.height, block.hash, block.parentHash, block.timestamp, payload, sha256);
            for (const transfer of transfers)
                await this.append('transfer:' + transfer.txId + ':' + transfer.logIndex, 'transfer', transfer, eventEntries(transfer));
            if ((await this.balances()).house < await casinoReserved(this.db,this.config.accountId))
                await this.halt('mainnet_reserve_deficit');
            return transfers.filter(t => t.owner === 'player').length;
        }); } catch (error) {
            if ((error as { code?: string }).code === 'mainnet_finalized_block_changed') await this.halt('mainnet_finalized_block_changed');
            throw error;
        }
    }
    async reconcile(height: number, balanceUnits: string, now = Date.now()) {
        await this.ready;
        const valid = await this.transaction(async () => {
            const balances = await this.audit();
            if (!exactUnits(balanceUnits) || height !== (await this.cursor()).height || BigInt(balanceUnits) !== balances.player + balances.house + balances.unallocated) {
                await this.fail('mainnet_reconciliation_mismatch'); return false;
            }
            await this.db.prepare('UPDATE state SET reconciled_at=?,error=NULL WHERE id=1').run(now);
            return true;
        });
        if (!valid) usdtFail('mainnet_reconciliation_mismatch', 503);
    }
    async isReady(now = Date.now()) { await this.ready; const state = await this.state(); return !state.halted && !state.error && Number(state.reconciled_at) > 0 && Number(state.reconciled_at) <= now && now - Number(state.reconciled_at) < 60000; }
    async wallet(accountId: string, now = Date.now()): Promise<UsdtWallet> {
        await this.ready;
        return this.db.transaction(async () => {
        if (!gameAccountId(accountId))
            usdtFail('invalid_usdt_account', 400);
        if (accountId !== this.config.accountId)
            return { ...USDT_SCOPE, state: 'unassigned' };
        const balances = await this.balances(), deposits: UsdtDeposit[] = [], rounds: UsdtRound[] = [];
        for (const event of await this.db.prepare("SELECT payload FROM events WHERE kind='transfer' AND (payload::jsonb->>'owner')='player' ORDER BY seq DESC LIMIT 50").all()) {
            const { txId, logIndex, height, amountUnits } = JSON.parse(String(event.payload));
            deposits.push({ txId, logIndex, height, amountUnits });
        }
        for (const event of await this.db.prepare("SELECT payload FROM events WHERE kind='round' ORDER BY seq DESC LIMIT 50").all()) {
            const { accountId: _id, ...round } = JSON.parse(String(event.payload));
            rounds.push(round);
        }
        const casino=await casinoStates(this.db,accountId),reserved=casino.reduce((n,s)=>n+sessionReservation(s),0n);
        const casinoRounds=casino.filter(s=>s.state!=='active').slice(0,50).map(publicSession);
        const max = (multiplier: bigint) => [...USDT_BETS].reverse().find(bet => balances.house-reserved >= BigInt(bet) * (multiplier - 1n)) ?? '0';
        return { ...USDT_SCOPE, state: 'assigned', address: this.config.serviceAddress, senderAddress: this.config.playerAddress,
            balanceUnits: balances.player.toString(), updatedAt: Number((await this.state()).reconciled_at), ready: await this.isReady(now),
            maxStakeUnits: { 'royal-coins': max(12n), 'royal-roulette': max(36n) }, deposits, rounds, ...(casinoRounds.length?{casinoRounds}:{}) };
        }, { readOnly: true });
    }
    async play(accountId: string, request: unknown, now = Date.now()) {
        await this.ready;
        if (accountId !== this.config.accountId || !validUsdtRequest(request))
            usdtFail('invalid_usdt_request', 400);
        return await this.transaction(async () => {
            if(await this.db.prepare('SELECT 1 FROM events WHERE id=?').get('casino:'+accountId+':'+request.id))usdtFail('usdt_idempotency_conflict',409);
            const key = 'round:' + accountId + ':' + request.id, previous = await this.db.prepare('SELECT payload FROM events WHERE id=?').get(key);
            if (previous) {
                const { accountId: _id, ...round } = JSON.parse(String(previous.payload)) as StoredRound;
                if (round.stakeUnits !== request.stakeUnits || round.gameId !== request.gameId || JSON.stringify(round.input) !== JSON.stringify(request.input))
                    usdtFail('usdt_idempotency_conflict', 409);
                return { wallet: await this.wallet(accountId, now), round, replayed: true };
            }
            if (!await this.isReady(now))
                usdtFail('usdt_not_ready', 503);
            const engine = prepareGame(request.gameId, 1, request.input), balances = await this.balances(), stake = BigInt(request.stakeUnits);
            if (balances.player < stake)
                usdtFail('usdt_insufficient_balance', 409);
            if (balances.house - await casinoReserved(this.db,accountId) < stake * BigInt(engine.maxMultiplier - 1))
                usdtFail('usdt_reserve_insufficient', 409);
            const n = (await this.db.prepare("SELECT count(*) AS n FROM events WHERE kind='round' AND ((payload::jsonb->>'createdAt')::bigint)>?").get(now - 60000))!;
            if (Number(n.n) >= 60)
                usdtFail('usdt_rate_limit', 429);
            const gameRound = engine.play(stake, this.draw);
            if (gameRound.gameId === 'royal-fruits' || gameRound.gameId !== request.gameId)
                usdtFail('invalid_usdt_request', 500);
            const round: UsdtRound = { ...gameRound, id: request.id, createdAt: now };
            const stored = { ...round, accountId };
            await this.append(key, 'round', stored, roundEntries(stored));
            return { wallet: await this.wallet(accountId, now), round, replayed: false };
        });
    }
    async casinoWallet(accountId:string,now=Date.now()) {
        await this.ready;
        return this.db.transaction(async()=>({wallet:await this.wallet(accountId,now),sessions:accountId===this.config.accountId?publicCasinoStates(await casinoStates(this.db,accountId)):[]}),{readOnly:true});
    }
    async casinoPlay(accountId:string,value:unknown,now=Date.now()) {
        await this.ready;
        if(accountId!==this.config.accountId||!validCasinoAction(value))usdtFail('invalid_usdt_request',400);
        const op=structuredClone(value) as CasinoAction;
        if(op.action==='start'&&!(USDT_BETS as readonly string[]).includes(op.stakeUnits))usdtFail('invalid_usdt_request',400);
        return this.transaction(async()=>{
            const key='casino:'+accountId+':'+op.id,previous=await this.db.prepare('SELECT payload FROM events WHERE id=?').get(key);
            const states=await casinoStates(this.db,accountId);
            if(previous){const saved=JSON.parse(previous.payload) as CasinoEvent;if(casinoActionKey(saved.request)!==casinoActionKey(op))usdtFail('usdt_idempotency_conflict',409);
                const state=states.find(s=>s.id===saved.session.id)!;
                return {...await this.casinoWallet(accountId,now),session:publicSession(state),replayed:true};}
            if(await this.db.prepare('SELECT 1 FROM events WHERE id=?').get('round:'+accountId+':'+op.id))usdtFail('usdt_idempotency_conflict',409);
            if(!await this.isReady(now))usdtFail('usdt_not_ready',503);
            if(Number((await this.db.prepare("SELECT count(*) AS n FROM events WHERE kind IN ('casino','round') AND ((payload::jsonb->>'createdAt')::bigint)>?").get(now-60000))!.n)>=120)usdtFail('usdt_rate_limit',429);
            const balances=await this.balances(),before=op.action==='start'?undefined:states.find(s=>s.id===op.sessionId&&s.gameId===op.gameId);
            if(op.action==='start'){
                if(states.some(s=>s.gameId===op.gameId&&s.state==='active'))usdtFail('usdt_session_active',409);
                const stake=BigInt(op.stakeUnits),probe={gameId:op.gameId,settings:op.settings,state:'active',stakeUnits:op.stakeUnits} as SessionState;
                if(balances.player<stake)usdtFail('usdt_insufficient_balance',409);
                if(balances.house+stake-await casinoReserved(this.db,accountId)<sessionReservation(probe))usdtFail('usdt_reserve_insufficient',409);
            }else if(!before)usdtFail('usdt_session_missing',409);
            let event:CasinoEvent;try{event=makeCasinoEvent(accountId,op,before,now,this.draw);}catch{usdtFail('invalid_usdt_action',409);}
            const delta=BigInt(event!.deltaUnits);
            await this.append(key,'casino',event!,[{account:'player',units:delta.toString()},{account:'house',units:(-delta).toString()}]);
            return {...await this.casinoWallet(accountId,now),session:publicSession(event!.session),replayed:false};
        });
    }
    async audit() {
        await this.ready;
        return this.db.transaction(() => this.auditRows(), { readOnly: true });
    }
    async adminReport(filters:unknown) {
        await this.ready;
        return queryFinanceReport(this.db,mainnetReportSql,'mainnet',filters,async()=>{
            const b=await this.balances(),state=await this.state(),reserved=await casinoReserved(this.db,this.config.accountId);
            return{players:b.player.toString(),reserved:reserved.toString(),house:(b.house-reserved).toString(),treasury:(-b.external).toString(),checkedAt:Number(state.reconciled_at)||null,
              note:await this.isReady()?'Прямой USDT. Резерв включает только свободное покрытие; нераспределённые поступления: '+b.unallocated+' микро-USDT.':'Сверка прямого USDT устарела или контур остановлен.'};
        },true,async ids=>ids.includes(this.config.accountId)?{[this.config.accountId]:{available:(await this.balances()).player.toString(),reserved:'0'}}:{});
    }
    async adminAdjust(value:unknown,ids?:Set<string>) {
        const op=adjustmentRequest(value);requireFinanceAdmin(op.actorId,ids);
        if(op.playerId!==this.config.accountId)usdtFail('invalid_usdt_request',400);
        return this.transaction(async()=>{
            const prior=await this.db.prepare('SELECT payload FROM events WHERE id=?').get('adjustment:'+op.id);
            if(prior){const row=JSON.parse(prior.payload) as FinanceAdjustment;sameAdjustment(row,op);return{adjustment:row,replayed:true};}
            if(!await this.isReady())usdtFail('usdt_not_ready',503);
            const balances=await this.balances(),delta=BigInt(op.deltaUnits);
            if(balances.player+delta<0n||balances.house-delta<await casinoReserved(this.db,this.config.accountId))usdtFail('usdt_reserve_insufficient',409);
            const row:FinanceAdjustment={...op,createdAt:Date.now()};
            await this.append('adjustment:'+op.id,'adjustment',row,[{account:'player',units:op.deltaUnits},{account:'house',units:(-delta).toString()}]);
            return{adjustment:row,replayed:false};
        });
    }
    private async auditRows() {
        await this.db.integrityCheck();
        const state = (await this.db.prepare('SELECT * FROM state WHERE id=1').get())!;
        if (state.config !== JSON.stringify(this.config)) usdtFail('mainnet_ledger_corrupted', 503);
        const triggers = (await this.db.triggers()).sort();
        const expected = ['sealed_config', 'sealed_halt', 'sealed_state', ...['blocks', 'events', 'entries'].flatMap(t => ['UPDATE', 'DELETE'].map(op => `immutable_${t}_${op}`))].sort();
        if (JSON.stringify(triggers) !== JSON.stringify(expected))
            usdtFail('mainnet_ledger_corrupted', 503);
        let height = this.config.anchorHeight, hash = this.config.anchorHash, transferCount = 0;
        let after: number | undefined;
        while (true) {
            const page = after === undefined ? await this.db.prepare('SELECT * FROM blocks ORDER BY height LIMIT 128').all()
                : await this.db.prepare('SELECT * FROM blocks WHERE height>? ORDER BY height LIMIT 128').all(after);
            if (page.length === 0) break;
            const expectedTransfers = new Map<string, string>();
            for (const block of page) {
                if (block.height !== ++height || block.parent !== hash || block.sha256 !== digest(String(block.payload)))
                    usdtFail('mainnet_ledger_corrupted', 503);
                hash = String(block.hash);
                for (const row of JSON.parse(String(block.payload)) as ChainEvent[]) {
                    const id = 'transfer:' + row.txId + ':' + row.logIndex;
                    if (expectedTransfers.has(id) || row.height !== height || !exactUnits(row.amountUnits) || BigInt(row.amountUnits) < 1n
                        || !/^[a-f0-9]{64}$/.test(row.txId) || !Number.isSafeInteger(row.logIndex) || row.logIndex < 0
                        || (row.direction === 'in' ? row.to !== this.service || row.from === this.service || row.owner !== (row.from === this.player ? 'player' : 'unallocated')
                            : row.direction !== 'out' || row.from !== this.service || row.to === this.service || row.owner !== 'house'))
                        usdtFail('mainnet_ledger_corrupted', 503);
                    expectedTransfers.set(id, JSON.stringify(row));
                }
            }
            const saved = expectedTransfers.size ? await this.db.prepare('SELECT id,kind,payload FROM events WHERE id=ANY(?::text[])')
                .all([...expectedTransfers.keys()]) : [];
            if (saved.length !== expectedTransfers.size || saved.some(row => row.kind !== 'transfer' || expectedTransfers.get(row.id) !== row.payload))
                usdtFail('mainnet_ledger_corrupted', 503);
            transferCount += expectedTransfers.size;
            after = height;
        }
        const balances = { player: 0n, house: BigInt(this.config.openingReserveUnits), unallocated: 0n, external: -BigInt(this.config.openingReserveUnits) };
        let previous = digest(JSON.stringify(this.config)), seq = 0, lines = 0, savedTransfers = 0;
        const sessions=new Map<string,SessionState>();
        while (true) {
            const page = seq === 0 ? await this.db.prepare('SELECT * FROM events ORDER BY seq LIMIT 128').all()
                : await this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 128').all(seq);
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
                const id = String(event.id), kind = String(event.kind), payload = String(event.payload), row = JSON.parse(payload);
                if (event.seq !== ++seq || event.previous !== previous || event.sha256 !== digest(JSON.stringify({ id, kind, payload, previous })))
                    usdtFail('mainnet_ledger_corrupted', 503);
                previous = String(event.sha256);
                let entries: Entry[];
                if (kind === 'transfer') {
                    savedTransfers++;
                    entries = eventEntries(row);
                }
                else if(kind==='adjustment'){
                    const{createdAt,...request}=row;try{adjustmentRequest(request);}catch{usdtFail('mainnet_ledger_corrupted',503);}
                    if(id!=='adjustment:'+row.id||row.playerId!==this.config.accountId||!Number.isSafeInteger(createdAt)||createdAt<1)usdtFail('mainnet_ledger_corrupted',503);
                    entries=[{account:'player',units:row.deltaUnits},{account:'house',units:(-BigInt(row.deltaUnits)).toString()}];
                }
                else if(kind==='casino'){
                    if(id!=='casino:'+this.config.accountId+':'+row.id||!verifyCasinoEvent(row,this.config.accountId,sessions))usdtFail('mainnet_ledger_corrupted',503);
                    const delta=BigInt(row.deltaUnits);
                    if(row.request.action==='start'&&(balances.player<BigInt(row.session.stakeUnits)
                      ||balances.house+BigInt(row.session.stakeUnits)-[...sessions.values()].reduce((n,s)=>n+sessionReservation(s),0n)<BigInt(row.reserveUnits)))usdtFail('mainnet_ledger_corrupted',503);
                    sessions.set(row.session.id,row.session);
                    entries=[{account:'player',units:delta.toString()},{account:'house',units:(-delta).toString()}];
                }else {
                    const { id: roundId, createdAt, accountId, ...round } = row;
                    if (kind !== 'round' || accountId !== this.config.accountId || !validUsdtRequest({ id: roundId, gameId: round.gameId, input: round.input, stakeUnits: round.stakeUnits })
                        || !Number.isSafeInteger(createdAt) || createdAt < 1 || id !== 'round:' + accountId + ':' + roundId || !verifyGameRound(round)
                        || balances.player < BigInt(row.stakeUnits) || balances.house-[...sessions.values()].reduce((n,s)=>n+sessionReservation(s),0n) < BigInt(row.stakeUnits) * BigInt(prepareGame(round.gameId, 1, round.input).maxMultiplier - 1))
                        usdtFail('mainnet_ledger_corrupted', 503);
                    entries = roundEntries(row);
                }
                const actual = entriesBySeq.get(event.seq) ?? [];
                if (JSON.stringify(actual) !== JSON.stringify(entries))
                    usdtFail('mainnet_ledger_corrupted', 503);
                for (const entry of entries)
                    balances[entry.account] += BigInt(entry.units);
                if (balances.player < 0n || balances.unallocated < 0n || (balances.house < [...sessions.values()].reduce((n,s)=>n+sessionReservation(s),0n) && !state.halted))
                    usdtFail('mainnet_ledger_corrupted', 503);
                lines += entries.length;
            }
        }
        if (savedTransfers !== transferCount || Number((await this.db.prepare('SELECT count(*) AS n FROM entries').get())!.n) !== lines
            || Object.values(balances).reduce((a, b) => a + b, 0n) !== 0n)
            usdtFail('mainnet_ledger_corrupted', 503);
        return balances;

    }
    async close() { await this.ready.catch(() => {}); await this.db.close(); }
}
