"""Bounded same-host profiles and durable completion-marker safety."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'run-loopback-stand.py'
SPEC = importlib.util.spec_from_file_location('loopback_tested', SOURCE)
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)


class LoopbackTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.plan = {'clients': 600, 'seconds': 30, 'gameProcesses': 20,
                     'sameHostGenerators': True, 'bundleSha256': 'b' * 64,
                     'budget': {'cpus': 18, 'memoryMiB': 32768, 'pidsLimit': 2048}}
        self.manifest = {'runId': 'bbd0f8ee-8e10-4f1c-a6a4-14f393086345'}
        self.report = {'productionTraffic': False, 'generatorOnly': True,
                       'runId': self.manifest['runId'], 'bundleSha256': self.plan['bundleSha256'],
                       'targetClients': 600, 'seconds': 30, 'inputMode': 'browser-window',
                       'sdkWebSocket': 'ws', 'cleanup': {'passed': True}, 'childExits': [0] * 4}

    def completion(self, exit_code=0):
        path = self.root / 'generators.json'
        path.write_text(json.dumps(self.report))
        path.chmod(0o644)
        original_lstat, original_fstat = Path.lstat, os.fstat

        def owned_lstat(path, *args, **kwargs):
            value = list(original_lstat(path, *args, **kwargs)); value[4] = 1000
            return os.stat_result(value)

        def owned_fstat(fd):
            value = list(original_fstat(fd)); value[4] = 1000
            return os.stat_result(value)

        with patch.object(Path, 'lstat', owned_lstat), patch.object(CONTROL.os, 'fstat', owned_fstat), \
                patch.object(CONTROL.os, 'fchown'):
            return CONTROL.report_completion(self.root, self.manifest, self.plan, exit_code, 4)

    def test_supported_ladder_and_finite_setup_budgets(self):
        for clients, seconds, owners in CONTROL.PROFILES:
            plan = {**self.plan, 'clients': clients, 'seconds': seconds, 'gameProcesses': owners}
            workers, ready = CONTROL.control_profile(plan)
            self.assertTrue(1 <= workers <= 20)
            self.assertEqual(ready, 900 if clients > 1200 else 300)
        for change in [{'clients': 6001}, {'seconds': 1801}, {'gameProcesses': 24},
                       {'sameHostGenerators': False}, {'tlsGateway': {}},
                       {'budget': {'cpus': 20, 'memoryMiB': 32768, 'pidsLimit': 2048}}]:
            with self.subTest(change=change), self.assertRaises(CONTROL.Refused):
                CONTROL.control_profile({**self.plan, **change})

    def test_completion_pins_actual_report_and_keeps_file_private(self):
        marker = self.completion()
        data = (self.root / 'generators.json').read_bytes()
        self.assertEqual(marker['reportSha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(marker['reportBytes'], len(data))
        self.assertEqual(marker['runId'], self.manifest['runId'])
        self.assertEqual((self.root / 'generators.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / 'generator-completion.json').stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.root / 'generator-completion.tmp').exists())

    def test_failed_measurement_exit_is_preserved_in_marker(self):
        marker = self.completion(1)
        self.assertEqual(marker['generatorExitCode'], 1)

    def test_unobserved_signal_exit_never_creates_marker(self):
        for code in [None, -9, 256, True]:
            with self.subTest(code=code), self.assertRaises(CONTROL.Refused):
                CONTROL.report_completion(self.root, self.manifest, self.plan, code, 4)
        self.assertFalse((self.root / 'generator-completion.json').exists())

    def test_wrong_identity_and_incomplete_cleanup_never_create_marker(self):
        valid = self.report.copy()
        for change in [{'runId': 'foreign'}, {'bundleSha256': 'c' * 64},
                       {'targetClients': 5000}, {'seconds': 60}, {'inputMode': 'stress'},
                       {'cleanup': {'passed': False}}, {'childExits': []}]:
            self.report = {**valid, **change}
            with self.subTest(change=change), self.assertRaises(CONTROL.Refused):
                self.completion()
            self.assertFalse((self.root / 'generator-completion.json').exists())

    def test_symlink_report_never_reads_or_changes_target(self):
        target = self.root / 'foreign-report.json'
        target.write_text('{}'); target.chmod(0o644)
        (self.root / 'generators.json').symlink_to(target)
        with self.assertRaises(CONTROL.Refused):
            CONTROL.report_completion(self.root, self.manifest, self.plan, 0, 4)
        self.assertEqual(target.stat().st_mode & 0o777, 0o644)


if __name__ == '__main__':
    unittest.main()
