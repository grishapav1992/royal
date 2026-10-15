#!/usr/bin/env python3
"""Role regressions in isolated restored containers, without changing live grants or status."""
import importlib.util
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("finance_hardening_ops", ROOT / "deployment/finance/operations.py")
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
original_query = ops.query

with tempfile.TemporaryDirectory(prefix="royal-finance-hardening-") as temporary:
    state = Path(temporary)
    ops.STATE = state
    ops.record = lambda kind, ok, **details: {"check": kind, "ok": ok, **details}
    original_atomic = ops.atomic_json
    ops.atomic_json = lambda target, value: original_atomic(state / target.name, value)
    target = ops.latest()
    version = ops.read_json(target.with_suffix(".dump.json")).get("schema_version", 1)
    cases = [
        ("runtime_column_grant", "GRANT UPDATE(balance) ON royal_finance.accounts TO finance_app;", "restored_unsafe_runtime_roles_invalid"),
        ("non_inherited_admin_membership", "GRANT finance_schema_owner TO finance_app WITH INHERIT FALSE;", "restored_unsafe_runtime_roles_invalid"),
    ]
    if version >= 2:
        cases.append(("observer_column_grant", "GRANT UPDATE(cursor_height) ON royal_finance.deposit_streams TO finance_ingest;", "restored_unsafe_observer_roles_invalid"))
    for name, grant, expected in cases:
        def injected_query(container, sql, label="database_query"):
            if label == "restore_reconciliation":
                original_query(container, grant, "isolated_test_grant")
            return original_query(container, sql, label)
        ops.query = injected_query
        try:
            ops.restore_check(target)
            raise AssertionError("unsafe restored role accepted")
        except ops.OpsError as error:
            assert str(error) == expected, str(error)
            print(json.dumps({"test": name, "ok": True, "isolated": True}), flush=True)
        finally:
            ops.query = original_query
    def unsafe_audit(container, sql, label="database_query"):
        if label == "live_role_audit":
            return b'{"runtime":1,"observer":0}'
        return original_query(container, sql, label)
    ops.query = unsafe_audit
    try:
        result = ops.monitor()
        assert not result["ok"] and "unsafe_database_roles" in result["issues"]
        print(json.dumps({"test": "monitor_checks_live_role_drift", "ok": True, "live_grants_changed": False}), flush=True)
    finally:
        ops.query = original_query
