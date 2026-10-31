import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('reward_snapshot', Path(__file__).with_name('snapshot.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InventoryTests(unittest.TestCase):
    def fixture(self, unknown_error=None, still_listed=False, retained_error=False):
        calls = []
        def run(args):
            calls.append(args)
            if args[1] == 'ps':
                return 'kept\njob' if len(calls) == 1 or still_listed else 'kept'
            if args[2:] == ['kept']:
                if retained_error:
                    raise subprocess.CalledProcessError(1, args, stderr='Error: No such object: kept')
                return json.dumps([{'Id': 'kept'}])
            if unknown_error:
                raise unknown_error
            return json.dumps([{'Id': 'job', 'Config': {'Labels': {'com.docker.compose.oneoff': 'true'}}, 'HostConfig': {'RestartPolicy': {'Name': 'always'}}}])
        return run, calls

    def test_only_a_confirmed_disappeared_unknown_job_is_omitted(self):
        run, _ = self.fixture(subprocess.CalledProcessError(1, [], stderr='Error: No such object: job'))
        with patch.object(module, 'run', run):
            self.assertEqual(module.stable_docker_rows({'services': {'/service': {'id': 'kept'}}}), [{'Id': 'kept'}])

    def test_retained_service_failure_is_never_ignored(self):
        run, _ = self.fixture(retained_error=True)
        with patch.object(module, 'run', run), self.assertRaisesRegex(RuntimeError, 'retained service'):
            module.stable_docker_rows({'services': {'/service': {'id': 'kept'}}})

    def test_a_still_listed_unknown_service_cannot_be_omitted(self):
        run, _ = self.fixture(subprocess.CalledProcessError(1, [], stderr='Error: No such object: job'), still_listed=True)
        with patch.object(module, 'run', run), self.assertRaisesRegex(RuntimeError, 'uncertain'):
            module.stable_docker_rows({'services': {'/service': {'id': 'kept'}}})

    def test_transport_or_daemon_failures_remain_blockers(self):
        for error in [subprocess.CalledProcessError(1, [], stderr='daemon unavailable'), subprocess.CalledProcessError(137, [], stderr='Error: No such object: job')]:
            run, _ = self.fixture(error)
            with patch.object(module, 'run', run), self.assertRaisesRegex(RuntimeError, 'uncertain'):
                module.stable_docker_rows({'services': {'/service': {'id': 'kept'}}})

    def test_live_additional_services_are_returned_for_full_profile_comparison(self):
        run, _ = self.fixture()
        with patch.object(module, 'run', run):
            rows = module.stable_docker_rows({'services': {'/service': {'id': 'kept'}}})
            self.assertEqual([r['Id'] for r in rows], ['kept', 'job'])
            self.assertEqual(rows[1]['HostConfig']['RestartPolicy']['Name'], 'always')


if __name__ == '__main__':
    unittest.main()
