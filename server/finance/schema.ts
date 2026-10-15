// This schema is deliberately limited to simulated funds and has no signing capability.
export const FINANCE_SCHEMA_VERSION = 3;
export const FINANCE_SCHEMA = String.raw`
CREATE SCHEMA royal_finance;
REVOKE ALL ON SCHEMA royal_finance FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'royal_finance_runtime') THEN
    CREATE ROLE royal_finance_runtime NOLOGIN;
  END IF;
END $$;

CREATE TABLE royal_finance.meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version = 1),
  environment text NOT NULL CHECK (environment = 'simulation'),
  asset text NOT NULL CHECK (asset = 'USDT_SIM'),
  scale integer NOT NULL CHECK (scale = 6)
);
INSERT INTO royal_finance.meta VALUES (true, 1, 'simulation', 'USDT_SIM', 6);

CREATE TABLE royal_finance.users (
  id text PRIMARY KEY CHECK (id ~ '^[a-zA-Z0-9_-]{1,128}$' AND id NOT IN ('system','simulator','game-simulator')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE royal_finance.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('available','withdrawal_reserved','game_reserved','assets','house_available','house_reserved')),
  balance numeric(78,0) NOT NULL DEFAULT 0,
  UNIQUE (owner_id,bucket),
  CHECK (abs(balance) <= 1000000000000000000000000000000),
  CHECK (bucket = 'assets' OR balance >= 0),
  CHECK ((owner_id = 'system') = (bucket IN ('assets','house_available','house_reserved')))
);
INSERT INTO royal_finance.accounts (owner_id,bucket) VALUES
  ('system','assets'),('system','house_available'),('system','house_reserved');
CREATE TABLE royal_finance.journals (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  source text NOT NULL UNIQUE,
  write_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE royal_finance.entries (
  journal_id uuid NOT NULL REFERENCES royal_finance.journals(id),
  position integer NOT NULL CHECK (position >= 0),
  account_id uuid NOT NULL REFERENCES royal_finance.accounts(id),
  delta numeric(78,0) NOT NULL CHECK (delta <> 0 AND abs(delta) <= 1000000000000000000000000000000),
  PRIMARY KEY (journal_id,position)
);
CREATE INDEX entries_account ON royal_finance.entries(account_id);
CREATE TABLE royal_finance.requests (
  actor text NOT NULL,
  key uuid NOT NULL,
  kind text NOT NULL,
  body jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor,key)
);
CREATE TABLE royal_finance.withdrawals (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES royal_finance.users(id),
  destination text NOT NULL CHECK (destination ~ '^simulation:[a-zA-Z0-9_-]{1,100}$'),
  amount numeric(78,0) NOT NULL CHECK (amount > 0),
  fee numeric(78,0) NOT NULL CHECK (fee >= 0),
  status text NOT NULL CHECK (status IN ('reserved','unknown','cancelled','confirmed')),
  reserve_journal uuid NOT NULL UNIQUE REFERENCES royal_finance.journals(id),
  final_journal uuid UNIQUE REFERENCES royal_finance.journals(id)
);
CREATE TABLE royal_finance.rounds (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES royal_finance.users(id),
  stake numeric(78,0) NOT NULL CHECK (stake > 0),
  max_payout numeric(78,0) NOT NULL CHECK (max_payout > 0),
  payout numeric(78,0) CHECK (payout >= 0 AND payout <= max_payout),
  status text NOT NULL CHECK (status IN ('reserved','cancelled','settled')),
  reserve_journal uuid NOT NULL UNIQUE REFERENCES royal_finance.journals(id),
  final_journal uuid UNIQUE REFERENCES royal_finance.journals(id)
);
CREATE TABLE royal_finance.outbox (
  id uuid PRIMARY KEY,
  actor text NOT NULL,
  request_key uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (actor,request_key),
  FOREIGN KEY (actor,request_key) REFERENCES royal_finance.requests(actor,key)
);

CREATE FUNCTION royal_finance.reject_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, royal_finance AS $$
BEGIN RAISE EXCEPTION 'Financial history is append only' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER immutable_journals BEFORE UPDATE OR DELETE ON royal_finance.journals
  FOR EACH ROW EXECUTE FUNCTION royal_finance.reject_history_change();
CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON royal_finance.entries
  FOR EACH ROW EXECUTE FUNCTION royal_finance.reject_history_change();
CREATE TRIGGER immutable_requests BEFORE UPDATE OR DELETE ON royal_finance.requests
  FOR EACH ROW EXECUTE FUNCTION royal_finance.reject_history_change();
CREATE TRIGGER immutable_outbox BEFORE UPDATE OR DELETE ON royal_finance.outbox
  FOR EACH ROW EXECUTE FUNCTION royal_finance.reject_history_change();

CREATE FUNCTION royal_finance.prevent_late_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, royal_finance AS $$
BEGIN
  IF (SELECT write_xid FROM royal_finance.journals WHERE id = NEW.journal_id) IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'Cannot append to a committed journal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sealed_entries BEFORE INSERT ON royal_finance.entries
  FOR EACH ROW EXECUTE FUNCTION royal_finance.prevent_late_entry();

CREATE FUNCTION royal_finance.check_journal() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, royal_finance AS $$
DECLARE n integer; total numeric;
BEGIN
  SELECT count(*), coalesce(sum(delta),0) INTO n,total FROM royal_finance.entries WHERE journal_id = NEW.id;
  IF n < 2 OR total <> 0 THEN
    RAISE EXCEPTION 'Unbalanced journal' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT ON royal_finance.journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION royal_finance.check_journal();

CREATE FUNCTION royal_finance.check_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, royal_finance AS $$
DECLARE actual numeric; expected numeric;
BEGIN
  SELECT balance INTO actual FROM royal_finance.accounts WHERE id = NEW.id;
  SELECT coalesce(sum(delta),0) INTO expected FROM royal_finance.entries WHERE account_id = NEW.id;
  IF actual <> expected THEN
    RAISE EXCEPTION 'Balance does not match journal' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reconciled_account AFTER INSERT OR UPDATE ON royal_finance.accounts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION royal_finance.check_account();

CREATE FUNCTION royal_finance.read_amount(value jsonb, allow_zero boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql SET search_path = pg_catalog, royal_finance AS $$
DECLARE amount numeric;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value #>> '{}') !~ '^(0|[1-9][0-9]{0,30})$' THEN
    RAISE EXCEPTION 'Amount must be an integer string' USING ERRCODE = 'P4000';
  END IF;
  amount := (value #>> '{}')::numeric;
  IF amount > 1000000000000000000000000000000 OR amount < 0 OR (amount = 0 AND NOT allow_zero) THEN
    RAISE EXCEPTION 'Invalid amount' USING ERRCODE = 'P4000';
  END IF;
  RETURN amount;
END $$;

CREATE FUNCTION royal_finance.create_user(user_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, royal_finance AS $$
BEGIN
  INSERT INTO royal_finance.users(id) VALUES (user_id) ON CONFLICT DO NOTHING;
  INSERT INTO royal_finance.accounts(owner_id,bucket)
    SELECT user_id, unnest(ARRAY['available','withdrawal_reserved','game_reserved']) ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION royal_finance.account_id(owner text, account_bucket text) RETURNS uuid
LANGUAGE plpgsql SET search_path = pg_catalog, royal_finance AS $$
DECLARE found uuid;
BEGIN
  SELECT id INTO found FROM royal_finance.accounts WHERE owner_id = owner AND bucket = account_bucket;
  IF found IS NULL THEN RAISE EXCEPTION 'Financial account not found' USING ERRCODE = 'P4040'; END IF;
  RETURN found;
END $$;

CREATE FUNCTION royal_finance.post_journal(journal uuid, journal_kind text, journal_source text, account_ids uuid[], deltas numeric[])
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, royal_finance AS $$
DECLARE entry_count integer; total numeric; bad boolean;
BEGIN
  entry_count := cardinality(account_ids);
  SELECT coalesce(sum(d),0),coalesce(bool_or(d IS NULL),false) INTO total,bad FROM unnest(deltas) d;
  IF entry_count < 2 OR entry_count IS DISTINCT FROM cardinality(deltas) OR total <> 0 OR bad THEN
    RAISE EXCEPTION 'Invalid journal entries' USING ERRCODE = '23514';
  END IF;
  PERFORM id FROM royal_finance.accounts WHERE id = ANY(account_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM royal_finance.accounts WHERE id = ANY(account_ids)) <
     (SELECT count(DISTINCT id) FROM unnest(account_ids) id) THEN
    RAISE EXCEPTION 'Financial account not found' USING ERRCODE = 'P4040';
  END IF;
  IF EXISTS (
    SELECT FROM royal_finance.accounts a
    JOIN (SELECT account_ids[i] AS id,sum(deltas[i]) AS delta FROM generate_subscripts(account_ids,1) i GROUP BY account_ids[i]) d USING (id)
    WHERE (a.bucket <> 'assets' AND a.balance + d.delta < 0)
       OR abs(a.balance + d.delta) > 1000000000000000000000000000000
  ) THEN RAISE EXCEPTION 'Insufficient funds or account limit' USING ERRCODE = 'P4090'; END IF;
  INSERT INTO royal_finance.journals(id,kind,source) VALUES (journal,journal_kind,journal_source);
  INSERT INTO royal_finance.entries(journal_id,position,account_id,delta)
    SELECT journal,i - 1,account_ids[i],deltas[i] FROM generate_subscripts(account_ids,1) i WHERE deltas[i] <> 0;
  UPDATE royal_finance.accounts a SET balance = a.balance + d.delta
    FROM (SELECT account_ids[i] AS id,sum(deltas[i]) AS delta FROM generate_subscripts(account_ids,1) i GROUP BY account_ids[i]) d
    WHERE a.id = d.id;
END $$;

CREATE FUNCTION royal_finance.execute(actor text, request_key uuid, operation_kind text, request_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, royal_finance AS $$
DECLARE
  prior royal_finance.requests%ROWTYPE;
  w royal_finance.withdrawals%ROWTYPE;
  r royal_finance.rounds%ROWTYPE;
  result_body jsonb;
  journal uuid := gen_random_uuid();
  operation_id uuid := gen_random_uuid();
  amount numeric; fee numeric; max_payout numeric;
  source text := actor || ':' || request_key::text;
  required_fields text[];
BEGIN
  IF actor IS NULL OR actor !~ '^[a-zA-Z0-9_-]{1,128}$' OR request_key IS NULL THEN
    RAISE EXCEPTION 'Invalid actor or idempotency key' USING ERRCODE = 'P4000';
  END IF;
  IF jsonb_typeof(request_body) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid request body' USING ERRCODE = 'P4000';
  END IF;
  required_fields := CASE operation_kind
    WHEN 'simulate_deposit' THEN ARRAY['userId','eventId','amountUnits']
    WHEN 'simulate_capital' THEN ARRAY['amountUnits']
    WHEN 'transfer' THEN ARRAY['recipientId','amountUnits']
    WHEN 'reserve_withdrawal' THEN ARRAY['withdrawalId','destination','amountUnits','feeUnits']
    WHEN 'cancel_withdrawal' THEN ARRAY['withdrawalId']
    WHEN 'simulate_withdrawal_unknown' THEN ARRAY['withdrawalId']
    WHEN 'simulate_withdrawal_confirm' THEN ARRAY['withdrawalId']
    WHEN 'reserve_game' THEN ARRAY['roundId','stakeUnits','maxPayoutUnits']
    WHEN 'settle_game' THEN ARRAY['roundId','payoutUnits']
    WHEN 'cancel_game' THEN ARRAY['roundId']
    ELSE NULL END;
  IF required_fields IS NULL OR NOT request_body ?& required_fields OR
     EXISTS (SELECT FROM jsonb_object_keys(request_body) k WHERE NOT k = ANY(required_fields)) OR
     EXISTS (SELECT FROM jsonb_each(request_body) kv WHERE jsonb_typeof(kv.value) <> 'string') THEN
    RAISE EXCEPTION 'Invalid operation fields' USING ERRCODE = 'P4000';
  END IF;
  IF (operation_kind LIKE 'simulate_%' AND actor <> 'simulator') OR
     (operation_kind IN ('settle_game','cancel_game') AND actor <> 'game-simulator') OR
     (operation_kind IN ('transfer','reserve_withdrawal','cancel_withdrawal','reserve_game') AND
      NOT EXISTS (SELECT FROM royal_finance.users WHERE id = actor)) THEN
    RAISE EXCEPTION 'Actor cannot perform this operation' USING ERRCODE = 'P4030';
  END IF;

  -- Serialize only identical keys. Account locks handle unrelated competing debits.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor || ':' || request_key::text,0));
  SELECT * INTO prior FROM royal_finance.requests q WHERE q.actor = execute.actor AND q.key = request_key;
  IF FOUND THEN
    IF prior.kind <> operation_kind OR prior.body <> request_body THEN
      RAISE EXCEPTION 'Idempotency key reused with different parameters' USING ERRCODE = 'P4090';
    END IF;
    RETURN prior.result;
  END IF;

  CASE operation_kind
    WHEN 'simulate_deposit' THEN
      amount := royal_finance.read_amount(request_body->'amountUnits');
      source := 'simulation-deposit:' || (request_body->>'eventId')::uuid::text;
      PERFORM royal_finance.post_journal(journal,operation_kind,source,
        ARRAY[royal_finance.account_id('system','assets'),royal_finance.account_id(request_body->>'userId','available')],ARRAY[-amount,amount]);
    WHEN 'simulate_capital' THEN
      amount := royal_finance.read_amount(request_body->'amountUnits');
      PERFORM royal_finance.post_journal(journal,operation_kind,source,
        ARRAY[royal_finance.account_id('system','assets'),royal_finance.account_id('system','house_available')],ARRAY[-amount,amount]);
    WHEN 'transfer' THEN
      amount := royal_finance.read_amount(request_body->'amountUnits');
      IF actor = request_body->>'recipientId' THEN RAISE EXCEPTION 'Self transfer is not allowed' USING ERRCODE = 'P4000'; END IF;
      PERFORM royal_finance.post_journal(journal,operation_kind,source,
        ARRAY[royal_finance.account_id(actor,'available'),royal_finance.account_id(request_body->>'recipientId','available')],ARRAY[-amount,amount]);
    WHEN 'reserve_withdrawal' THEN
      amount := royal_finance.read_amount(request_body->'amountUnits');
      fee := royal_finance.read_amount(request_body->'feeUnits',true);
      PERFORM royal_finance.post_journal(journal,operation_kind,source,
        ARRAY[royal_finance.account_id(actor,'available'),royal_finance.account_id(actor,'withdrawal_reserved')],ARRAY[-amount-fee,amount+fee]);
      INSERT INTO royal_finance.withdrawals(id,user_id,destination,amount,fee,status,reserve_journal)
        VALUES ((request_body->>'withdrawalId')::uuid,actor,request_body->>'destination',amount,fee,'reserved',journal);
    WHEN 'cancel_withdrawal','simulate_withdrawal_unknown','simulate_withdrawal_confirm' THEN
      SELECT * INTO w FROM royal_finance.withdrawals WHERE id = (request_body->>'withdrawalId')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found' USING ERRCODE = 'P4040'; END IF;
      IF operation_kind = 'cancel_withdrawal' THEN
        IF w.user_id <> actor THEN RAISE EXCEPTION 'Withdrawal belongs to another user' USING ERRCODE = 'P4030'; END IF;
        IF w.status <> 'reserved' THEN RAISE EXCEPTION 'Withdrawal cannot be cancelled' USING ERRCODE = 'P4090'; END IF;
        PERFORM royal_finance.post_journal(journal,operation_kind,source,
          ARRAY[royal_finance.account_id(actor,'withdrawal_reserved'),royal_finance.account_id(actor,'available')],ARRAY[-w.amount-w.fee,w.amount+w.fee]);
        UPDATE royal_finance.withdrawals SET status = 'cancelled',final_journal = journal WHERE id = w.id;
      ELSIF operation_kind = 'simulate_withdrawal_unknown' THEN
        IF w.status <> 'reserved' THEN RAISE EXCEPTION 'Withdrawal already submitted or final' USING ERRCODE = 'P4090'; END IF;
        journal := NULL;
        UPDATE royal_finance.withdrawals SET status = 'unknown' WHERE id = w.id;
      ELSE
        IF w.status NOT IN ('reserved','unknown') THEN RAISE EXCEPTION 'Withdrawal is final' USING ERRCODE = 'P4090'; END IF;
        PERFORM royal_finance.post_journal(journal,operation_kind,'simulation-withdrawal:' || w.id::text,
          ARRAY[royal_finance.account_id(w.user_id,'withdrawal_reserved'),royal_finance.account_id('system','assets'),royal_finance.account_id('system','house_available')],
          ARRAY[-w.amount-w.fee,w.amount,w.fee]);
        UPDATE royal_finance.withdrawals SET status = 'confirmed',final_journal = journal WHERE id = w.id;
      END IF;
    WHEN 'reserve_game' THEN
      amount := royal_finance.read_amount(request_body->'stakeUnits');
      max_payout := royal_finance.read_amount(request_body->'maxPayoutUnits');
      PERFORM royal_finance.post_journal(journal,operation_kind,source,
        ARRAY[royal_finance.account_id(actor,'available'),royal_finance.account_id(actor,'game_reserved'),
          royal_finance.account_id('system','house_available'),royal_finance.account_id('system','house_reserved')],
        ARRAY[-amount,amount,-max_payout,max_payout]);
      INSERT INTO royal_finance.rounds(id,user_id,stake,max_payout,status,reserve_journal)
        VALUES ((request_body->>'roundId')::uuid,actor,amount,max_payout,'reserved',journal);
    WHEN 'settle_game','cancel_game' THEN
      SELECT * INTO r FROM royal_finance.rounds WHERE id = (request_body->>'roundId')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Round not found' USING ERRCODE = 'P4040'; END IF;
      IF r.status <> 'reserved' THEN RAISE EXCEPTION 'Round is final' USING ERRCODE = 'P4090'; END IF;
      IF operation_kind = 'cancel_game' THEN
        PERFORM royal_finance.post_journal(journal,operation_kind,source,
          ARRAY[royal_finance.account_id(r.user_id,'game_reserved'),royal_finance.account_id(r.user_id,'available'),
            royal_finance.account_id('system','house_reserved'),royal_finance.account_id('system','house_available')],
          ARRAY[-r.stake,r.stake,-r.max_payout,r.max_payout]);
        UPDATE royal_finance.rounds SET status = 'cancelled',final_journal = journal WHERE id = r.id;
      ELSE
        amount := royal_finance.read_amount(request_body->'payoutUnits',true);
        IF amount > r.max_payout THEN RAISE EXCEPTION 'Payout exceeds reserved coverage' USING ERRCODE = 'P4090'; END IF;
        PERFORM royal_finance.post_journal(journal,operation_kind,source,
          ARRAY[royal_finance.account_id(r.user_id,'game_reserved'),royal_finance.account_id('system','house_available'),
            royal_finance.account_id('system','house_reserved'),royal_finance.account_id('system','house_available'),
            royal_finance.account_id('system','house_available'),royal_finance.account_id(r.user_id,'available')],
          ARRAY[-r.stake,r.stake,-r.max_payout,r.max_payout,-amount,amount]);
        UPDATE royal_finance.rounds SET status = 'settled',payout = amount,final_journal = journal WHERE id = r.id;
      END IF;
  END CASE;
  result_body := jsonb_build_object('operationId',operation_id,'journalId',journal,'kind',operation_kind,'asset','USDT_SIM','environment','simulation');
  INSERT INTO royal_finance.requests(actor,key,kind,body,result) VALUES (actor,request_key,operation_kind,request_body,result_body);
  INSERT INTO royal_finance.outbox(id,actor,request_key,kind,payload) VALUES (operation_id,actor,request_key,operation_kind,result_body);
  RETURN result_body;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA royal_finance FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA royal_finance FROM PUBLIC;
GRANT USAGE ON SCHEMA royal_finance TO royal_finance_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA royal_finance TO royal_finance_runtime;
GRANT EXECUTE ON FUNCTION royal_finance.create_user(text) TO royal_finance_runtime;
GRANT EXECUTE ON FUNCTION royal_finance.execute(text,uuid,text,jsonb) TO royal_finance_runtime;
`;
