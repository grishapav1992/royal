// These engine tables live inside the Nile financial schema and commit with its monetary journal.
// The unrelated historical demo schema is never queried.
export const nativeFinanceSql=`
 SELECT 'native:'||l.account_id||':'||l.operation_id||':'||l.game AS id,l.account_id AS player_id,''::text AS opponent_id,
 CASE WHEN l.game='atelier' THEN 'purchase' ELSE 'game' END AS kind,CASE WHEN l.game='atelier' THEN '' ELSE 'house' END AS mode,l.game,
 l.round_id,CASE WHEN coalesce(c.state,m.state,f.state,p.state) IN ('active','reserved') THEN 'pending'
 WHEN p.state='refunded' THEN 'failed' ELSE 'finished' END AS status,coalesce(c.state,m.state,f.state,p.state,'finished') AS provider_status,
 CASE WHEN l.stake>0 THEN l.stake ELSE l.payout END AS amount_units,l.delta AS delta_units,l.stake AS stake_units,l.payout AS payout_units,
 ''::text AS tx_id,'usdt-nile'::text AS currency,''::text AS address,l.created_at,''::text AS actor_id,''::text AS reason,0::numeric AS fee_units
 FROM (SELECT x.account_id,x.operation_id,coalesce(x.source,'royal-coins') AS game,
 coalesce((SELECT q.session_id FROM demo_casino_requests q WHERE q.account_id=x.account_id AND q.id=x.operation_id),x.operation_id) AS round_id,
 min(x.created_at) AS created_at,
 coalesce(-sum(x.amount_units) FILTER(WHERE x.entry_type='bet'),0)::numeric*10000 AS stake,
 coalesce(sum(x.amount_units) FILTER(WHERE x.entry_type IN ('win','refund')),0)::numeric*10000 AS payout,
 sum(x.amount_units)::numeric*10000 AS delta FROM demo_ledger x WHERE x.entry_type<>'deposit' GROUP BY x.account_id,x.operation_id,x.source) l
 LEFT JOIN demo_casino_sessions c ON c.account_id=l.account_id AND c.id=l.round_id
 LEFT JOIN demo_mines_sessions m ON m.account_id=l.account_id AND m.id=l.round_id
 LEFT JOIN demo_flight_sessions f ON f.account_id=l.account_id AND f.id=l.round_id
 LEFT JOIN skin_purchases p ON p.account_id=l.account_id AND p.id=l.round_id`;

export const pvpFinanceSql=`
 SELECT 'pvp:'||(h.payload::jsonb->>'matchId')||':'||(h.payload::jsonb->'participants'->0->>'accountId') AS id,
 h.payload::jsonb->'participants'->0->>'accountId' AS player_id,
 coalesce((SELECT v->>'accountId' FROM jsonb_array_elements(fin.payload::jsonb->'participants') v WHERE v->>'accountId'<>h.payload::jsonb->'participants'->0->>'accountId'),'') AS opponent_id,
 'game'::text AS kind,'pvp'::text AS mode,h.payload::jsonb->>'gameId' AS game,h.payload::jsonb->>'matchId' AS round_id,
 CASE WHEN fin.id IS NULL THEN 'pending' WHEN fin.payload::jsonb->>'action'='refund' THEN 'failed' ELSE 'finished' END AS status,
 coalesce(fin.payload::jsonb->>'reason','hold') AS provider_status,
 (h.payload::jsonb->>'stakeUnits')::numeric AS amount_units,
 CASE WHEN fin.id IS NULL THEN 0 ELSE coalesce((SELECT sum(en.units::numeric) FROM entries en WHERE en.seq=fin.seq AND en.account='player:'||(h.payload::jsonb->'participants'->0->>'userId')),0) END-(h.payload::jsonb->>'stakeUnits')::numeric AS delta_units,
 (h.payload::jsonb->>'stakeUnits')::numeric AS stake_units,
 CASE WHEN fin.id IS NULL THEN 0 ELSE coalesce((SELECT sum(en.units::numeric) FROM entries en WHERE en.seq=fin.seq AND en.account='player:'||(h.payload::jsonb->'participants'->0->>'userId')),0) END AS payout_units,
 ''::text AS tx_id,'usdt-nile'::text AS currency,''::text AS address,(h.payload::jsonb->>'createdAt')::bigint AS created_at,''::text AS actor_id,''::text AS reason,
 CASE WHEN fin.payload::jsonb->>'action'='settle' THEN trunc(coalesce((SELECT sum(en.units::numeric) FROM entries en WHERE en.seq=fin.seq AND en.account='house'),0)/jsonb_array_length(fin.payload::jsonb->'participants')) ELSE 0 END AS fee_units
 FROM events h LEFT JOIN events fin ON fin.kind='pvp' AND fin.payload::jsonb->>'matchId'=h.payload::jsonb->>'matchId' AND fin.payload::jsonb->>'action' IN ('refund','settle')
 WHERE h.kind='pvp' AND h.payload::jsonb->>'action'='hold'`;
