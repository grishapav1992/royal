import type { DatabaseRow } from '../database';
import { NilePlayError, type NilePlayLedger } from './nile-play-ledger';
import { gameAccountId } from '../../src/shared/nileWallet';
import { COMBAT_USDT_STAKES, type CombatEscrowReceipt } from '../../src/shared/combatEscrow';
import type { PvpLedger } from '../pvp/store';

const fail = (code: string, status = 409): never => { throw new NilePlayError(code, status); };
type Request = { id: string; accounts: [string, string]; stakeUnits: string; winner?: string };
/** Match metadata only. All money stays in the common, audited Nile PvP journal. */
export class NileCombatEscrow {
 readonly ready: Promise<void>;
 constructor(private ledger: PvpLedger & {hasPvpMatch?:(id:string)=>Promise<boolean>}, private now = () => Date.now()) {
  this.ready = ledger.ready.then(() => ledger.db.transaction(() => ledger.db.exec(`
   CREATE TABLE IF NOT EXISTS combat_matches(
    id TEXT PRIMARY KEY, accounts TEXT NOT NULL, stake_units BIGINT NOT NULL CHECK(stake_units>0),
    state TEXT NOT NULL CHECK(state IN ('active','settled','refunded','cancelled')),
    expires_at BIGINT NOT NULL, winner TEXT NOT NULL DEFAULT '',
    fee_units BIGINT NOT NULL DEFAULT 0, payout_units BIGINT NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS combat_seats(account_id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES combat_matches(id));
   CREATE INDEX IF NOT EXISTS combat_expiry ON combat_matches(state,expires_at);`)));
 }
 private receipt(row: DatabaseRow): CombatEscrowReceipt {
  return {id: row.id, accounts: JSON.parse(row.accounts), stakeUnits: String(row.stake_units), state: row.state,
   winner: row.winner, feeUnits: String(row.fee_units), payoutUnits: String(row.payout_units), expiresAt: Number(row.expires_at)};
 }
 private request(actor: string, value: unknown, action: 'fund' | 'settle' | 'cancel'): Request {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid_combat_request',400);
  const v = value as Request;
  if (Object.keys(v).sort().join(',') !== (action === 'settle' ? 'accounts,id,stakeUnits,winner' : 'accounts,id,stakeUnits')
   || !gameAccountId(v.id) || !Array.isArray(v.accounts) || v.accounts.length !== 2 || !v.accounts.every(gameAccountId)
   || v.accounts[0] === v.accounts[1] || v.accounts[0] !== actor
   || typeof v.stakeUnits !== 'string' || !COMBAT_USDT_STAKES.some(n => String(n * 1_000_000) === v.stakeUnits)
   || action === 'settle' && (typeof v.winner !== 'string' || v.winner !== '' && !v.accounts.includes(v.winner))) return fail('invalid_combat_request',400);
  return v;
 }
 private async existing(v: Request) {
  const row = await this.ledger.db.prepare('SELECT * FROM combat_matches WHERE id=?').get(v.id);
  if (row && (row.accounts !== JSON.stringify(v.accounts) || String(row.stake_units) !== v.stakeUnits)) fail('play_idempotency_conflict');
  return row;
 }
 async fund(actor: string, value: unknown) {
  const v = this.request(actor,value,'fund'); await this.ready;
  return this.ledger.db.transaction(async () => {
   const old = await this.existing(v);
   if (old) return old.state === 'active' && Number(old.expires_at) <= this.now() ? this.finish(old,'') : this.receipt(old);
   if (this.ledger.hasPvpMatch ? await this.ledger.hasPvpMatch(v.id) : await this.ledger.db.prepare("SELECT 1 FROM events WHERE kind='pvp' AND payload::jsonb->>'matchId'=?").get(v.id)) fail('play_idempotency_conflict');
   for (const account of v.accounts) if (await this.ledger.db.prepare('SELECT 1 FROM combat_seats WHERE account_id=?').get(account)) fail('combat_already_playing');
   const now = this.now();
   // Both holds and metadata commit together, or neither player is charged.
   for (const account of v.accounts) await this.ledger.pvpHold(account,{matchId:v.id,gameId:'mortal-kombat',stakeUnits:v.stakeUnits},now);
   await this.ledger.db.prepare("INSERT INTO combat_matches(id,accounts,stake_units,state,expires_at) VALUES (?,?,?,'active',?)").run(v.id,JSON.stringify(v.accounts),v.stakeUnits,now+150000);
   for (const account of v.accounts) await this.ledger.db.prepare('INSERT INTO combat_seats VALUES (?,?)').run(account,v.id);
   return this.receipt((await this.existing(v))!);
  });
 }
 private async finish(row: DatabaseRow, winner: string) {
  if (row.state !== 'active') return this.receipt(row);
  const accounts = JSON.parse(row.accounts) as [string,string], stake = BigInt(row.stake_units);
  const expired = Number(row.expires_at) <= this.now(); if (expired) winner = '';
  await this.ledger.pvpFinish(accounts[0],{matchId:row.id,winnerId:winner || null,reason:expired?'expired':winner?'win':'draw'},this.now());
  const fee = winner ? stake / 10n : 0n, payout = winner ? stake * 2n - fee : 0n;
  await this.ledger.db.prepare('DELETE FROM combat_seats WHERE match_id=?').run(row.id);
  await this.ledger.db.prepare('UPDATE combat_matches SET state=?,winner=?,fee_units=?,payout_units=? WHERE id=?').run(winner?'settled':'refunded',winner,String(fee),String(payout),row.id);
  return this.receipt((await this.ledger.db.prepare('SELECT * FROM combat_matches WHERE id=?').get(row.id))!);
 }
 async settle(actor: string, value: unknown) {
  const v = this.request(actor,value,'settle'); await this.ready;
  return this.ledger.db.transaction(async () => {
   const old = await this.existing(v); if (!old) return fail('combat_unavailable');
   return this.finish(old,v.winner!);
  });
 }
 async cancel(actor: string, value: unknown) {
  const v = this.request(actor,value,'cancel'); await this.ready;
  return this.ledger.db.transaction(async () => {
   const old = await this.existing(v); if (old) return this.finish(old,'');
   // A durable tombstone makes delayed funding harmless even after a restart.
   await this.ledger.db.prepare("INSERT INTO combat_matches(id,accounts,stake_units,state,expires_at) VALUES (?,?,?,'cancelled',?)").run(v.id,JSON.stringify(v.accounts),v.stakeUnits,this.now()+150000);
   return this.receipt((await this.existing(v))!);
  });
 }
 async recoverExpired() {
  await this.ready;
  await this.ledger.db.transaction(async () => {
   for (const row of await this.ledger.db.prepare("SELECT * FROM combat_matches WHERE state='active' AND expires_at<=? ORDER BY expires_at LIMIT 100").all(this.now())) await this.finish(row,'');
  });
 }
}
