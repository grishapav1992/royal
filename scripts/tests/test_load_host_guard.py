import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("load_host_guard", Path(__file__).parents[1] / "load-host-guard.py")
guard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = guard
spec.loader.exec_module(guard)
CONTAINER, RUN_ID = "royal-load-run001", "run001"


class Future:
    def __init__(self, function, args):
        try:
            self.value, self.error = function(*args), None
        except Exception as error:
            self.error = error

    def done(self):
        return True

    def result(self):
        if self.error:
            raise self.error
        return self.value


class Pool:
    def submit(self, function, *args):
        return Future(function, args)


class FakeSystem:
    def __init__(self, cpu=50, memory=1000, health=None):
        self.time = self.total = self.idle = 0
        self.cpu, self.memory = cpu, memory
        self.health_value = health or {"status": 200, "latencyMs": 25}
        self.stops, self.kills, self.inspections, self.health_calls = [], [], [], []
        self.label, self.status = RUN_ID, "running"

    def now(self):
        return self.time

    def sleep(self, seconds):
        self.time += seconds

    def inspect(self, container):
        self.inspections.append(container)
        return self.status, self.label

    def stop(self, container):
        self.stops.append(container)
        self.status = "exited"

    def kill(self, container):
        self.kills.append(container)
        self.status = "exited"

    def resources(self):
        self.total += 100
        self.idle += 100 - self.cpu
        return self.total, self.idle, self.memory, {}

    def health(self, url):
        self.health_calls.append((url, self.time))
        return self.health_value


class HostGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.output = Path(self.directory.name) / "guard.json"

    def tearDown(self):
        self.directory.cleanup()

    def run_guard(self, system, seconds=30):
        return guard.monitor(CONTAINER, RUN_ID, self.output, seconds, system=system, executor=Pool())

    def assert_owned_stop(self, system, result, reason):
        self.assertEqual(system.stops, [CONTAINER])
        self.assertEqual(system.kills, [])
        self.assertEqual(set(system.inspections), {CONTAINER})
        self.assertTrue(result["stopped"])
        self.assertEqual(result["reason"], reason)
        self.assertEqual(json.loads(self.output.read_text()), result)

    def test_memory_and_cpu_thresholds_are_consecutive_and_stop_only_owned_container_once(self):
        system = FakeSystem(memory=499)
        result = self.run_guard(system)
        self.assert_owned_stop(system, result, "memory-pressure")
        self.assertEqual(result["samples"], 2)
        self.output.unlink()
        self.output.with_suffix(".jsonl").unlink()
        system = FakeSystem(cpu=95)
        result = self.run_guard(system)
        self.assert_owned_stop(system, result, "host-cpu-saturated")
        self.assertEqual(result["samples"], 6)  # First sample has no previous CPU counters.

    def test_public_health_errors_and_slow_responses_have_distinct_thresholds(self):
        system = FakeSystem(health={"status": 503, "latencyMs": 40})
        result = self.run_guard(system)
        self.assert_owned_stop(system, result, "public-health-failed")
        self.assertEqual(result["healthChecks"], 2)
        self.assertTrue(all(url == guard.HEALTH_URL for url, _ in system.health_calls))
        self.output.unlink()
        self.output.with_suffix(".jsonl").unlink()
        system = FakeSystem(health={"status": 200, "latencyMs": 1000})
        result = self.run_guard(system)
        self.assert_owned_stop(system, result, "public-health-slow")
        self.assertEqual(result["healthChecks"], 3)

    def test_faults_do_not_expose_messages_and_fail_safely(self):
        system = FakeSystem()
        system.resources = lambda: (_ for _ in ()).throw(RuntimeError("private host detail"))
        self.assert_owned_stop(system, self.run_guard(system), "host-resource-read-failed")
        self.output.unlink()
        self.output.with_suffix(".jsonl").unlink()
        system = FakeSystem()
        system.health = lambda *_: (_ for _ in ()).throw(RuntimeError("secret response"))
        self.assert_owned_stop(system, self.run_guard(system), "public-health-failed")
        self.assertNotIn("secret", self.output.read_text())
        self.assertNotIn("private", self.output.with_suffix(".jsonl").read_text())

    def test_stop_timeout_falls_back_once_only_after_fresh_owned_inspection(self):
        system = FakeSystem(memory=499)

        def stop(container):
            system.stops.append(container)
            raise guard.subprocess.TimeoutExpired("private command", 10)

        system.stop = stop
        result = self.run_guard(system)
        self.assertEqual(system.stops, [CONTAINER])
        self.assertEqual(system.kills, [CONTAINER])
        self.assertEqual(system.inspections, [CONTAINER] * 5)
        self.assertTrue(result["stopFallback"])
        self.assertTrue(result["stopped"])
        self.assertEqual(result["terminationMethod"], "kill")
        self.assertEqual(result["reason"], "memory-pressure")

    def test_replaced_label_after_stop_failure_refuses_without_kill(self):
        system = FakeSystem(memory=499)

        def stop(container):
            system.stops.append(container)
            system.label = "another-run"
            raise RuntimeError("private stop failure")

        system.stop = stop
        with self.assertRaisesRegex(guard.Refused, "container-label-mismatch"):
            self.run_guard(system)
        self.assertEqual(system.stops, [CONTAINER])
        self.assertEqual(system.kills, [])
        self.assertFalse(json.loads(self.output.read_text())["stopped"])

    def test_failed_kill_is_bounded_and_never_retries_or_exposes_error(self):
        system = FakeSystem(memory=499)

        def stop(container):
            system.stops.append(container)
            raise RuntimeError("private stop failure")

        def kill(container):
            system.kills.append(container)
            raise RuntimeError("private kill failure")

        system.stop, system.kill = stop, kill
        with self.assertRaisesRegex(guard.Refused, "owned-container-kill-failed"):
            self.run_guard(system)
        self.assertEqual(system.stops, [CONTAINER])
        self.assertEqual(system.kills, [CONTAINER])
        self.assertNotIn("private", self.output.read_text())

    def test_unexpected_monitor_exception_stops_owned_container_without_raw_error(self):
        system = FakeSystem()
        pool = Pool()
        pool.submit = lambda *_: (_ for _ in ()).throw(RuntimeError("secret worker failure"))
        result = guard.monitor(CONTAINER, RUN_ID, self.output, 30, system=system, executor=pool)
        self.assert_owned_stop(system, result, "guard-internal-error")
        self.assertNotIn("secret", self.output.read_text())

    def test_hung_health_worker_hits_deadlines_without_extra_workers_or_blocking_polls(self):
        class Pending:
            def done(self):
                return False

        class HungPool:
            calls = 0

            def submit(self, *_):
                self.calls += 1
                return Pending()

        system, pool = FakeSystem(), HungPool()
        result = guard.monitor(CONTAINER, RUN_ID, self.output, 30, system=system, executor=pool)
        self.assert_owned_stop(system, result, "public-health-failed")
        self.assertEqual(pool.calls, 1)
        self.assertEqual(result["healthChecks"], 2)
        self.assertEqual(result["durationSeconds"], 8)
        self.assertEqual(result["samples"], 9)
        self.assertEqual(result["maxHealthLatencyMs"], 3000)

    def test_wrong_label_refuses_before_monitoring_and_is_rechecked_before_stop(self):
        system = FakeSystem(memory=499)
        system.label = "another-run"
        with self.assertRaisesRegex(guard.Refused, "container-label-mismatch"):
            self.run_guard(system)
        self.assertEqual(system.stops, [])
        self.assertEqual(system.health_calls, [])
        self.assertEqual(json.loads(self.output.read_text())["reason"], "container-label-mismatch")
        self.output.unlink()
        system = FakeSystem(memory=499)
        original = system.inspect

        def inspect(container):
            result = original(container)
            return (result[0], "another-run") if len(system.inspections) == 4 else result

        system.inspect = inspect
        with self.assertRaisesRegex(guard.Refused, "container-label-mismatch"):
            self.run_guard(system)
        self.assertEqual(system.stops, [])

    def test_normal_exit_does_not_stop_and_timeout_is_bounded(self):
        system = FakeSystem()
        system.status = "exited"
        result = self.run_guard(system)
        self.assertEqual(result["reason"], "container-ended")
        self.assertFalse(result["stopped"])
        self.assertEqual(system.stops, [])
        self.output.unlink()
        self.output.with_suffix(".jsonl").unlink()
        system = FakeSystem()
        result = self.run_guard(system, seconds=2400)
        self.assert_owned_stop(system, result, "maximum-duration")
        lines = self.output.with_suffix(".jsonl").read_text().splitlines()
        self.assertEqual(result["durationSeconds"], 2400)
        self.assertLessEqual(len(lines), 2700)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.output.with_suffix(".jsonl").stat().st_mode), 0o600)

    def test_streaks_reset_after_recovery(self):
        system = FakeSystem()
        readings = iter([499, 501, 499, 501, 499, 501])
        original = system.resources

        def resources():
            total, idle, _, pressure = original()
            return total, idle, next(readings, 1000), pressure

        system.resources = resources
        self.assert_owned_stop(system, self.run_guard(system, seconds=8), "maximum-duration")

    def test_invalid_names_urls_and_limits_never_inspect_or_stop_production(self):
        for container, run_id, seconds, url in [
            ("royal-game-1", RUN_ID, 30, guard.HEALTH_URL),
            (CONTAINER + "other", RUN_ID, 30, guard.HEALTH_URL),
            (CONTAINER, "../prod", 30, guard.HEALTH_URL),
            (CONTAINER, RUN_ID, 2401, guard.HEALTH_URL),
            (CONTAINER, RUN_ID, 30, guard.HEALTH_URL + "?token=private"),
            (CONTAINER, RUN_ID, 30, "https://user:password@example.com/healthz"),
        ]:
            system = FakeSystem()
            with self.subTest(container=container, seconds=seconds), self.assertRaises(guard.Refused):
                guard.monitor(container, run_id, self.output, seconds, url, system=system, executor=Pool())
            self.assertEqual(system.inspections, [])
            self.assertEqual(system.stops, [])

    def test_docker_commands_have_exact_target_fields_and_timeouts_without_environment(self):
        system = guard.System()
        result = type("Result", (), {"returncode": 0, "stdout": '"running"\n"run001"\n'})()
        with patch.object(guard.subprocess, "run", return_value=result) as command:
            self.assertEqual(system.inspect(CONTAINER), ("running", RUN_ID))
            system.stop(CONTAINER)
            system.kill(CONTAINER)
        inspect_args, stop_args, kill_args = command.call_args_list
        self.assertEqual(inspect_args.args[0][-1], CONTAINER)
        self.assertIn('.State.Status', inspect_args.args[0][-2])
        self.assertIn('"royal.load.run-id"', inspect_args.args[0][-2])
        self.assertNotIn('.Config.Env', inspect_args.args[0][-2])
        self.assertEqual(stop_args.args[0], ["docker", "stop", "-t", "5", CONTAINER])
        self.assertEqual(kill_args.args[0], ["docker", "kill", CONTAINER])
        self.assertEqual(inspect_args.kwargs["timeout"], 10)
        self.assertEqual(stop_args.kwargs["timeout"], 10)
        self.assertEqual(kill_args.kwargs["timeout"], 10)


if __name__ == "__main__":
    unittest.main()
