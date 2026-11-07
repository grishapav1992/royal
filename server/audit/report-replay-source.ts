import { identifier, type PostgresDatabase } from '../database';
import type { AuditSourceSchemas } from './datasets';
import { auditExportReaderSlotGuard } from './report-export-slot';

const validName = (name: string) => /^[a-z_][a-z0-9_]{0,62}$/.test(name);
const uuidPattern = '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
const maximumWireBytes = 16 * 1024 * 1024;

async function exists(db: PostgresDatabase, schema: string, table: string) {
  return (await db.prepare('SELECT pg_catalog.to_regclass(?) IS NOT NULL AS present').get(schema + '.' + table))?.present === true;
}

/** Only a committed job and independently captured game entity can authorize a replay. */
export async function installAuditReplayReport(db: PostgresDatabase, readerRole: string, sources: AuditSourceSchemas) {
  const schemas = [db.schema, sources.game, ...(sources.payments ? [sources.payments] : [])];
  if (!validName(readerRole) || schemas.some(schema => !validName(schema)) || new Set(schemas).size !== schemas.length) {
    throw new Error('Invalid audit replay source configuration');
  }
  const a = identifier(db.schema), g = identifier(sources.game), demo = "'" + sources.game + ".demo_ledger'";
  const relation = (schema: string, table: string) => identifier(schema) + '.' + identifier(table);
  const optionalSources = [
    { schema: sources.game, table: 'capro_pending_ledger' },
    ...(sources.payments ? [{ schema: sources.payments, table: 'crypto_ledger' }] : []),
  ];
  const extraSources = (await Promise.all(optionalSources.map(async source =>
    await exists(db, source.schema, source.table) ? [source] : []))).flat();
  const extraChecks = extraSources.map(({ schema, table }) => `OR (r.source_namespace='${schema}.${table}' AND EXISTS (
    SELECT 1 FROM ${relation(schema, table)} l WHERE l.id=r.source_row_id AND l.account_id=r.account_id
      AND l.operation_id=r.operation_id AND l.created_at=r.occurred_at_ms
  ))`).join('\n');
  const acl = a + '.audit_report_acl', refs = a + '.audit_posting_refs', opening = a + '.audit_opening_obligations';
  const fn = a + '.audit_report_replay', projection = a + '.audit_report_replay_projection';
  const reader = identifier(readerRole);
  const authorizeJob = `SELECT e.dataset_id,e.filters,d.environment INTO j FROM ${a}.audit_export_jobs e
        JOIN ${a}.audit_datasets d ON d.id=e.dataset_id
        WHERE e.id=p_job AND e.operator_name=session_user AND e.kind='replay' AND e.status='running'
          AND e.expires_at>clock_timestamp();
        IF NOT FOUND OR NOT EXISTS (
          SELECT 1 FROM ${acl} WHERE operator_name=session_user AND dataset_id=j.dataset_id
        ) THEN
          RAISE EXCEPTION 'Audit report access denied' USING ERRCODE='42501';
        END IF;`;
  const demoPosting = `l.id=r.source_row_id AND l.account_id=r.account_id
    AND l.operation_id=r.operation_id AND l.created_at=r.occurred_at_ms`;
  const pvpKeys = "('pvp:'||v_entity||':hold','pvp:'||v_entity||':final')";
  const toteRelation = `(l.operation_id='flag-tote:'||v_entity||':final' AND EXISTS (
       SELECT 1 FROM ${g}.flag_tote_tickets t WHERE t.round_id=v_entity AND t.account_id=l.account_id
     ) OR EXISTS (
       SELECT 1 FROM ${g}.flag_tote_tickets t WHERE t.id=substring(l.operation_id from 11)
         AND t.round_id=v_entity AND t.account_id=l.account_id AND l.operation_id='flag-tote:'||t.id
     ))`;

  await db.transaction(async () => {
    // The byte preflight, fragment aggregation and authorization read the same snapshot.
    await db.exec(`CREATE OR REPLACE FUNCTION ${projection}(p_job uuid) RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp
      SET plan_cache_mode=force_custom_plan AS $replay_projection$
      DECLARE
        j record;
        v_manifest jsonb;
        v_fragments jsonb;
        v_replay_id uuid;
        v_entity text;
        v_category text;
        v_game text;
        v_account text;
        v_authorized boolean;
        v_bytes bigint;
        v_absent CONSTANT jsonb := '{"status":"absent"}'::jsonb;
      BEGIN
        ${authorizeJob}
        IF NOT EXISTS (SELECT 1 FROM ${acl} WHERE operator_name=session_user AND dataset_id=j.dataset_id
          AND source_namespace=${demo}) THEN RETURN v_absent; END IF;

        v_replay_id := (j.filters->>'replayId')::uuid;
        SELECT manifest INTO v_manifest FROM ${a}.audit_replay_packages
        WHERE dataset_id=j.dataset_id AND replay_id=v_replay_id AND octet_length(manifest::text)<=131072;
        IF NOT FOUND OR v_manifest #>> '{scope,datasetId}' IS DISTINCT FROM j.dataset_id::text
          OR v_manifest #>> '{scope,environment}' IS DISTINCT FROM j.environment
          OR v_manifest->>'replayId' IS DISTINCT FROM v_replay_id::text THEN RETURN v_absent; END IF;
        v_entity := v_manifest->>'entityId';
        v_category := v_manifest #>> '{game,category}';
        v_game := v_manifest #>> '{game,gameId}';
        IF v_game IS NULL OR v_game !~ '^[a-z0-9][a-z0-9._-]{0,127}$' THEN RETURN v_absent; END IF;

        IF v_category='casino' AND v_entity ~ '${uuidPattern}' THEN
          -- A casino operation or session key belongs to an account. Reject ambiguous reused keys.
          WITH candidates AS MATERIALIZED (
            SELECT * FROM ${refs} WHERE dataset_id=j.dataset_id AND source_namespace=${demo}
              AND operation_id=v_entity ORDER BY source_row_id LIMIT 9
          ), owners AS (
            SELECT DISTINCT l.account_id FROM candidates r JOIN ${g}.demo_ledger l ON ${demoPosting}
            WHERE l.source=v_game AND l.entry_type='bet' AND (
              EXISTS (SELECT 1 FROM ${g}.demo_operations o WHERE o.account_id=l.account_id
                AND o.operation_id=v_entity AND o.kind IN ('spin','play'))
              OR EXISTS (SELECT 1 FROM ${g}.demo_casino_sessions s WHERE s.account_id=l.account_id
                AND s.id=v_entity AND s.game_id=v_game)
            )
          )
          SELECT min(account_id),count(*)=1 AND (SELECT count(*) FROM candidates)<=8
            INTO v_account,v_authorized FROM owners;
        ELSIF v_category='pvp' AND v_entity ~ '${uuidPattern}' THEN
          SELECT EXISTS (SELECT 1 FROM ${g}.virtual_pvp_banks b WHERE b.match_id=v_entity AND b.game_id=v_game AND (
            EXISTS (SELECT 1 FROM ${refs} r JOIN ${g}.demo_ledger l ON ${demoPosting}
              JOIN ${g}.virtual_pvp_holds h ON h.match_id=b.match_id AND h.account_id=l.account_id
              WHERE r.dataset_id=j.dataset_id AND r.source_namespace=${demo} AND r.operation_id IN ${pvpKeys}
                AND l.source='pvp:'||v_game)
            OR EXISTS (SELECT 1 FROM ${opening} o JOIN ${g}.virtual_pvp_holds h
                ON h.match_id=o.entity_id AND h.account_id=o.account_id AND h.stake_units=o.principal_units
              WHERE o.dataset_id=j.dataset_id AND o.source_namespace='${sources.game}.virtual_pvp_holds'
                AND o.entity_id=v_entity AND o.state='held')
          )) INTO v_authorized;
        ELSIF v_category='totalizator' AND v_game='flag-tote' AND v_entity ~ '^ft1-[0-9]{1,16}$' THEN
          SELECT EXISTS (SELECT 1 FROM ${g}.flag_tote_rounds p WHERE p.id=v_entity AND (
            EXISTS (SELECT 1 FROM ${g}.flag_tote_tickets t JOIN ${refs} r
                ON r.operation_id='flag-tote:'||t.id AND r.account_id=t.account_id
              JOIN ${g}.demo_ledger l ON ${demoPosting}
              WHERE t.round_id=p.id AND r.dataset_id=j.dataset_id AND r.source_namespace=${demo}
                AND l.source='flag-tote' AND l.entry_type='bet')
            OR EXISTS (SELECT 1 FROM ${refs} r JOIN ${g}.demo_ledger l ON ${demoPosting}
              WHERE r.dataset_id=j.dataset_id AND r.source_namespace=${demo}
                AND r.operation_id='flag-tote:'||v_entity||':final' AND l.source='flag-tote' AND ${toteRelation})
            OR EXISTS (SELECT 1 FROM ${g}.flag_tote_tickets t JOIN ${opening} o
                ON o.entity_id=t.id AND o.account_id=t.account_id AND o.principal_units=t.stake_units
              WHERE t.round_id=p.id AND o.dataset_id=j.dataset_id AND o.source_namespace='${sources.game}.flag_tote_tickets')
          )) INTO v_authorized;
        END IF;
        IF v_authorized IS DISTINCT FROM true THEN RETURN v_absent; END IF;

        SELECT COALESCE(sum(octet_length(fragment::text)),0) INTO v_bytes FROM ${a}.audit_replay_fragments
        WHERE dataset_id=j.dataset_id AND replay_id=v_replay_id;
        IF v_bytes+octet_length(v_manifest::text)>${maximumWireBytes} THEN RETURN v_absent; END IF;
        SELECT COALESCE(jsonb_agg(fragment ORDER BY ordinal),'[]'::jsonb) INTO v_fragments
        FROM ${a}.audit_replay_fragments WHERE dataset_id=j.dataset_id AND replay_id=v_replay_id;

        -- Check shape before expanding any untrusted JSON. Both postings and money references require authority.
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_fragments) f(value)
          WHERE jsonb_typeof(f.value->'events') IS DISTINCT FROM 'array'
            OR jsonb_array_length(CASE WHEN jsonb_typeof(f.value->'events')='array' THEN f.value->'events' ELSE '[]'::jsonb END)>128
        ) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fragments) f(value) CROSS JOIN LATERAL jsonb_array_elements(f.value->'events') e(value)
          WHERE jsonb_typeof(e.value->'postings') IS DISTINCT FROM 'array'
            OR jsonb_array_length(CASE WHEN jsonb_typeof(e.value->'postings')='array' THEN e.value->'postings' ELSE '[]'::jsonb END)>16
            OR (e.value ? 'money' AND (jsonb_typeof(e.value->'money') IS DISTINCT FROM 'array'
              OR jsonb_array_length(CASE WHEN jsonb_typeof(e.value->'money')='array' THEN e.value->'money' ELSE '[]'::jsonb END)>16))
        ) THEN RETURN v_absent; END IF;

        IF EXISTS (
          WITH events AS MATERIALIZED (
            SELECT e.value FROM jsonb_array_elements(v_fragments) f(value)
            CROSS JOIN LATERAL jsonb_array_elements(f.value->'events') e(value)
          ), links AS MATERIALIZED (
            SELECT p.value AS link FROM events e CROSS JOIN LATERAL jsonb_array_elements(e.value->'postings') p(value)
            UNION
            SELECT m.value->'posting' FROM events e
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.value->'money','[]'::jsonb)) m(value)
          ), parsed AS (
            SELECT link->>'namespace' AS source_namespace,
              CASE WHEN (link->>'rowId') ~ '^[1-9][0-9]{0,18}$' THEN
                CASE WHEN (link->>'rowId')::numeric<=9223372036854775807 THEN (link->>'rowId')::bigint END END AS row_id
            FROM links
          )
          SELECT 1 FROM parsed p WHERE NOT EXISTS (
            SELECT 1 FROM ${refs} r JOIN ${acl} acl ON acl.operator_name=session_user
              AND acl.dataset_id=r.dataset_id AND acl.source_namespace=r.source_namespace
            WHERE r.dataset_id=j.dataset_id AND r.source_namespace=p.source_namespace AND r.source_row_id=p.row_id
              AND ((r.source_namespace=${demo} AND EXISTS (
                SELECT 1 FROM ${g}.demo_ledger l WHERE ${demoPosting} AND
                  (v_category='pvp' AND l.source='pvp:'||v_game AND l.operation_id IN ${pvpKeys}
                   OR v_category='totalizator' AND l.source='flag-tote' AND ${toteRelation}
                   OR v_category='casino' AND l.account_id=v_account AND l.source=v_game AND
                    (l.operation_id=v_entity OR EXISTS (SELECT 1 FROM ${g}.demo_casino_requests q
                      WHERE q.account_id=l.account_id AND q.id=l.operation_id AND q.session_id=v_entity)))
              )) ${extraChecks})
          )
        ) THEN RETURN v_absent; END IF;
        IF EXISTS (
          SELECT 1 FROM ${a}.audit_replay_fragments f
          WHERE f.dataset_id=j.dataset_id AND f.replay_id=v_replay_id AND (
            jsonb_typeof(f.fragment->'index') IS DISTINCT FROM 'number'
            OR f.fragment->>'index' IS DISTINCT FROM f.ordinal::text
            OR f.fragment #>> '{scope,datasetId}' IS DISTINCT FROM j.dataset_id::text
            OR f.fragment #>> '{scope,environment}' IS DISTINCT FROM j.environment
            OR f.fragment->>'replayId' IS DISTINCT FROM v_replay_id::text
          )
        ) THEN RETURN '{"status":"corrupt"}'::jsonb; END IF;
        RETURN jsonb_build_object('status','candidate','manifest',v_manifest,'fragments',v_fragments);
      END
      $replay_projection$;
      REVOKE ALL ON FUNCTION ${projection}(uuid) FROM PUBLIC,${reader};

      CREATE OR REPLACE FUNCTION ${fn}(p_job uuid) RETURNS jsonb
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $replay_report$
      DECLARE j record;
      BEGIN
        IF current_setting('transaction_isolation')<>'read committed' OR pg_current_xact_id_if_assigned() IS NOT NULL THEN
          RAISE EXCEPTION 'Audit report requires a separate committed job' USING ERRCODE='42501';
        END IF;
        ${authorizeJob}
        ${auditExportReaderSlotGuard(db.schema)}
        RETURN ${projection}(p_job);
      END
      $replay_report$;
      REVOKE ALL ON FUNCTION ${fn}(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${fn}(uuid) TO ${reader}`);
  }, { lockKey: 'audit-report-replay-install' });
}
