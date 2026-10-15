export const FINANCE_HARDENING_MIGRATION = String.raw`
LOCK TABLE royal_finance.accounts,royal_finance.entries,royal_finance.journals IN ACCESS EXCLUSIVE MODE;
CREATE TABLE royal_finance.account_totals (
  account_id uuid PRIMARY KEY REFERENCES royal_finance.accounts(id),
  balance numeric(78,0) NOT NULL
);
INSERT INTO royal_finance.account_totals(account_id,balance)
  SELECT a.id,coalesce(e.total,0) FROM royal_finance.accounts a LEFT JOIN
    (SELECT account_id,sum(delta) AS total FROM royal_finance.entries GROUP BY account_id) e ON e.account_id=a.id;
DO $$ BEGIN
  IF EXISTS (SELECT FROM royal_finance.accounts a JOIN royal_finance.account_totals t ON t.account_id=a.id
    WHERE a.balance<>t.balance) THEN
    RAISE EXCEPTION 'Cannot migrate inconsistent account balances' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION royal_finance.initialize_account_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,royal_finance,pg_temp AS $$
BEGIN
  INSERT INTO royal_finance.account_totals(account_id,balance) VALUES (NEW.id,0);
  RETURN NULL;
END $$;
CREATE TRIGGER initialize_account_total AFTER INSERT ON royal_finance.accounts
  FOR EACH ROW EXECUTE FUNCTION royal_finance.initialize_account_total();

CREATE FUNCTION royal_finance.accumulate_entry_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,royal_finance,pg_temp AS $$
BEGIN
  UPDATE royal_finance.account_totals SET balance=balance+NEW.delta WHERE account_id=NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing entry total' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER accumulate_entry_total AFTER INSERT ON royal_finance.entries
  FOR EACH ROW EXECUTE FUNCTION royal_finance.accumulate_entry_total();

CREATE FUNCTION royal_finance.protect_account_total() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,royal_finance,pg_temp AS $$
BEGIN
  IF pg_trigger_depth()<>2 OR TG_OP NOT IN ('INSERT','UPDATE') THEN
    RAISE EXCEPTION 'Entry totals can only change through ledger triggers' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'Cannot reassign entry totals' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protected_account_totals BEFORE INSERT OR UPDATE OR DELETE ON royal_finance.account_totals
  FOR EACH ROW EXECUTE FUNCTION royal_finance.protect_account_total();
CREATE TRIGGER protected_total_truncate BEFORE TRUNCATE ON royal_finance.account_totals
  FOR EACH STATEMENT EXECUTE FUNCTION royal_finance.protect_account_total();

CREATE OR REPLACE FUNCTION royal_finance.check_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,royal_finance,pg_temp AS $$
DECLARE account uuid; actual numeric; expected numeric;
BEGIN
  IF TG_TABLE_NAME='account_totals' THEN account:=NEW.account_id; ELSE account:=NEW.id; END IF;
  SELECT a.balance,t.balance INTO actual,expected FROM royal_finance.accounts a
    LEFT JOIN royal_finance.account_totals t ON t.account_id=a.id WHERE a.id=account;
  IF NOT FOUND OR expected IS NULL OR actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Balance does not match journal totals' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reconciled_total AFTER INSERT OR UPDATE ON royal_finance.account_totals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION royal_finance.check_account();

REVOKE ALL ON royal_finance.account_totals FROM PUBLIC;
REVOKE ALL ON FUNCTION royal_finance.initialize_account_total(),royal_finance.accumulate_entry_total(),
  royal_finance.protect_account_total() FROM PUBLIC;
GRANT SELECT ON royal_finance.account_totals TO royal_finance_runtime;
ALTER TABLE royal_finance.meta DROP CONSTRAINT meta_version_check;
UPDATE royal_finance.meta SET version=3;
ALTER TABLE royal_finance.meta ADD CONSTRAINT meta_version_check CHECK (version=3);
`;
