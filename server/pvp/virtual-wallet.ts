import type { PostgresDatabase } from '../database';
import { DemoWalletStore } from '../demoWallet';
import { demoBalanceUnits, demoReservedUnits, saveDemoUnits, recordDemoUnits, MAX_DEMO_UNITS } from '../demoWalletAmounts';
import { NilePlayError } from '../finance/nile-play-error';
import { isPvpMoneyGame } from '../finance/pvp-money';
import { gameAccountId } from '../../src/shared/nileWallet';
import { PVP_GAMES, pvpPayout, validVirtualPvpStake, VIRTUAL_PVP_SCOPE, type PvpGameId, type VirtualPvpWallet } from '../../src/shared/pvp';
import {validTsuDuelStake,tsuDuelPayout} from '../../src/shared/tsuDuel';
import { settleRemovedCasino } from '../removedCasino';
import { parseProviderPendingUnits, providerDecimal } from '../providerPending';

const fail=(code:string,status=409):never=>{throw new NilePlayError(code,status);};
const cents=(micro:string)=>Number(BigInt(micro)/10000n);
export class VirtualPvpLedger {
  readonly ready:Promise<void>;
  constructor(readonly db:PostgresDatabase,common:DemoWalletStore){this.ready=common.ready;}
  private async lock(accounts:string[]){
    for(const id of [...new Set(accounts)].sort())await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(this.db.schema+':key:account:'+id);
  }
  async wallet(accountId:string):Promise<VirtualPvpWallet>{
    await this.ready;
    return this.db.transaction(async()=>{
      await this.lock([accountId]);
      await settleRemovedCasino(this.db, accountId);
      return (await this.readWallets([accountId])).get(accountId)!;
    });
  }
  /** Called in the same repeatable-read snapshot as the idle-room check. */
  async readIdleRoomWallets(accountIds: string[]) {
    if (!this.db.inTransaction) throw new Error('Idle room wallet projection requires a transaction');
    if (await this.db.prepare(`SELECT 1 FROM demo_casino_sessions
      WHERE account_id=ANY(?::text[]) AND game_id='github-tower' AND state='active' LIMIT 1`).get(accountIds)) return undefined;
    return this.readWallets(accountIds);
  }
  private async readWallets(accountIds: string[]) {
    const rows = await this.db.prepare(`SELECT player.account_id, w.balance AS wallet_balance, w.fraction_units,
      pending.pending_units, (SELECT coalesce(sum(h.stake_units),0) FROM virtual_pvp_holds h
        WHERE h.account_id=player.account_id AND h.state='held') AS held_units, history.*
      FROM unnest(?::text[]) WITH ORDINALITY AS player(account_id,position)
      LEFT JOIN demo_wallets w USING (account_id)
      LEFT JOIN capro_pending_balances pending USING (account_id)
      LEFT JOIN LATERAL (
        SELECT id,entry_type AS kind,amount_units/100.0 AS amount,balance_units/100.0 AS balance,
          operation_id AS operationId,created_at AS createdAt,source,game_name AS gameName
        FROM demo_ledger WHERE account_id=player.account_id ORDER BY id DESC LIMIT 50
      ) history ON true ORDER BY player.position,history.id DESC`).all(accountIds);
    const wallets = new Map<string, VirtualPvpWallet>();
    for (const row of rows) {
      const { account_id: accountId, id, kind, amount, balance, operationId, createdAt, source, gameName } = row;
      let projection = wallets.get(accountId);
      if (!projection) {
        const units = Number(row.wallet_balance ?? 0) * 100 + Number(row.fraction_units ?? 0);
        const pending = parseProviderPendingUnits(row.pending_units);
        projection = { scope: VIRTUAL_PVP_SCOPE, state: 'assigned', ready: true,
          wallet: { balance: units / 100, entries: [], ...(pending ? { pendingBalance: providerDecimal(pending) } : {}) },
          balanceUnits: String(units * 10000), reservedUnits: String(Number(row.held_units) * 10000) };
        wallets.set(accountId, projection);
      }
      if (id !== null) projection.wallet.entries.push({ id, kind, amount: Number(amount), balance: Number(balance),
        operationId, createdAt, source, gameName });
    }
    return wallets;
  }
  async hasPvpMatch(id:string){return !!await this.db.prepare('SELECT 1 FROM virtual_pvp_banks WHERE match_id=?').get(id);}
  async pvpHold(accountId:string,value:unknown,now=Date.now()){
    const v=value as {matchId:string;gameId:string;stakeUnits:string};
    if(!gameAccountId(accountId)||!v||Object.keys(v).sort().join(',')!=='gameId,matchId,stakeUnits'||!gameAccountId(v.matchId)||!isPvpMoneyGame(v.gameId))return fail('invalid_pvp_request',400);
    const tsu=v.gameId==='tsu-e-fa'&&validTsuDuelStake(v.stakeUnits);
    if(!tsu&&!validVirtualPvpStake(v.stakeUnits))return fail('Ставка от 1 до 500 USDT с шагом 0,10 USDT.',400);
    await this.ready;
    return this.db.transaction(async()=>{
      await this.lock([accountId]);
      const bank=await this.db.prepare('SELECT * FROM virtual_pvp_banks WHERE match_id=?').get(v.matchId);
      const hold=await this.db.prepare('SELECT * FROM virtual_pvp_holds WHERE match_id=? AND account_id=?').get(v.matchId,accountId);
      const stake=cents(v.stakeUnits),capacity=cents((tsu?tsuDuelPayout:pvpPayout)(v.stakeUnits).payoutUnits);
      if(bank&&(bank.game_id!==v.gameId||Number(bank.stake_units)!==stake))return fail('play_idempotency_conflict');
      if(hold)return {wallet:await this.wallet(accountId),replayed:true};
      if(bank&&bank.state!=='open')return fail('pvp_unavailable');
      if(await this.db.prepare("SELECT 1 FROM virtual_pvp_holds WHERE account_id=? AND state='held' LIMIT 1").get(accountId))return fail('Сначала заверши текущую ставку.');
      const count=await this.db.prepare('SELECT count(*) AS n FROM virtual_pvp_holds WHERE match_id=?').get(v.matchId);
      if(Number(count!.n)>=2)return fail('pvp_unavailable');
      const balance=await demoBalanceUnits(this.db,accountId);
      if(balance<stake)return fail('play_insufficient_balance');
      if(balance-stake+await demoReservedUnits(this.db,accountId)+capacity>MAX_DEMO_UNITS)return fail('Недостаточно места на балансе для возможного выигрыша.');
      if(!bank)await this.db.prepare("INSERT INTO virtual_pvp_banks(match_id,game_id,stake_units,state,created_at,updated_at) VALUES(?,?,?,'open',?,?)").run(v.matchId,v.gameId,stake,now,now);
      await this.db.prepare("INSERT INTO virtual_pvp_holds VALUES(?,?,?,?,'held')").run(v.matchId,accountId,stake,capacity);
      await saveDemoUnits(this.db,accountId,balance-stake);
      await recordDemoUnits(this.db,accountId,'pvp:'+v.matchId+':hold','bet',-stake,balance-stake,'pvp:'+v.gameId,PVP_GAMES[v.gameId as PvpGameId]??'Mortal Kombat');
      return {wallet:await this.wallet(accountId),replayed:false};
    });
  }
  async pvpFinish(accountId:string,value:unknown,now=Date.now()){
    const v=value as {matchId:string;winnerId:string|null;reason:string};
    if(!gameAccountId(accountId)||!v||Object.keys(v).sort().join(',')!=='matchId,reason,winnerId'||!gameAccountId(v.matchId)
      ||v.winnerId!==null&&!gameAccountId(v.winnerId)||!['win','draw','cancel','expired','server','disconnect','resign','timeout'].includes(v.reason))return fail('invalid_pvp_request',400);
    await this.ready;
    return this.db.transaction(async()=>{
      const bank=await this.db.prepare('SELECT * FROM virtual_pvp_banks WHERE match_id=?').get(v.matchId);
      const holds=await this.db.prepare('SELECT * FROM virtual_pvp_holds WHERE match_id=? ORDER BY account_id').all(v.matchId);
      if(!bank||!holds.some(h=>h.account_id===accountId))return fail('pvp_unavailable');
      await this.lock(holds.map(h=>h.account_id));
      if(bank.state!=='open'){
        if(bank.winner_id!==v.winnerId||bank.reason!==v.reason)return fail('play_idempotency_conflict');
        return {wallet:await this.wallet(accountId),replayed:true};
      }
      if(v.winnerId!==null&&(holds.length!==2||!holds.some(h=>h.account_id===v.winnerId)))return fail('invalid_pvp_result');
      const units=String(Number(bank.stake_units)*10000);
      const payout=bank.game_id==='tsu-e-fa'&&validTsuDuelStake(units)?tsuDuelPayout(units):pvpPayout(units);
      await this.db.prepare('UPDATE virtual_pvp_banks SET state=?,winner_id=?,reason=?,fee_units=?,updated_at=? WHERE match_id=?')
        .run(v.winnerId?'settled':'refunded',v.winnerId,v.reason,v.winnerId?cents(payout.feeUnits):0,now,v.matchId);
      await this.db.prepare('UPDATE virtual_pvp_holds SET state=? WHERE match_id=?').run(v.winnerId?'settled':'refunded',v.matchId);
      for(const h of holds){
        const amount=v.winnerId===null?Number(h.stake_units):h.account_id===v.winnerId?cents(payout.payoutUnits):0;
        if(!amount)continue;
        const balance=await demoBalanceUnits(this.db,h.account_id)+amount;
        await saveDemoUnits(this.db,h.account_id,balance);
        await recordDemoUnits(this.db,h.account_id,'pvp:'+v.matchId+':final',v.winnerId?'win':'refund',amount,balance,'pvp:'+bank.game_id,PVP_GAMES[bank.game_id as PvpGameId]??'Mortal Kombat');
      }
      return {wallet:await this.wallet(accountId),replayed:false};
    });
  }
}
