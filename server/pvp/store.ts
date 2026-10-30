import { randomUUID } from 'node:crypto';
import { gameAccountId } from '../../src/shared/nileWallet';
import { PVP_ARRIVAL_MS, PVP_INVITE_MS, PVP_MOVE_MS, PVP_RECONNECT_MS, isPvpCardGame, pvpPayout, validPvpRequest,
  isPvpSnapshotGame, type PvpChallenge, type PvpRequest, type PvpSnapshot } from '../../src/shared/pvp';
import { createCardGame, playCardMove, publicCardGame, type CardState } from './cards';
import { createTsuEFa, playTsuEFa, publicTsuEFa, type TsuEFaState } from './tsu-e-fa';
import type { NilePlayLedger } from '../finance/nile-play-ledger';
import {NilePlayError} from '../finance/nile-play-error';

export type PvpLedger = Pick<NilePlayLedger,'ready'|'db'> & {
  wallet(accountId:string,now?:number):Promise<PvpSnapshot['wallet']>;
  pvpHold(accountId:string,value:unknown,now?:number):Promise<unknown>;
  pvpFinish(accountId:string,value:unknown,now?:number):Promise<unknown>;
};

export type PvpPresence = { accountId: string; name: string; connected: boolean; available: boolean };
type Actor = { accountId: string; name: string; roomId: string };
type StoredMatch = { challenge: PvpChallenge; cards: CardState | null; tsuEFa?: TsuEFaState; roomId: string; lastMoveAt: number; roomSeenAt: number };
const participant = (c: PvpChallenge, id: string) => c.creatorId === id || c.opponentId === id;
const members = (c: PvpChallenge) => [c.creatorId, ...(c.opponentId ? [c.opponentId] : [])];
const live = (c: PvpChallenge) => ['open', 'arriving', 'playing'].includes(c.status);
const fail = (message: string, status = 409): never => { throw new NilePlayError(message, status); };
const cleanName = (name: string) => name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);
const stable = (value: unknown): string => value !== null && typeof value === 'object'
  ? Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}'
  : JSON.stringify(value);
const roomValid = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export class PvpStore {
  readonly ready: Promise<void>;
  private rooms = new Map<string, { people: PvpPresence[]; at: number }>();
  constructor(private ledger: PvpLedger) {
    this.ready = ledger.ready.then(() => ledger.db.transaction(async () => ledger.db.exec(`
      CREATE TABLE IF NOT EXISTS pvp_matches(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,creator_id TEXT NOT NULL,
        opponent_id TEXT,status TEXT NOT NULL,payload TEXT NOT NULL,updated_at BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS pvp_room_live ON pvp_matches(room_id,status,updated_at DESC);
      CREATE TABLE IF NOT EXISTS pvp_requests(account_id TEXT NOT NULL,id TEXT NOT NULL,request_key TEXT NOT NULL,
        match_id TEXT NOT NULL REFERENCES pvp_matches(id),created_at BIGINT NOT NULL,PRIMARY KEY(account_id,id));`)));
  }
  private async saved(id: string): Promise<StoredMatch> {
    const row = await this.ledger.db.prepare('SELECT payload FROM pvp_matches WHERE id=?').get(id);
    if (!row) return fail('Поединок не найден.', 404);
    return JSON.parse(String(row.payload));
  }
  private async save(s: StoredMatch, now: number) {
    const c = s.challenge;
    await this.ledger.db.prepare(`INSERT INTO pvp_matches(id,room_id,creator_id,opponent_id,status,payload,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET opponent_id=excluded.opponent_id,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(c.id, s.roomId, c.creatorId, c.opponentId, c.status, JSON.stringify(s), now);
  }
  private async current(id: string) {
    return !!await this.ledger.db.prepare("SELECT 1 FROM pvp_matches WHERE (creator_id=? OR opponent_id=?) AND status IN ('open','arriving','playing') LIMIT 1").get(id, id);
  }
  private async finish(s: StoredMatch, winnerId: string | null, reason: string, now: number) {
    await this.ledger.pvpFinish(s.challenge.creatorId, { matchId: s.challenge.id, winnerId, reason }, now);
    const c = s.challenge;
    c.status = winnerId || reason === 'draw' ? 'finished' : 'cancelled'; c.winnerId = winnerId; c.reason = reason;
    c.expiresAt = now; c.revision++; c.disconnected = [];
    await this.save(s, now);
  }
  private async expire(s: StoredMatch, now: number) {
    const c = s.challenge;
    if (!live(c)) return;
    if (c.status === 'open' && now >= c.expiresAt || c.status === 'arriving' && now >= c.expiresAt) return this.finish(s, null, 'expired', now);
    if (c.status === 'playing' && now - s.roomSeenAt > 15_000) return this.finish(s, null, 'server', now);
    if (now - s.roomSeenAt > 15_000) for (const id of members(c)) if (!c.disconnected.some(row => row.accountId === id)) c.disconnected.push({ accountId: id, until: s.roomSeenAt + 15_000 + PVP_RECONNECT_MS });
    const expired = c.disconnected.filter(row => now >= row.until);
    if (expired.length) {
      const winner = c.status === 'playing' && c.disconnected.length === 1 ? members(c).find(id => id !== expired[0].accountId) ?? null : null;
      return this.finish(s, winner, winner ? 'disconnect' : 'server', now);
    }
    if (c.status === 'playing' && s.cards?.phase === 'playing' && now - s.lastMoveAt >= PVP_MOVE_MS) {
      return this.finish(s, members(c)[1 - s.cards.actor], 'timeout', now);
    }
    if (c.status === 'playing' && s.tsuEFa?.phase === 'playing' && now >= c.expiresAt) {
      const [a, b] = s.tsuEFa.choices;
      return this.finish(s, a !== null && b === null ? c.creatorId : b !== null && a === null ? c.opponentId : null,
        a === null && b === null ? 'draw' : 'timeout', now);
    }
  }
  async sweep(now = Date.now()) {
    await this.ready;
    await this.ledger.db.transaction(async () => {
      for (const row of await this.ledger.db.prepare("SELECT payload FROM pvp_matches WHERE status IN ('open','arriving','playing')").all()) await this.expire(JSON.parse(String(row.payload)), now);
    });
  }
  async syncRoom(roomId: string, people: PvpPresence[], now = Date.now()) {
    if (!roomValid(roomId) || !Array.isArray(people) || people.length > 100 || !people.every(p => gameAccountId(p.accountId)
      && typeof p.name === 'string' && typeof p.connected === 'boolean' && typeof p.available === 'boolean')
      || new Set(people.map(p => p.accountId)).size !== people.length) return fail('Некорректный состав комнаты.', 400);
    await this.ready;
    this.rooms.set(roomId, { people: people.map(p => ({ ...p, name: cleanName(p.name) })), at: now });
    return this.ledger.db.transaction(async () => {
      for (const row of await this.ledger.db.prepare("SELECT payload FROM pvp_matches WHERE room_id=? AND status IN ('open','arriving','playing')").all(roomId)) {
        const s: StoredMatch = JSON.parse(String(row.payload)), c = s.challenge;
        // Expire an old lease before refreshing it, so a server restart cannot restart a lost physics game.
        await this.expire(s, now); if (!live(c)) continue;
        s.roomSeenAt = now;
        const priorPresence=JSON.stringify([c.ready,c.disconnected]);
        for (const id of members(c)) {
          const online = people.some(person => person.accountId === id && person.connected), index = c.disconnected.findIndex(p => p.accountId === id);
          if (online && index >= 0) c.disconnected.splice(index, 1);
          if (!online && index < 0) c.disconnected.push({ accountId: id, until: now + PVP_RECONNECT_MS });
          if(!online&&c.status==='arriving')c.ready=c.ready.filter(ready=>ready!==id);
        }
        if(JSON.stringify([c.ready,c.disconnected])!==priorPresence)c.revision++;
        await this.expire(s, now); if (live(c)) await this.save(s, now);
      }
      return Promise.all(people.filter(p => p.connected).map(async p => ({ accountId: p.accountId, snapshot: await this.snapshot({ accountId: p.accountId, name: p.name, roomId }, now) })));
    });
  }
  async command(actor: Actor, value: unknown, now = Date.now()): Promise<PvpSnapshot> {
    if (!gameAccountId(actor.accountId) || !roomValid(actor.roomId) || typeof actor.name !== 'string' || !validPvpRequest(value)) return fail('Некорректный запрос поединка.', 400);
    await this.ready;
    return this.ledger.db.transaction(async () => {
      const op: PvpRequest = value, key = stable(op);
      const previous = await this.ledger.db.prepare('SELECT * FROM pvp_requests WHERE account_id=? AND id=?').get(actor.accountId, op.id);
      if (previous) {
        if (previous.request_key !== key) return fail('Нельзя изменить отправленное действие.');
        return { ...await this.snapshot(actor, now), requestId: op.id };
      }
      const rate = await this.ledger.db.prepare('SELECT count(*) AS n FROM pvp_requests WHERE account_id=? AND created_at>?').get(actor.accountId, now - 60_000);
      if (Number(rate!.n) >= 120) return fail('Слишком много действий. Подожди немного.', 429);
      let s: StoredMatch;
      if (op.action === 'create') {
        if (await this.current(actor.accountId)) return fail('Сначала заверши текущий вызов или поединок.');
        if (op.targetId === actor.accountId) return fail('Нельзя вызвать самого себя.');
        const room = this.rooms.get(actor.roomId);
        if (!room || now - room.at > 10_000 || !room.people.some(p => p.accountId === actor.accountId && p.connected && p.available)) return fail('Сначала вернись в зал и заверши текущую игру.');
        if (op.targetId && !room.people.some(p => p.accountId === op.targetId && p.connected && p.available)) return fail('Соперник сейчас недоступен.');
        const challenge: PvpChallenge = { id: randomUUID(), gameId: op.gameId, creatorId: actor.accountId, creatorName: cleanName(actor.name),
          targetId: op.targetId, opponentId: null, opponentName: '', stakeUnits: op.stakeUnits, ...pvpPayout(op.stakeUnits),
          status: 'open', createdAt: now, expiresAt: now + PVP_INVITE_MS, ready: [], winnerId: null, reason: '', revision: 0, disconnected: [] };
        s = { challenge, cards: null, roomId: actor.roomId, lastMoveAt: now, roomSeenAt: now };
        await this.ledger.pvpHold(actor.accountId, { matchId: challenge.id, gameId: op.gameId, stakeUnits: op.stakeUnits }, now);
      } else {
        s = await this.saved(op.challengeId); const c = s.challenge;
        if (s.roomId !== actor.roomId || !participant(c, actor.accountId) && c.targetId !== actor.accountId && !(op.action === 'accept' && c.targetId === null)) return fail('Этот вызов недоступен.');
        await this.expire(s, now); if (!live(c)) return { ...await this.snapshot(actor, now), requestId: op.id };
        if (op.action === 'accept') {
          if (c.status !== 'open' || c.creatorId === actor.accountId || c.targetId && c.targetId !== actor.accountId || await this.current(actor.accountId)) return fail('Этот вызов уже занят или недоступен.');
          const busy = await this.ledger.db.prepare("SELECT 1 FROM pvp_matches WHERE room_id=? AND status IN ('arriving','playing') AND (payload::jsonb->'challenge'->>'gameId')=? LIMIT 1").get(actor.roomId, c.gameId);
          if (busy) return fail('Этот стол уже зарезервирован. Выбери другой вызов.');
          if (!this.rooms.get(actor.roomId)?.people.some(p => p.accountId === actor.accountId && p.connected && p.available)) return fail('Сначала заверши текущую игру.');
          if (!this.rooms.get(actor.roomId)?.people.some(p => p.accountId === c.creatorId && p.connected && p.available)) return fail('Автор вызова сейчас недоступен.');
          await this.ledger.pvpHold(actor.accountId, { matchId: c.id, gameId: c.gameId, stakeUnits: c.stakeUnits }, now);
          c.opponentId = actor.accountId; c.opponentName = cleanName(actor.name); c.status = 'arriving'; c.expiresAt = now + PVP_ARRIVAL_MS;
        } else if (op.action === 'cancel') {
          if (c.status === 'playing' || !participant(c, actor.accountId) && c.targetId !== actor.accountId) return fail('Партию можно завершить только сдачей.');
          await this.finish(s, null, 'cancel', now);
        } else if (op.action === 'ready') {
          if (c.status !== 'arriving' || !participant(c, actor.accountId)) return fail('Подтверждение сейчас недоступно.');
          if (!c.ready.includes(actor.accountId)) c.ready.push(actor.accountId);
          if (c.ready.length === 2) {
            c.status = 'playing'; c.expiresAt = now + PVP_MOVE_MS; s.lastMoveAt = now;
            if (isPvpCardGame(c.gameId)) s.cards = createCardGame(c.gameId);
            if (c.gameId === 'tsu-e-fa') s.tsuEFa = createTsuEFa();
          }
        } else if (op.action === 'resign') {
          if (c.status !== 'playing' || !participant(c, actor.accountId)) return fail('Партия ещё не началась.');
          await this.finish(s, members(c).find(id => id !== actor.accountId)!, 'resign', now);
        } else if (op.action === 'move') {
          if (c.status !== 'playing' || !participant(c, actor.accountId)) return fail('Состояние партии изменилось. Обнови стол.');
          const side = c.creatorId === actor.accountId ? 0 : 1;
          if (c.gameId === 'tsu-e-fa' && s.tsuEFa) {
            const round = s.tsuEFa.round;
            // Choices share a round token: the first player's revision must not reject a simultaneous second choice.
            try { s.tsuEFa = playTsuEFa(s.tsuEFa, side, op.move); } catch { return fail('Этот выбор недоступен.'); }
            if (s.tsuEFa.round !== round) { s.lastMoveAt = now; c.expiresAt = now + PVP_MOVE_MS; }
            if (s.tsuEFa.phase === 'finished') await this.finish(s, members(c)[s.tsuEFa.winner!], 'win', now);
          } else {
            if (!s.cards || op.revision !== s.cards.revision || op.move.kind === 'choose') return fail('Состояние партии изменилось. Обнови стол.');
            try { s.cards = playCardMove(s.cards, side, op.move); } catch { return fail('Этот ход недоступен.'); }
            s.lastMoveAt = now; c.expiresAt = now + PVP_MOVE_MS;
            if (s.cards.phase === 'finished') await this.finish(s, s.cards.winner === null ? null : members(c)[s.cards.winner], s.cards.winner === null ? 'draw' : 'win', now);
          }
        }
        c.revision++;
      }
      await this.save(s, now);
      await this.ledger.db.prepare('INSERT INTO pvp_requests(account_id,id,request_key,match_id,created_at) VALUES(?,?,?,?,?)').run(actor.accountId, op.id, key, s.challenge.id, now);
      return { ...await this.snapshot(actor, now), requestId: op.id };
    });
  }
  async adjudicate(roomId: string, matchId: string, winnerId: string | null, reason: 'win' | 'draw' | 'server', now = Date.now()) {
    await this.ready;
    return this.ledger.db.transaction(async () => {
      const s = await this.saved(matchId);
      if (s.roomId !== roomId || isPvpSnapshotGame(s.challenge.gameId)) return fail('Неверный игровой стол.');
      if (s.challenge.status === 'playing') await this.finish(s, winnerId, reason, now);
    });
  }
  async roomMatches(roomId: string) {
    await this.ready;
    return (await this.ledger.db.prepare("SELECT payload FROM pvp_matches WHERE room_id=? AND status IN ('open','arriving','playing')").all(roomId)).map(row => (JSON.parse(String(row.payload)) as StoredMatch).challenge);
  }
  async snapshot(actor: Actor, now = Date.now()): Promise<PvpSnapshot> {
    await this.ready;
    const all = (await this.ledger.db.prepare(`SELECT payload FROM pvp_matches WHERE room_id=? AND
      (status IN ('open','arriving','playing') OR creator_id=? OR opponent_id=?) ORDER BY updated_at DESC LIMIT 100`).all(actor.roomId, actor.accountId, actor.accountId))
      .map(row => JSON.parse(String(row.payload)) as StoredMatch);
    const available = all.filter(s => participant(s.challenge, actor.accountId) || s.challenge.status === 'open' && (!s.challenge.targetId || s.challenge.targetId === actor.accountId));
    const own = available.find(s => participant(s.challenge, actor.accountId) && live(s.challenge)) ?? available.find(s => participant(s.challenge, actor.accountId));
    const cards=own?.cards?publicCardGame(own.cards,own.challenge.creatorId===actor.accountId?0:1):null;
    if(cards&&own?.challenge.status!=='playing'){cards.phase='finished';cards.moves=[];}
    const tsuEFa = own?.tsuEFa ? publicTsuEFa(own.tsuEFa, own.challenge.creatorId === actor.accountId ? 0 : 1) : null;
    if (tsuEFa && own?.challenge.status !== 'playing') { tsuEFa.phase = 'finished'; tsuEFa.winner = own?.challenge.winnerId === null ? null : own?.challenge.winnerId === own?.challenge.creatorId ? 0 : 1; }
    return { challenges: available.map(s => s.challenge), active: own?.challenge ?? null,
      cards, tsuEFa,
      people: (this.rooms.get(actor.roomId)?.people ?? []).filter(p => p.connected && p.accountId !== actor.accountId)
        .map(p => ({ accountId: p.accountId, name: p.name, available: p.available && !all.some(s => participant(s.challenge, p.accountId) && live(s.challenge)) })),
      wallet: await this.ledger.wallet(actor.accountId, now), now };
  }
}
