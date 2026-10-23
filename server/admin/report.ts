import type { PostgresDatabase, DatabaseRow } from '../database';
import type { FinanceBalances, FinanceFilters, FinanceGroup, FinanceOperation, FinanceReport, FinanceSource } from '../../src/shared/financeAdmin';
import { financeFilters } from './validation';

// All source SQL is static. Filter values always use parameter bindings.
export async function queryFinanceReport(db: PostgresDatabase, sql: string, source: FinanceSource, value: unknown,
  balance: () => Promise<FinanceBalances>, enabled = true,
  wallets: (ids:string[])=>Promise<Record<string,{available:string;reserved:string}>> = async()=>({})): Promise<FinanceReport> {
  const f = financeFilters(value), args: unknown[] = [], clauses: string[] = [];
  const add = (sql: string, ...values: unknown[]) => { clauses.push(sql); args.push(...values); };
  if (f.from !== undefined) add('created_at>=?', f.from);
  if (f.to !== undefined) add('created_at<?', f.to);
  if (f.playerIds) add('(player_id=ANY(?::text[]) OR opponent_id=ANY(?::text[]))', f.playerIds, f.playerIds);
  for (const k of ['game','mode','kind','status'] as const) if (f[k]) add(k+'=?', f[k]);
  if (f.minUnits !== undefined) add('amount_units>=?::numeric', f.minUnits);
  if (f.maxUnits !== undefined) add('amount_units<=?::numeric', f.maxUnits);
  const cte = 'WITH operations AS ('+sql+'), filtered AS (SELECT * FROM operations'+(clauses.length?' WHERE '+clauses.join(' AND '):'')+') ';
  const aggregates = `count(*)::int AS count,
    coalesce(sum(delta_units) FILTER(WHERE kind='deposit'),0)::text AS deposits,
    coalesce(sum(amount_units) FILTER(WHERE kind='withdrawal' AND status='finished'),0)::text AS withdrawals,
    coalesce(sum(stake_units) FILTER(WHERE kind='game' AND status='finished'),0)::text AS stakes,
    coalesce(sum(payout_units) FILTER(WHERE kind='game' AND status='finished'),0)::text AS payouts,
    coalesce(sum(stake_units-payout_units) FILTER(WHERE kind='game' AND status='finished' AND mode='house'),0)::text AS ggr,
    coalesce(sum(delta_units) FILTER(WHERE kind='adjustment'),0)::text AS adjustments`;
  const group = (r: DatabaseRow): FinanceGroup => ({ id:String(r.id), count:Number(r.count), deposits:String(r.deposits),withdrawals:String(r.withdrawals),
    stakes:String(r.stakes),payouts:String(r.payouts),ggr:String(r.ggr),adjustments:String(r.adjustments) });
  return db.transaction(async () => {
    const totals = (await db.prepare(cte+'SELECT '+aggregates+", count(*) FILTER(WHERE status IN ('pending','review'))::int AS pending FROM filtered").get(...args))!;
    const undated = (await db.prepare('WITH operations AS ('+sql+') SELECT count(*)::int AS n FROM operations WHERE created_at IS NULL').get())!;
    const rows = await db.prepare(cte+'SELECT * FROM filtered ORDER BY created_at DESC NULLS LAST,id DESC LIMIT ? OFFSET ?').all(...args, f.size,(f.page-1)*f.size);
    const groups = async (column: string, condition: string) => {
      const count = (await db.prepare(cte+`SELECT count(DISTINCT ${column})::int AS n FROM filtered WHERE ${condition}`).get(...args))!;
      const rows = await db.prepare(cte+`SELECT ${column} AS id,${aggregates} FROM filtered WHERE ${condition} GROUP BY ${column} ORDER BY count(*) DESC,${column} LIMIT ? OFFSET ?`)
        .all(...args,f.size,(f.page-1)*f.size);
      return { count:Number(count.n), rows:rows.map(group) };
    };
    const players = await groups('player_id',"player_id<>''"), games = await groups('game',"kind='game'");
    const days=await db.prepare(cte+`SELECT to_char(to_timestamp(created_at/1000.0) AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD') AS date,${aggregates}
      FROM filtered WHERE created_at IS NOT NULL GROUP BY date ORDER BY date DESC LIMIT 60`).all(...args);
    const operation = (r: DatabaseRow): FinanceOperation => ({ id:r.id,playerId:r.player_id,opponentId:r.opponent_id,kind:r.kind,mode:r.mode,game:r.game,
      roundId:r.round_id,status:r.status,providerStatus:r.provider_status,amountUnits:String(r.amount_units),deltaUnits:String(r.delta_units),stakeUnits:String(r.stake_units),
      payoutUnits:String(r.payout_units),txId:r.tx_id,currency:r.currency,address:r.address,createdAt:r.created_at===null?null:Number(r.created_at),actorId:r.actor_id,reason:r.reason });
    return {source,environment:source==='nile'?'test':'real',enabled,generatedAt:Date.now(),balances:await balance(),
      totals:{...group({...totals,id:''}),pending:Number(totals.pending),undated:Number(undated.n)},
      rows:rows.map(operation),players:players.rows,games:games.rows,playerCount:players.count,gameCount:games.count,page:f.page,size:f.size,
      wallets:await wallets([...new Set([...players.rows.map(r=>r.id),...(f.playerIds??[])])]),
      days:days.reverse().map(d=>({date:d.date,deposits:String(d.deposits),withdrawals:String(d.withdrawals),ggr:String(d.ggr)}))};
  },{readOnly:true});
}

export const paymentReportSql = `
 SELECT id,account_id AS player_id,''::text AS opponent_id,kind,''::text AS mode,''::text AS game,''::text AS round_id,
 CASE WHEN state IN ('finished','refunded') THEN CASE WHEN state='refunded' THEN 'failed' ELSE 'finished' END
 WHEN state IN ('rejected','expired','failed') THEN 'failed' WHEN state='review' THEN 'review' ELSE 'pending' END AS status,
 state AS provider_status,amount_units::numeric AS amount_units,
 CASE WHEN kind='deposit' THEN credited_units WHEN state='finished' THEN -amount_units ELSE 0 END::numeric AS delta_units,
 0::numeric AS stake_units,0::numeric AS payout_units,coalesce(detail::jsonb->>'txHash','') AS tx_id,
 coalesce(detail::jsonb->>'currency','') AS currency,coalesce(detail::jsonb->>'address','') AS address,created_at,
 ''::text AS actor_id,''::text AS reason FROM crypto_operations
 UNION ALL SELECT id,account_id,'','game','house',result::jsonb->>'gameId',id,'finished','finished',
 (result::jsonb->>'stakeUnits')::numeric,(result::jsonb->>'payoutUnits')::numeric-(result::jsonb->>'stakeUnits')::numeric,
 (result::jsonb->>'stakeUnits')::numeric,(result::jsonb->>'payoutUnits')::numeric,'','usdttrc20','',created_at,'','' FROM crypto_rounds
 UNION ALL SELECT id,player_id,'','adjustment','','','','finished','finished',abs(delta_units::numeric),delta_units::numeric,0,0,'','usdttrc20','',created_at,actor_id,reason FROM finance_adjustments`;

export const nileReportSql = (auto: boolean) => `
 WITH owners AS (SELECT account_id,user_id FROM bindings ${auto?'UNION ALL SELECT account_id,user_id FROM auto_bindings':''})
 SELECT e.id,coalesce(o.account_id,'') AS player_id,''::text AS opponent_id,
 CASE e.kind WHEN 'funding' THEN CASE WHEN (e.payload::jsonb->>'playerUnits')::numeric>0 THEN 'deposit' ELSE 'capital' END
 WHEN 'round' THEN 'game' WHEN 'adjustment' THEN 'adjustment' ELSE 'capital' END AS kind,
 CASE WHEN e.kind='round' THEN 'house' ELSE '' END AS mode,CASE WHEN e.kind='round' THEN 'royal-coins' ELSE '' END AS game,
 CASE WHEN e.kind='round' THEN e.payload::jsonb->>'id' ELSE '' END AS round_id,'finished'::text AS status,e.kind AS provider_status,
 CASE e.kind WHEN 'funding' THEN CASE WHEN (e.payload::jsonb->>'playerUnits')::numeric>0 THEN (e.payload::jsonb->>'playerUnits')::numeric ELSE (e.payload::jsonb->>'reserveUnits')::numeric END
 WHEN 'round' THEN (e.payload::jsonb->>'stakeUnits')::numeric WHEN 'adjustment' THEN abs((e.payload::jsonb->>'deltaUnits')::numeric) ELSE (e.payload::jsonb->>'units')::numeric END AS amount_units,
 CASE e.kind WHEN 'funding' THEN (e.payload::jsonb->>'playerUnits')::numeric WHEN 'round' THEN (e.payload::jsonb->>'payoutUnits')::numeric-(e.payload::jsonb->>'stakeUnits')::numeric
 WHEN 'adjustment' THEN (e.payload::jsonb->>'deltaUnits')::numeric ELSE -(e.payload::jsonb->>'units')::numeric END AS delta_units,
 coalesce((e.payload::jsonb->>'stakeUnits')::numeric,0) AS stake_units,coalesce((e.payload::jsonb->>'payoutUnits')::numeric,0) AS payout_units,
 coalesce(e.payload::jsonb->>'txId','') AS tx_id,'usdt-nile'::text AS currency,''::text AS address,
 (e.payload::jsonb->>'createdAt')::bigint AS created_at,coalesce(e.payload::jsonb->>'actorId','') AS actor_id,coalesce(e.payload::jsonb->>'reason','') AS reason
 FROM events e LEFT JOIN owners o ON o.user_id=e.payload::jsonb->>'userId'`;

export const mainnetReportSql = `
 WITH sessions AS (SELECT DISTINCT ON (payload::jsonb->'session'->>'id') * FROM events WHERE kind='casino' ORDER BY payload::jsonb->'session'->>'id',seq DESC),
 items AS (SELECT e.* FROM events e WHERE kind<>'casino' UNION ALL SELECT * FROM sessions)
 SELECT e.id,CASE WHEN e.kind='transfer' THEN CASE WHEN e.payload::jsonb->>'owner'='player' THEN s.config::jsonb->>'accountId' ELSE '' END
 WHEN e.kind='adjustment' THEN e.payload::jsonb->>'playerId' ELSE e.payload::jsonb->>'accountId' END AS player_id,''::text AS opponent_id,
 CASE WHEN e.kind IN ('round','casino') THEN 'game' WHEN e.kind='adjustment' THEN 'adjustment' WHEN e.payload::jsonb->>'owner'<>'player' THEN 'capital'
 WHEN e.payload::jsonb->>'direction'='in' THEN 'deposit' ELSE 'withdrawal' END AS kind,
 CASE WHEN e.kind IN ('round','casino') THEN 'house' ELSE '' END AS mode,
 coalesce(e.payload::jsonb->>'gameId',e.payload::jsonb->'session'->>'gameId','') AS game,
 coalesce(e.payload::jsonb->'session'->>'id',e.payload::jsonb->>'id','') AS round_id,
 CASE WHEN e.kind='casino' AND e.payload::jsonb->'session'->>'state'='active' THEN 'pending' ELSE 'finished' END AS status,e.kind AS provider_status,
 coalesce((e.payload::jsonb->>'amountUnits')::numeric,(e.payload::jsonb->>'stakeUnits')::numeric,(e.payload::jsonb->'session'->>'stakeUnits')::numeric,abs((e.payload::jsonb->>'deltaUnits')::numeric),0) AS amount_units,
 CASE WHEN e.kind='transfer' THEN (e.payload::jsonb->>'amountUnits')::numeric * CASE WHEN e.payload::jsonb->>'direction'='in' THEN 1 ELSE -1 END
 WHEN e.kind='round' THEN (e.payload::jsonb->>'payoutUnits')::numeric-(e.payload::jsonb->>'stakeUnits')::numeric
 WHEN e.kind='casino' THEN (SELECT sum((x.payload::jsonb->>'deltaUnits')::numeric) FROM events x WHERE x.kind='casino' AND x.payload::jsonb->'session'->>'id'=e.payload::jsonb->'session'->>'id')
 ELSE (e.payload::jsonb->>'deltaUnits')::numeric END AS delta_units,
 coalesce((e.payload::jsonb->>'stakeUnits')::numeric,(e.payload::jsonb->'session'->>'stakeUnits')::numeric,0) AS stake_units,
 CASE WHEN e.kind='casino' THEN (SELECT sum((x.payload::jsonb->>'deltaUnits')::numeric) FROM events x WHERE x.kind='casino' AND x.payload::jsonb->'session'->>'id'=e.payload::jsonb->'session'->>'id')+(e.payload::jsonb->'session'->>'stakeUnits')::numeric ELSE coalesce((e.payload::jsonb->>'payoutUnits')::numeric,0) END AS payout_units,
 coalesce(e.payload::jsonb->>'txId','') AS tx_id,'usdttrc20'::text AS currency,coalesce(e.payload::jsonb->>'from','') AS address,
 CASE WHEN e.kind='casino' THEN (SELECT min((x.payload::jsonb->>'createdAt')::bigint) FROM events x WHERE x.kind='casino' AND x.payload::jsonb->'session'->>'id'=e.payload::jsonb->'session'->>'id') ELSE coalesce((e.payload::jsonb->>'createdAt')::bigint,b.timestamp) END AS created_at,coalesce(e.payload::jsonb->>'actorId','') AS actor_id,coalesce(e.payload::jsonb->>'reason','') AS reason
 FROM items e CROSS JOIN state s LEFT JOIN blocks b ON b.height=(e.payload::jsonb->>'height')::bigint`;
