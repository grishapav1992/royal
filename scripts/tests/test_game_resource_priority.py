import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "game_resource_priority", Path(__file__).parents[2] / "deployment/game-resource-priority.py")
priority = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = priority
SPEC.loader.exec_module(priority)

COMPOSE = b"""services:
  game:
    build: .
    environment:
      PRIVATE_KEY: ${PRIVATE_KEY}
    volumes:
      - game_data:/app/data
    networks: [default, royal_database]
  caddy:
    image: caddy:2-alpine
    ports: ['443:443']
volumes:
  game_data:
networks:
  royal_database:
    external: true
"""
OVERRIDE = b"""services:
  game:
    volumes:
      - /private/finance-projection:/projection:ro
"""


class FakeSystem:
    def __init__(self, settings):
        self.settings, self.updates, self.tags = settings, [], []
        self.health_calls = 0
        self.health_failure_at = None
        self.before_update = None
        self.fail_service = None
        self.fail_after_update = False
        self.config_mutation = False
        self.non_increasing_weight = False
        self.states = {}
        for index, service in enumerate(("game", "caddy"), start=1):
            resources = {key: 0 for key in priority.HOST_FIELDS}
            resources.update(CpusetCpus="", CpusetMems="", CgroupParent="",
                             MemorySwappiness=None, PidsLimit=None, OomKillDisable=False,
                             Memory=0, MemorySwap=0, NanoCpus=0)
            snapshot = {"Id": str(index) * 64, "Image": "sha256:" + str(index + 2) * 64,
                        "StartedAt": "2026-10-11T09:00:00.123456789Z", "Pid": 100 + index,
                        "Status": "running", "Paused": False, "Restarting": False,
                        "labels": dict(zip(priority.LABEL_KEYS, ["royal", service,
                            ",".join(map(str, settings.files)), str(settings.root), "1", "False"])),
                        "labelFingerprint": "f" * 64, "HostConfig": resources}
            self.states[service] = {"snapshot": snapshot,
                "kernel": {"path": "/system.slice/docker-" + snapshot["Id"] + ".scope", "weight": 100}}

    def info(self):
        return {"version": "2", "driver": "systemd"}

    def service_id(self, service):
        return self.states[service]["snapshot"]["Id"]

    def inspect(self, identifier):
        for state in self.states.values():
            if state["snapshot"]["Id"] == identifier:
                return copy.deepcopy(state["snapshot"])
        raise priority.Refusal("fake-original-container-not-found")

    def weight(self, snapshot):
        for state in self.states.values():
            if state["snapshot"]["Id"] == snapshot["Id"]:
                return copy.deepcopy(state["kernel"])
        raise AssertionError("Unknown container")

    def merged(self):
        value = {"name": "royal", "services": {
            "game": {"image": "royal-game", "environment": {"PRIVATE_KEY": "never-print-this-secret"},
                     "volumes": ["game_data:/app/data", "/private/finance-projection:/projection:ro"],
                     "networks": ["default", "royal_database"]},
            "caddy": {"image": "caddy:2-alpine", "ports": ["443:443"]}},
            "volumes": {"game_data": {}}, "networks": {"royal_database": {"external": True}}}
        data = self.settings.files[0].read_text()
        for service in ("game", "caddy"):
            block = re.search(r"^  " + service + r":\n(.*?)(?=^  [A-Za-z]|^[A-Za-z]|\Z)", data, re.M | re.S)
            found = re.search(r"^    cpu_shares: ([0-9]+)", block[1], re.M)
            if found:
                value["services"][service]["cpu_shares"] = int(found[1])
        if self.config_mutation and "cpu_shares: 8192" in data:
            value["services"]["game"]["volumes"][0] = "foreign_volume:/app/data"
        return value

    def update(self, identifier, shares):
        service = next(service for service, state in self.states.items() if state["snapshot"]["Id"] == identifier)
        self.updates.append((identifier, shares))
        if self.before_update:
            self.before_update(self, service, shares)
        if service == self.fail_service and shares == priority.DESIRED[service] and not self.fail_after_update:
            raise priority.Refusal("simulated-update-failure")
        # Use the observed host values, including a zero-reset no-op, rather than a formula.
        if shares != 0:
            self.states[service]["snapshot"]["HostConfig"]["CpuShares"] = shares
            self.states[service]["kernel"]["weight"] = (
                100 if self.non_increasing_weight else {1024: 100, 4096: 303, 8192: 532}[shares])
        if service == self.fail_service and shares == priority.DESIRED[service] and self.fail_after_update:
            raise priority.Refusal("simulated-timeout-after-apply")

    def tag(self, image, tag):
        self.tags.append((image, tag))

    def health(self):
        self.health_calls += 1
        if self.health_calls == self.health_failure_at:
            raise priority.Refusal("public-health-not-200")


class PriorityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.base = Path(self.directory.name).resolve()
        root, backups = self.base / "royal", self.base / "backups"
        root.mkdir(mode=0o700)
        backups.mkdir(mode=0o700)
        self.settings = priority.Settings(root=root, backup_root=backups, owner=os.geteuid())
        self.settings.files[0].write_bytes(COMPOSE)
        self.settings.files[1].write_bytes(OVERRIDE)
        (root / ".env").write_bytes(b"PRIVATE_KEY=never-print-this-secret\n")
        os.chmod(root / ".env", 0o600)
        self.system = FakeSystem(self.settings)
        self.backup = backups / "game-resource-priority-test0001"

    def tearDown(self):
        self.directory.cleanup()

    def plan(self):
        return priority.make_plan(self.system, self.settings)

    def apply(self, plan=None):
        return priority.apply_plan(self.system, self.settings, plan or self.plan(), self.backup)

    def failure(self, plan=None):
        with self.assertRaises(priority.Refusal) as caught:
            self.apply(plan)
        return caught.exception

    def assert_original_files(self):
        self.assertEqual(self.settings.files[0].read_bytes(), COMPOSE)
        self.assertEqual(self.settings.files[1].read_bytes(), OVERRIDE)
        self.assertEqual((self.settings.root / ".env").read_bytes(), b"PRIVATE_KEY=never-print-this-secret\n")

    def test_readonly_plan_and_apply_preserve_identity_other_resources_and_private_backups(self):
        plan = self.plan()
        self.assert_original_files()
        self.assertFalse(self.backup.exists())
        self.assertFalse((self.settings.root / ".game-resource-priority.lock").exists())
        self.assertNotIn("never-print-this-secret", json.dumps(plan))
        self.assertEqual(self.system.updates, [])
        before = copy.deepcopy(self.system.states)
        report = self.apply(plan)
        self.assertTrue(report["ok"])
        self.assertTrue(report["identityPreserved"])
        self.assertEqual(report["publicHealthStatus"], 200)
        self.assertEqual(report["resources"], {"game": {"cpuShares": 8192, "cpuWeight": 532},
                                              "caddy": {"cpuShares": 4096, "cpuWeight": 303}})
        self.assertEqual(self.system.updates, [(before["game"]["snapshot"]["Id"], 8192),
                                             (before["caddy"]["snapshot"]["Id"], 4096)])
        expected = COMPOSE.replace(b"  game:\n", b"  game:\n    cpu_shares: 8192\n").replace(
            b"  caddy:\n", b"  caddy:\n    cpu_shares: 4096\n")
        self.assertEqual(self.settings.files[0].read_bytes(), expected)
        self.assertEqual(self.settings.files[1].read_bytes(), OVERRIDE)
        for service, state in self.system.states.items():
            snapshot = copy.deepcopy(state["snapshot"])
            snapshot["HostConfig"]["CpuShares"] = 0
            self.assertEqual(snapshot, before[service]["snapshot"])
        self.assertEqual(self.tags_game_image(), before["game"]["snapshot"]["Image"])
        for name, original in (("compose.yaml", COMPOSE), ("compose.override.yaml", OVERRIDE)):
            path = self.backup / name
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.backup.stat().st_mode), 0o700)
        self.assertEqual(json.loads((self.backup / "result.json").read_text()), report)
        self.assertNotIn("never-print-this-secret", json.dumps(report))

    def tags_game_image(self):
        self.assertEqual(len(self.system.tags), 1)
        image, tag = self.system.tags[0]
        self.assertRegex(tag, r"^royal-game:before-resource-priority-[a-f0-9]{32}$")
        return image

    def test_stale_file_restarted_container_and_changed_quota_refuse_before_mutations(self):
        for mutation in ("file", "started", "quota", "labels"):
            with self.subTest(mutation=mutation):
                plan = self.plan()
                previous = copy.deepcopy(self.system.states)
                if mutation == "file":
                    self.settings.files[1].write_bytes(OVERRIDE + b"# operator change\n")
                elif mutation == "started":
                    self.system.states["game"]["snapshot"]["StartedAt"] = "2026-10-11T09:01:00Z"
                elif mutation == "quota":
                    self.system.states["caddy"]["snapshot"]["HostConfig"]["CpuQuota"] = 50000
                else:
                    self.system.states["game"]["snapshot"]["labelFingerprint"] = "e" * 64
                self.failure(plan)
                self.assertEqual(self.system.updates, [])
                self.assertEqual(self.system.tags, [])
                self.assertFalse(self.backup.exists())
                self.system.states = previous
                self.settings.files[1].write_bytes(OVERRIDE)

    def test_merged_override_cannot_hide_shares_or_change_finance_mount(self):
        self.system.config_mutation = True
        error = self.failure()
        self.assertEqual(error.code, "merged-config-changed-beyond-cpu-shares")
        self.assertEqual(self.system.updates, [])
        self.assert_original_files()
        self.assertTrue(error.report["rollback"]["complete"])

    def test_failure_after_partial_update_restores_kernel_policy_with_honest_zero_metadata(self):
        self.system.fail_service, self.system.fail_after_update = "caddy", True
        error = self.failure()
        self.assertEqual(error.code, "simulated-timeout-after-apply")
        self.assert_original_files()
        rollback = error.report["rollback"]
        self.assertTrue(rollback["complete"])
        self.assertFalse(rollback["exactMetadataRestore"])
        self.assertTrue(rollback["equivalentPolicyRestore"])
        for service in ("game", "caddy"):
            self.assertEqual(self.system.states[service]["snapshot"]["HostConfig"]["CpuShares"], 1024)
            self.assertEqual(self.system.states[service]["kernel"]["weight"], 100)
            self.assertEqual(rollback["containers"][service]["restoredCpuShares"], 1024)
        self.assertEqual([shares for _, shares in self.system.updates], [8192, 4096, 1024, 1024])
        self.assertEqual(json.loads((self.backup / "failure.json").read_text()), error.report)

    def test_failed_update_that_did_not_apply_keeps_untouched_zero_metadata(self):
        self.system.fail_service = "caddy"
        error = self.failure()
        self.assertEqual(self.system.states["caddy"]["snapshot"]["HostConfig"]["CpuShares"], 0)
        self.assertEqual(self.system.states["game"]["snapshot"]["HostConfig"]["CpuShares"], 1024)
        self.assertTrue(error.report["rollback"]["containers"]["caddy"]["exactMetadataRestore"])
        self.assertEqual([shares for _, shares in self.system.updates], [8192, 4096, 1024])
        self.assert_original_files()

    def test_actual_weight_must_increase_and_failed_health_rolls_back_both_services(self):
        self.system.non_increasing_weight = True
        error = self.failure()
        self.assertEqual(error.code, "kernel-cpu-weight-verification-failed")
        self.assertTrue(error.report["rollback"]["complete"])
        self.assert_original_files()
        self.backup.rename(self.backup.with_name(self.backup.name + "-first"))
        self.system = FakeSystem(self.settings)
        self.system.health_failure_at = 3  # Plan health, apply preflight, post-update public health.
        error = self.failure()
        self.assertEqual(error.code, "public-health-not-200")
        self.assertTrue(error.report["rollback"]["complete"])
        self.assertEqual([shares for _, shares in self.system.updates], [8192, 4096, 1024, 1024])
        self.assert_original_files()

    def test_concurrent_restart_and_file_edit_are_not_overwritten_during_rollback(self):
        def changed(system, service, shares):
            if service == "caddy" and shares == 4096:
                system.states["game"]["snapshot"]["Pid"] += 1000
                self.settings.files[0].write_bytes(self.settings.files[0].read_bytes() + b"# operator edit\n")
        self.system.before_update = changed
        self.system.fail_service = "caddy"
        error = self.failure()
        self.assertFalse(error.report["rollback"]["complete"])
        self.assertEqual(error.report["rollback"]["compose"], "refused-concurrent-file-change")
        self.assertEqual(error.report["rollback"]["containers"]["game"]["status"], "rollback-container-changed")
        self.assertTrue(self.settings.files[0].read_bytes().endswith(b"# operator edit\n"))
        self.assertEqual([shares for _, shares in self.system.updates], [8192, 4096])

    def test_nondefault_original_shares_are_restored_exactly_and_same_plan_cannot_reapply(self):
        for state in self.system.states.values():
            state["snapshot"]["HostConfig"]["CpuShares"] = 1024
        self.system.fail_service = "caddy"
        error = self.failure()
        self.assertTrue(error.report["rollback"]["exactMetadataRestore"])
        self.assertFalse(error.report["rollback"]["equivalentPolicyRestore"])
        self.assert_original_files()
        self.backup.rename(self.backup.with_name(self.backup.name + "-first"))
        self.system.fail_service = None
        plan = self.plan()
        self.apply(plan)
        self.assertEqual(self.failure(plan).code, "planned-compose-files-changed")
        with self.assertRaisesRegex(priority.Refusal, "priority-already-set-or-higher"):
            self.plan()

    def test_expiry_ownership_lock_symlink_and_private_plan_checks(self):
        plan = self.plan()
        plan["createdAt"] = (priority.now() - dt.timedelta(hours=1)).isoformat()
        plan["expiresAt"] = (priority.now() - dt.timedelta(minutes=30)).isoformat()
        self.assertEqual(self.failure(plan).code, "expired-or-invalid-plan")
        self.assertFalse(self.backup.exists())
        wrong = self.plan()
        wrong["containers"]["game"]["snapshot"]["labels"]["com.docker.compose.project"] = "finance"
        self.assertEqual(self.failure(wrong).code, "container-compose-ownership-mismatch")
        with priority.locked(self.settings):
            self.assertEqual(self.failure().code, "priority-operation-already-running")
        original = self.settings.files[1]
        real = original.with_name("real-override.yaml")
        original.rename(real)
        original.symlink_to(real)
        with self.assertRaisesRegex(priority.Refusal, "unsafe-path"):
            self.plan()
        original.unlink()
        real.rename(original)
        candidate = self.base / "plan.json"
        candidate.write_text(json.dumps(self.plan()))
        os.chmod(candidate, 0o644)
        with self.assertRaisesRegex(priority.Refusal, "private-file-required"):
            priority.read_file(candidate, self.settings, private=True)
        self.assertEqual(self.system.updates, [])

    def test_yaml_patcher_only_changes_two_scalars_and_rejects_ambiguous_layouts(self):
        with_existing = COMPOSE.replace(b"  game:\n", b"  game:\n    cpu_shares: 1024 # keep note\n")
        result = priority.patch_compose(with_existing)
        expected = with_existing.replace(b"1024 # keep note", b"8192 # keep note").replace(
            b"  caddy:\n", b"  caddy:\n    cpu_shares: 4096\n")
        self.assertEqual(result, expected)
        self.assertEqual(priority.patch_compose(COMPOSE.replace(b"\n", b"\r\n")),
                         priority.patch_compose(COMPOSE).replace(b"\n", b"\r\n"))
        for invalid in (COMPOSE.replace(b"  game:\n", b"  game: &shared\n"),
                        COMPOSE.replace(b"  game:\n", b"  game:\n    cpu_shares: 2\n    cpu_shares: 4\n"),
                        COMPOSE.replace(b"  game:\n", b"  game:\n    cpu_shares: ${SHARES}\n")):
            with self.assertRaises(priority.Refusal):
                priority.patch_compose(invalid)

    def test_keyboard_interrupt_after_update_attempt_runs_rollback(self):
        def interrupted(system, service, shares):
            if service == "caddy" and shares == 4096:
                raise KeyboardInterrupt()
        self.system.before_update = interrupted
        error = self.failure()
        self.assertTrue(error.report["rollback"]["complete"])
        self.assert_original_files()

    def test_real_command_contract_whitelists_inspect_and_only_updates_cpu_shares(self):
        system = priority.System.__new__(priority.System)
        system.settings = self.settings
        system.docker_binary = "/usr/bin/docker"
        system.curl_binary = "/usr/bin/curl"
        calls = []
        snapshot = copy.deepcopy(self.system.states["game"]["snapshot"])
        snapshot["allLabels"] = snapshot.pop("labels")
        snapshot.pop("labelFingerprint")
        snapshot["allLabels"]["unrelated.private.label"] = "never-print-label-value"
        def command(args, **limits):
            calls.append((args, limits))
            return json.dumps(snapshot) if "inspect" in args else "ok"
        system.command = command
        value = system.inspect("1" * 64)
        system.update("1" * 64, 8192)
        self.assertNotIn("never-print-label-value", json.dumps(value))
        template = calls[0][0][calls[0][0].index("--format") + 1]
        self.assertNotIn(".Config.Env", template)
        self.assertNotIn("{{json .HostConfig}}", template)
        self.assertNotIn("{{json .}}", template)
        self.assertEqual(calls[1][0], ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock",
                                     "update", "--cpu-shares", "8192", "1" * 64])
        self.assertEqual(calls[0][1]["timeout"], 10)
        self.assertEqual(calls[1][1]["timeout"], 15)

    def test_legacy_owner_is_allowed_only_for_root_and_base_compose_with_metadata_preserved(self):
        original_stat = Path.stat
        original_fstat = os.fstat
        self.settings = priority.Settings(root=self.settings.root, backup_root=self.settings.backup_root, owner=0)
        self.system.settings = self.settings
        owners = {self.settings.root: 502, self.settings.files[0]: 502}
        def simulated_stat(path, *args, **kwargs):
            value = original_stat(path, *args, **kwargs)
            fields = list(value)
            fields[4] = owners.get(path, 0)
            return os.stat_result(fields)
        def simulated_fstat(descriptor):
            fields = list(original_fstat(descriptor))
            fields[4] = 0
            return os.stat_result(fields)
        with (patch.object(Path, "stat", simulated_stat),
              patch.object(priority.os, "fstat", simulated_fstat),
              patch.object(priority.os, "fchown") as chown):
            plan = self.plan()
            self.assertEqual(plan["sourceMetadata"]["compose.yaml"]["uid"], 502)
            self.assertTrue(self.apply(plan)["ok"])
            chown.assert_called_with(chown.call_args[0][0], 502, plan["sourceMetadata"]["compose.yaml"]["gid"])
            for path in (self.settings.root / ".env", self.settings.files[1], self.settings.backup_root):
                owners[path] = 502
                with self.assertRaisesRegex(priority.Refusal, "unsafe-path-owner-or-mode"):
                    priority.secure_path(path, self.settings, directory=path.is_dir())
                owners.pop(path)
            for uid in (503, 65534):
                owners[self.settings.files[0]] = uid
                with self.assertRaisesRegex(priority.Refusal, "unsafe-path-owner-or-mode"):
                    priority.secure_path(self.settings.files[0], self.settings)
            owners[self.settings.files[0]] = 502
            os.chmod(self.settings.files[0], 0o666)
            with self.assertRaisesRegex(priority.Refusal, "unsafe-path-owner-or-mode"):
                priority.secure_path(self.settings.files[0], self.settings)

    def test_source_file_permission_change_after_plan_refuses_before_tag_or_update(self):
        plan = self.plan()
        os.chmod(self.settings.files[0], 0o600)
        self.assertEqual(self.failure(plan).code, "planned-source-metadata-changed")
        self.assertEqual(self.system.updates, [])
        self.assertEqual(self.system.tags, [])
        self.assertFalse(self.backup.exists())

    def test_result_write_failure_never_reports_success_and_runs_rollback(self):
        original_write = priority.write_json
        def failed_report(path, value):
            if path.name == "result.json":
                raise OSError("private-error-must-not-be-printed")
            original_write(path, value)
        with patch.object(priority, "write_json", failed_report):
            error = self.failure()
        self.assertFalse(error.report["ok"])
        self.assertEqual(error.code, "safe-operation-failed")
        self.assertTrue(error.report["rollback"]["complete"])
        self.assertNotIn("private-error", json.dumps(error.report))
        self.assert_original_files()


if __name__ == "__main__":
    unittest.main()
