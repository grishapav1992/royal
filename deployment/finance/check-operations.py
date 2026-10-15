#!/usr/bin/env python3
"""Failure injection with temporary metadata and an absent Compose project."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OPS = ROOT / "deployment/finance/operations.py"


def invoke(command, environment, expected):
    result = subprocess.run([sys.executable, str(OPS), command], env=environment,
                            capture_output=True, text=True, timeout=120)
    assert result.returncode == expected, "unexpected operational check result"
    return json.loads(result.stdout)


with tempfile.TemporaryDirectory(prefix="royal-finance-operation-test-") as temporary:
    directory = Path(temporary)
    backups = directory / "backups"
    state = directory / "state"
    backups.mkdir()
    state.mkdir()
    environment = {**os.environ, "FINANCE_BACKUP_DIR": str(backups), "FINANCE_STATE_DIR": str(state),
                   "FINANCE_ROOT": str(ROOT)}
    latest = invoke("latest", {**environment, "FINANCE_BACKUP_DIR": "/opt/royal-finance-backups"}, 0)
    name = latest["metadata"]["file"]
    shutil.copyfile(Path("/opt/royal-finance-backups") / name, backups / name)
    metadata = latest["metadata"]
    metadata_file = backups / (name + ".json")
    original_hash = metadata["sha256"]
    metadata["sha256"] = "0" * 64
    metadata_file.write_text(json.dumps(metadata))
    rejected = invoke("restore-check", environment, 1)
    assert rejected["error"] == "backup_checksum_mismatch"
    print(json.dumps({"test": "corrupted_backup_rejected", "ok": True}), flush=True)
    metadata["sha256"] = original_hash
    metadata["data_sha256"] = "0" * 64
    metadata_file.write_text(json.dumps(metadata))
    rejected = invoke("restore-check", environment, 1)
    assert rejected["error"] == "restored_data_mismatch"
    print(json.dumps({"test": "incorrect_restored_data_detected", "ok": True}), flush=True)
    absent_project = directory / "absent-project"
    absent_project.mkdir()
    (absent_project / "compose.finance.yaml").write_text(
        "name: royal-finance-absent-test\nservices:\n  finance-api:\n    image: royal-finance-sim:local\n"
        "  finance-db:\n    image: postgres:17-bookworm\n")
    rejected = invoke("monitor", {**environment, "FINANCE_ROOT": str(absent_project)}, 1)
    assert {"api_or_reconciliation_failed", "finance-api_not_healthy", "finance-db_not_healthy",
            "backup_stale", "restore_check_stale"} <= set(rejected["issues"])
    print(json.dumps({"test": "missing_services_and_stale_backups_detected", "ok": True}), flush=True)
