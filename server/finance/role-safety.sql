CREATE OR REPLACE FUNCTION royal_finance.role_safety(login text, profile text) RETURNS integer
LANGUAGE sql STABLE SET search_path=pg_catalog,royal_finance,pg_temp AS $$
  WITH reachable AS (
    SELECT r.* FROM pg_roles r WHERE r.rolname=login OR pg_has_role(login,r.oid,'MEMBER')
  ), required AS (
    SELECT unnest(CASE profile WHEN 'runtime' THEN ARRAY['royal_finance.execute(text,uuid,text,jsonb)','royal_finance.create_user(text)'] ||
      CASE WHEN (SELECT version FROM royal_finance.meta)>=2 THEN ARRAY['royal_finance.deposit_address(text)'] ELSE ARRAY[]::text[] END
      WHEN 'observer' THEN ARRAY['royal_finance.ingest_deposit_block(jsonb,jsonb)','royal_finance.halt_deposit_stream()']
      ELSE ARRAY[]::text[] END || CASE WHEN (SELECT version FROM royal_finance.meta)>=3
        THEN ARRAY['royal_finance.role_safety(text,text)'] ELSE ARRAY[]::text[] END) AS signature
  ), violations AS (
    SELECT 1 FROM reachable r WHERE r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
      OR r.rolname IN ('pg_read_server_files','pg_write_server_files','pg_execute_server_program')
      OR has_schema_privilege(r.rolname,'royal_finance','CREATE')
      OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='royal_finance' AND c.relkind IN ('r','p') AND
          (has_table_privilege(r.rolname,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR
           has_any_column_privilege(r.rolname,c.oid,'INSERT,UPDATE')))
      OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='royal_finance' AND p.oid NOT IN
          (SELECT to_regprocedure(signature) FROM required WHERE to_regprocedure(signature) IS NOT NULL)
          AND has_function_privilege(r.rolname,p.oid,'EXECUTE'))
    UNION ALL SELECT 1 WHERE profile NOT IN ('runtime','observer') OR profile IS NULL
    UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname=login AND rolcanlogin)
    UNION ALL SELECT 1 WHERE NOT has_schema_privilege(login,'royal_finance','USAGE')
    UNION ALL SELECT 1 WHERE NOT pg_has_role(login,
      CASE profile WHEN 'runtime' THEN 'royal_finance_runtime' ELSE 'royal_finance_observer' END,'USAGE')
    UNION ALL SELECT 1 FROM required WHERE to_regprocedure(signature) IS NULL
      OR NOT has_function_privilege(login,to_regprocedure(signature),'EXECUTE')
  ) SELECT count(*)::integer FROM violations;
$$;
REVOKE ALL ON FUNCTION royal_finance.role_safety(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION royal_finance.role_safety(text,text) TO royal_finance_runtime;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='royal_finance_observer') THEN
    GRANT EXECUTE ON FUNCTION royal_finance.role_safety(text,text) TO royal_finance_observer;
  END IF;
END $$;
