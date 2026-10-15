// Migration for a closed simulation lab. It does not recognize real TRON addresses or tokens.
export const FINANCE_DEPOSIT_MIGRATION = String.raw`
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='royal_finance_observer') THEN
    CREATE ROLE royal_finance_observer NOLOGIN;
  END IF;
END $$;
-- Deferred checks run after a security-definer command returns to the observer role.
ALTER FUNCTION royal_finance.check_journal() SECURITY DEFINER;
ALTER FUNCTION royal_finance.check_account() SECURITY DEFINER;
CREATE TABLE royal_finance.deposit_streams (
  network text PRIMARY KEY CHECK (network='tron-sim-v1'),
  token text NOT NULL CHECK (token='simulation:usdt-test-v1'),
  scale integer NOT NULL CHECK (scale=6),
  cursor_height bigint NOT NULL CHECK (cursor_height>=0),
  cursor_hash text NOT NULL CHECK (cursor_hash ~ '^[a-f0-9]{64}$'),
  halted_reason text CHECK (halted_reason='finalized_block_changed')
);
INSERT INTO royal_finance.deposit_streams VALUES
  ('tron-sim-v1','simulation:usdt-test-v1',6,0,repeat('0',64),NULL);
CREATE TABLE royal_finance.deposit_addresses (
  network text NOT NULL REFERENCES royal_finance.deposit_streams(network),
  user_id text NOT NULL REFERENCES royal_finance.users(id),
  address text NOT NULL UNIQUE CHECK (address ~ '^simulation:tron-deposit:[a-f0-9]{32}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (network,user_id)
);
CREATE TABLE royal_finance.deposit_blocks (
  network text NOT NULL REFERENCES royal_finance.deposit_streams(network),
  height bigint NOT NULL CHECK (height>0),
  hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  sources jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (network,height)
);
CREATE TABLE royal_finance.deposit_events (
  network text NOT NULL,
  tx_id text NOT NULL CHECK (tx_id ~ '^[a-f0-9]{64}$'),
  log_index integer NOT NULL CHECK (log_index>=0),
  height bigint NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('credited','unsupported_token','failed_execution',
    'wrong_scale','unknown_recipient','internal_transfer','invalid_amount')),
  user_id text REFERENCES royal_finance.users(id),
  amount numeric(78,0),
  request_key uuid,
  actor text GENERATED ALWAYS AS ('simulator') STORED,
  PRIMARY KEY (network,tx_id,log_index),
  FOREIGN KEY (network,height) REFERENCES royal_finance.deposit_blocks(network,height) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (actor,request_key) REFERENCES royal_finance.requests(actor,key),
  CHECK ((disposition='credited')=(request_key IS NOT NULL)),
  CHECK (disposition<>'credited' OR (amount>0 AND user_id IS NOT NULL AND request_key=event_id))
);
CREATE TRIGGER immutable_deposit_addresses BEFORE UPDATE OR DELETE ON royal_finance.deposit_addresses
  FOR EACH ROW EXECUTE FUNCTION royal_finance.reject_history_change();
CREATE TRIGGER immutable_deposit_blocks BEFORE UPDATE OR DELETE ON royal_finance.deposit_blocks
  FOR EACH ROW EXECUTE FUNCTION royal_finance.reject_history_change();
CREATE TRIGGER immutable_deposit_events BEFORE UPDATE OR DELETE ON royal_finance.deposit_events
  FOR EACH ROW EXECUTE FUNCTION royal_finance.reject_history_change();

CREATE FUNCTION royal_finance.deposit_address(requested_user text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,royal_finance AS $$
DECLARE assigned text;
BEGIN
  IF NOT EXISTS (SELECT FROM royal_finance.users WHERE id=requested_user) THEN
    RAISE EXCEPTION 'User missing' USING ERRCODE='P4040';
  END IF;
  INSERT INTO royal_finance.deposit_addresses(network,user_id,address)
    VALUES ('tron-sim-v1',requested_user,'simulation:tron-deposit:'||replace(gen_random_uuid()::text,'-',''))
    ON CONFLICT (network,user_id) DO NOTHING;
  SELECT address INTO assigned FROM royal_finance.deposit_addresses WHERE network='tron-sim-v1' AND user_id=requested_user;
  RETURN jsonb_build_object('network','tron-sim-v1','address',assigned,'asset','USDT_SIM',
    'token','simulation:usdt-test-v1','scale',6,'environment','simulation');
END $$;

CREATE FUNCTION royal_finance.halt_deposit_stream() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,royal_finance AS $$
  UPDATE royal_finance.deposit_streams SET halted_reason='finalized_block_changed' WHERE network='tron-sim-v1';
$$;

CREATE FUNCTION royal_finance.ingest_deposit_block(block jsonb, source_ids jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,royal_finance AS $$
DECLARE stream royal_finance.deposit_streams%ROWTYPE; previous royal_finance.deposit_blocks%ROWTYPE;
  saved_event royal_finance.deposit_events%ROWTYPE;
  event jsonb; block_height bigint; event_id uuid; recipient text; disposition text; amount numeric;
  credit jsonb; credited integer:=0; ignored integer:=0; result jsonb;
BEGIN
  IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR
    (SELECT count(*) FROM jsonb_object_keys(block))<>5 OR
    NOT block ?& ARRAY['network','height','hash','parentHash','events'] OR
    block->>'network' IS DISTINCT FROM 'tron-sim-v1' OR
    jsonb_typeof(block->'height') IS DISTINCT FROM 'number' OR (block->>'height') !~ '^[1-9][0-9]{0,14}$' OR
    jsonb_typeof(block->'hash') IS DISTINCT FROM 'string' OR (block->>'hash') !~ '^[a-f0-9]{64}$' OR
    jsonb_typeof(block->'parentHash') IS DISTINCT FROM 'string' OR (block->>'parentHash') !~ '^[a-f0-9]{64}$' OR
    jsonb_typeof(block->'events') IS DISTINCT FROM 'array' OR jsonb_array_length(block->'events')>100 OR
    jsonb_typeof(source_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(source_ids)<>2 OR
    jsonb_typeof(source_ids->0) IS DISTINCT FROM 'string' OR jsonb_typeof(source_ids->1) IS DISTINCT FROM 'string' OR
    source_ids->>0 IS NOT DISTINCT FROM source_ids->>1 OR
    (source_ids->>0) !~ '^[a-zA-Z0-9_-]{1,100}$' OR (source_ids->>1) !~ '^[a-zA-Z0-9_-]{1,100}$' THEN
    RAISE EXCEPTION 'Invalid simulation block' USING ERRCODE='P4000';
  END IF;
  block_height:=(block->>'height')::bigint;
  SELECT * INTO stream FROM royal_finance.deposit_streams WHERE network='tron-sim-v1' FOR UPDATE;
  IF stream.halted_reason IS NOT NULL THEN
    RETURN jsonb_build_object('halted',true,'reason',stream.halted_reason);
  END IF;
  IF block_height<=stream.cursor_height THEN
    SELECT * INTO previous FROM royal_finance.deposit_blocks WHERE network=stream.network AND height=block_height;
    IF NOT FOUND OR previous.payload<>block THEN
      PERFORM royal_finance.halt_deposit_stream();
      RETURN jsonb_build_object('halted',true,'reason','finalized_block_changed');
    END IF;
    RETURN previous.result||jsonb_build_object('replayed',true);
  END IF;
  IF block_height<>stream.cursor_height+1 OR block->>'parentHash'<>stream.cursor_hash THEN
    RAISE EXCEPTION 'Block gap or wrong parent' USING ERRCODE='P4090';
  END IF;
  FOR event IN SELECT value FROM jsonb_array_elements(block->'events') LOOP
    IF jsonb_typeof(event) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(event))<>9 OR
      NOT event ?& ARRAY['txId','logIndex','contract','from','to','amountUnits','scale','success','symbol'] OR
      jsonb_typeof(event->'txId') IS DISTINCT FROM 'string' OR (event->>'txId') !~ '^[a-f0-9]{64}$' OR
      jsonb_typeof(event->'logIndex') IS DISTINCT FROM 'number' OR (event->>'logIndex') !~ '^(0|[1-9][0-9]{0,7})$' OR
      jsonb_typeof(event->'success') IS DISTINCT FROM 'boolean' OR
      jsonb_typeof(event->'scale') IS DISTINCT FROM 'number' OR (event->>'scale') !~ '^(0|[1-9][0-9]?)$' OR
      jsonb_typeof(event->'amountUnits') IS DISTINCT FROM 'string' OR length(event->>'amountUnits')>100 OR
      jsonb_typeof(event->'symbol') IS DISTINCT FROM 'string' OR length(event->>'symbol')>32 OR
      EXISTS (SELECT FROM unnest(ARRAY['contract','from','to']) field
        WHERE jsonb_typeof(event->field) IS DISTINCT FROM 'string' OR (event->>field) !~ '^simulation:[a-zA-Z0-9:_-]{1,120}$') THEN
      RAISE EXCEPTION 'Invalid simulation event' USING ERRCODE='P4000';
    END IF;
    SELECT * INTO saved_event FROM royal_finance.deposit_events
      WHERE network=stream.network AND tx_id=event->>'txId' AND log_index=(event->>'logIndex')::integer;
    IF FOUND THEN
      IF saved_event.height<>block_height OR saved_event.payload<>event THEN
        RAISE EXCEPTION 'Conflicting event identity' USING ERRCODE='P4090';
      END IF;
      CONTINUE;
    END IF;
    recipient:=NULL; amount:=NULL; credit:=NULL; disposition:='credited';
    SELECT user_id INTO recipient FROM royal_finance.deposit_addresses WHERE network=stream.network AND address=event->>'to';
    IF event->>'contract'<>stream.token THEN disposition:='unsupported_token';
    ELSIF NOT (event->>'success')::boolean THEN disposition:='failed_execution';
    ELSIF (event->>'scale')::integer<>stream.scale THEN disposition:='wrong_scale';
    ELSIF recipient IS NULL THEN disposition:='unknown_recipient';
    ELSIF event->>'from' IN ('simulation:tron-reserve','simulation:tron-hot') OR
      EXISTS (SELECT FROM royal_finance.deposit_addresses WHERE address=event->>'from') THEN disposition:='internal_transfer';
    ELSE
      BEGIN amount:=royal_finance.read_amount(event->'amountUnits');
      EXCEPTION WHEN SQLSTATE 'P4000' THEN disposition:='invalid_amount'; END;
    END IF;
    event_id:=gen_random_uuid();
    IF disposition='credited' THEN
      credit:=royal_finance.execute('simulator',event_id,'simulate_deposit',
        jsonb_build_object('userId',recipient,'eventId',event_id::text,'amountUnits',amount::text));
      credited:=credited+1;
    ELSE ignored:=ignored+1;
    END IF;
    INSERT INTO royal_finance.deposit_events(network,tx_id,log_index,height,event_id,payload,disposition,user_id,amount,request_key)
      VALUES (stream.network,event->>'txId',(event->>'logIndex')::integer,block_height,event_id,event,disposition,recipient,amount,
        CASE WHEN credit IS NOT NULL THEN event_id ELSE NULL END);
  END LOOP;
  result:=jsonb_build_object('height',block_height,'hash',block->>'hash','credited',credited,'ignored',ignored,'replayed',false);
  INSERT INTO royal_finance.deposit_blocks(network,height,hash,payload,sources,result)
    VALUES (stream.network,block_height,block->>'hash',block,source_ids,result);
  UPDATE royal_finance.deposit_streams SET cursor_height=block_height,cursor_hash=block->>'hash' WHERE network=stream.network;
  RETURN result;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA royal_finance FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA royal_finance FROM PUBLIC;
GRANT SELECT ON royal_finance.deposit_streams,royal_finance.deposit_addresses,
  royal_finance.deposit_blocks,royal_finance.deposit_events TO royal_finance_runtime;
GRANT EXECUTE ON FUNCTION royal_finance.deposit_address(text) TO royal_finance_runtime;
GRANT USAGE ON SCHEMA royal_finance TO royal_finance_observer;
GRANT SELECT ON royal_finance.meta,royal_finance.deposit_streams TO royal_finance_observer;
GRANT EXECUTE ON FUNCTION royal_finance.ingest_deposit_block(jsonb,jsonb),royal_finance.halt_deposit_stream() TO royal_finance_observer;
ALTER TABLE royal_finance.meta DROP CONSTRAINT meta_version_check;
UPDATE royal_finance.meta SET version=2;
ALTER TABLE royal_finance.meta ADD CONSTRAINT meta_version_check CHECK (version=2);
`;
