import copy, importlib.util, json, sys, tempfile, types, unittest
from pathlib import Path
from unittest.mock import patch

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

recover = load('manual_forward_test', 'recover-publication.py')
deploy = load('manual_deploy_test', 'deploy.py')

class ForwardGuards(unittest.TestCase):
    def fixture(self):
        manifest = {'sourceCommit': recover.APP, 'packages': {'a': {'version': '1-new', 'files': {'entry.js': 'new'}, 'pointerSha256': 'new-pointer'}, 'b': {}},
            'before': {'container': {'id': 'original', 'health': 'healthy'}, 'program': {'host': 'old'}, 'source': {'wallet': 'old'}, 'moduleFiles': {}},
            'changed': {'wallet': 'new'}}
        built = {'sourceCommit': recover.APP, 'image': 'candidate', 'program': {'host': 'new'}}
        state = {'container': copy.deepcopy(manifest['before']['container']), 'program': {'host': 'old'}, 'preparedImage': 'candidate',
            'preparedProgram': {'host': 'new'}, 'source': {'wallet': 'new'}, 'moduleFiles': deploy.expected_modules(manifest, ['a'])}
        return manifest, built, state

    def test_only_the_exact_partial_state_is_admitted(self):
        m, built, state = self.fixture()
        recover.validate_partial(deploy, m, built, state, ['a'])
        for key, value in [('container', {'id': 'candidate', 'health': 'healthy'}), ('program', {'host': 'new'}),
            ('preparedImage', 'other'), ('preparedProgram', {}), ('source', {'wallet': 'other'}), ('moduleFiles', {})]:
            changed = copy.deepcopy(state); changed[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError): recover.validate_partial(deploy, m, built, changed, ['a'])

    def test_changed_application_commit_is_rejected(self):
        m, built, state = self.fixture(); built['sourceCommit'] = 'unreviewed'
        with self.assertRaises(RuntimeError): recover.validate_partial(deploy, m, built, state, ['a'])

    def test_journal_must_be_a_verified_ordered_prefix(self):
        m = {'packages': {'a': {}, 'b': {}}}
        self.assertEqual(recover.installed_prefix(m, {'installed': ['a'], 'verified': True}), ['a'])
        for record in [{'installed': [], 'verified': True}, {'installed': ['b'], 'verified': True},
            {'installed': ['a', 'a'], 'verified': True}, {'installed': ['a'], 'verified': False}]:
            with self.assertRaises(RuntimeError): recover.installed_prefix(m, record)

    def flow(self, result=None, confirm_error=False):
        events = []
        b = types.SimpleNamespace(M={'packages': {'a': {}, 'b': {}}}, COMPOSE=['compose.yaml'], LIVE=Path('/opt/royal'),
            manual_installed=['a'], manual_candidate_attempted=False)
        b.write = lambda name, value: events.append(('write', name))
        class Gate:
            def run(self, args, **kwargs):
                events.append(('run', args[0]))
                if args[0] == 'docker': return 'ok'
                return json.dumps(result if result is not None else {'installed': ['a', 'b'], 'verified': True})
            def confirm(self):
                events.append(('confirm',))
                if confirm_error: raise RuntimeError('Fresh lease unavailable')
        return b, Gate(), events

    def test_slow_module_io_is_supervised_before_a_fresh_confirm_and_compose(self):
        b, gate, events = self.flow()
        self.assertEqual(recover.forward_compose(b, gate), 'ok')
        self.assertEqual([event[0] for event in events], ['run', 'confirm', 'write', 'run'])
        self.assertEqual(events[-2], ('write', 'candidate-start-requested.json'))
        self.assertEqual(events[-1], ('run', 'docker'))
        self.assertTrue(b.manual_candidate_attempted)
        self.assertEqual(b.manual_installed, ['a', 'b'])

    def test_incomplete_modules_never_start_the_candidate(self):
        b, gate, events = self.flow({'installed': ['a'], 'verified': True})
        with self.assertRaises(RuntimeError): recover.forward_compose(b, gate)
        self.assertFalse(b.manual_candidate_attempted); self.assertEqual(len(events), 1)

    def test_stale_lease_never_starts_the_candidate(self):
        b, gate, events = self.flow(confirm_error=True)
        with self.assertRaises(RuntimeError): recover.forward_compose(b, gate)
        self.assertFalse(b.manual_candidate_attempted)
        self.assertFalse(any(event == ('run', 'docker') for event in events))

    def test_missing_financial_gate_is_rejected(self):
        b, _, _ = self.flow()
        with self.assertRaises(RuntimeError): recover.forward_compose(b, None)

    def test_previous_start_request_or_forward_attempt_blocks_repeat_compose(self):
        for name in ['candidate-start-requested.json', 'forward-attempt.json', 'published.json']:
            with tempfile.TemporaryDirectory() as folder, patch.object(recover, 'ROOT', Path(folder)):
                (Path(folder) / name).write_text('{}')
                with self.assertRaises(RuntimeError): recover.resume({})

    def test_real_supervisor_keeps_confirmations_fresh_during_slow_child_io(self):
        folder = Path(__file__).resolve().parent.parent / 'neopolis-ui-20261028-v1'
        spec = importlib.util.spec_from_file_location('shared_financial_gate_fixtures', folder / 'test_financial_gate.py')
        fixtures = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixtures)
        case = fixtures.FinancialGateTests(); case.setUp()
        try:
            gate = case.gate(heartbeat_timeout=.18, command_timeout=2).acquire()
            first = gate._confirmed_nonce
            self.assertEqual(gate.run([sys.executable, '-c', 'import time;time.sleep(.7);print("copied")']), 'copied\n')
            self.assertNotEqual(first, gate._confirmed_nonce)
            gate.release(); self.assertTrue(gate._released)
        finally: case.doCleanups()

if __name__ == '__main__': unittest.main()
