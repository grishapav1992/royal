#!/usr/bin/env python3
"""Stop one simulator API process, verify replay on its peer, then restore it."""
import json
import os
import re
import time

from operations import OpsError, ROOT, STATE, atomic_json, compose, record, run


def api_containers():
    raw = run(compose("ps", "--all", "--format", "json"), "api_inventory").decode().strip()
    items = json.loads(raw) if raw.startswith("[") else [json.loads(line) for line in raw.splitlines()]
    return sorted((item for item in items if item.get("Service") == "finance-api"), key=lambda item: item["ID"])


def wait_healthy():
    deadline = time.monotonic() + 70
    while True:
        items = api_containers()
        if len(items) == 2 and all(item.get("State") == "running" and item.get("Health") == "healthy" for item in items):
            return items
        if time.monotonic() > deadline:
            raise OpsError("two_healthy_api_instances_required")
        time.sleep(1)


def phase(container, stage, fixture=None):
    data = json.dumps(fixture).encode() if fixture is not None else None
    output = run(["docker", "exec", "-i", container, "node", "dist-finance-tools/finance-multi-smoke.js", stage],
                 "multi_" + stage.replace("-", "_"), input=data, timeout=180)
    result = json.loads(output)
    atomic_json(STATE / "multi-instance-fixture.json", result["fixture"])
    print(json.dumps({"phase": stage, "checks": result["checks"]}), flush=True)
    return result


os.umask(0o077)
STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
victim = None
try:
    items = wait_healthy()
    for item in items:
        if not re.fullmatch(r"[a-f0-9]{12,64}", item["ID"]):
            raise OpsError("invalid_api_container")
        info = json.loads(run(["docker", "inspect", item["ID"]], "inspect_api"))[0]
        labels = info["Config"]["Labels"]
        environment = dict(value.split("=", 1) for value in info["Config"]["Env"] if "=" in value)
        if labels.get("com.docker.compose.project") != "royal-finance-sim" or environment.get("FINANCE_MODE") != "simulation":
            raise OpsError("fault_test_requires_isolated_finance_simulator")
    initial = phase(items[0]["ID"], "prepare")
    victim, survivor = items[0]["ID"], items[1]["ID"]
    started = time.monotonic()
    try:
        run(["docker", "stop", "--time", "10", victim], "stop_one_api", timeout=30)
        surviving = phase(survivor, "after-failure", initial["fixture"])
        elapsed = round(time.monotonic() - started, 2)
    finally:
        run(["docker", "start", victim], "restore_api", timeout=30)
    healthy = wait_healthy()
    final = phase(healthy[0]["ID"], "after-recovery", surviving["fixture"])
    record("multi-instance", True, environment="simulation", stopped_api=victim,
           survivor_checks_seconds=elapsed, initial=initial["checks"], surviving=surviving["checks"],
           recovered=final["checks"], alice=final["fixture"]["alice"], bob=final["fixture"]["bob"],
           alice_available_units="70000000", bob_available_units="15000000", reserved_units="0")
except Exception as error:
    record("multi-instance", False, error=str(error) if isinstance(error, OpsError) else type(error).__name__)
    raise SystemExit(1)
