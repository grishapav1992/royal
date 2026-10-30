from copy import deepcopy
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('completion', Path(__file__).with_name('complete.py'))
completion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(completion)


def fixture():
    row = {'Id': 'game-id', 'Image': 'candidate', 'Config': {'User': 'node', 'WorkingDir': '/app',
        'Cmd': ['node', 'dist-server/index.js'], 'Entrypoint': ['docker-entrypoint.sh'], 'Env': ['ONE=1', 'TWO=2']},
        'State': {'StartedAt': 'same-start'}, 'HostConfig': {'Memory': 268435456, 'ReadonlyRootfs': False},
        'Mounts': [{'Type': 'volume', 'Source': 'wallet-volume', 'Destination': '/data', 'RW': True}],
        'NetworkSettings': {'Networks': {'royal_default': {}, 'royal_payment_bridge': {}}}}
    before = {'protectedPrograms': {'nile': {'play.js': 'same'}}, 'serviceProfiles': {
        'royal-game-1': {'id': 'old', 'profileSha256': 'order-sensitive-old'},
        'royal-nile-play': {'id': 'nile-id', 'profileSha256': 'nile-profile', 'startedAt': 'nile-start'}}}
    state = {'protectedPrograms': deepcopy(before['protectedPrograms']),
        'serviceProfiles': deepcopy(before['serviceProfiles']),
        'container': {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt']}}
    state['serviceProfiles']['royal-game-1'] = {'id': 'game-id', 'profileSha256': 'order-sensitive-new'}
    return row, before, state


class CompletionTests(unittest.TestCase):
    def test_environment_order_is_semantically_equal_and_values_are_hashed(self):
        row, _, _ = fixture()
        original = completion.semantic_profile(row)
        row['Config']['Env'].reverse()
        self.assertEqual(completion.semantic_profile(row), original)
        self.assertNotIn('Env', original)
        row['Config']['Env'][0] = 'TWO=changed'
        self.assertNotEqual(completion.semantic_profile(row), original)

    def test_duplicate_environment_names_are_rejected(self):
        row, _, _ = fixture()
        row['Config']['Env'].append('ONE=another')
        with self.assertRaisesRegex(RuntimeError, 'Duplicate environment'):
            completion.semantic_profile(row)

    def test_equivalent_game_still_requires_unchanged_other_services(self):
        row, before, state = fixture()
        expected = completion.semantic_profile(row)
        completion.verify_profiles(state, before, expected, lambda: row)
        state['serviceProfiles']['royal-nile-play']['startedAt'] = 'restarted'
        with self.assertRaisesRegex(RuntimeError, 'Another persistent service'):
            completion.verify_profiles(state, before, expected, lambda: row)

    def test_every_effective_game_configuration_change_is_rejected(self):
        row, before, state = fixture()
        expected = completion.semantic_profile(row)
        mutations = [lambda r: r['Config']['Env'].append('NEW=1'),
            lambda r: r['Config'].update(Cmd=['other']),
            lambda r: r['HostConfig'].update(Memory=1),
            lambda r: r['Mounts'][0].update(RW=False),
            lambda r: r['NetworkSettings']['Networks'].pop('royal_payment_bridge'),
            lambda r: r['NetworkSettings']['Networks'].update(unreviewed={})]
        for mutate in mutations:
            changed = deepcopy(row)
            mutate(changed)
            with self.subTest(mutate=mutate), self.assertRaisesRegex(RuntimeError, 'Effective game configuration'):
                completion.verify_profiles(state, before, expected, lambda: changed)

    def test_container_race_and_protected_program_change_are_rejected(self):
        row, before, state = fixture()
        expected = completion.semantic_profile(row)
        changed = deepcopy(row)
        changed['Id'] = 'replacement'
        with self.assertRaisesRegex(RuntimeError, 'Game changed'):
            completion.verify_profiles(state, before, expected, lambda: changed)
        state['protectedPrograms']['nile']['play.js'] = 'changed'
        with self.assertRaisesRegex(RuntimeError, 'Protected service program'):
            completion.verify_profiles(state, before, expected, lambda: row)

    def test_recovery_allows_only_the_game_to_be_absent(self):
        row, before, state = fixture()
        state['container'] = None
        del state['serviceProfiles']['royal-game-1']
        completion.verify_profiles(state, before, completion.semantic_profile(row), lambda: self.fail('No absent-game inspection'))
        del state['serviceProfiles']['royal-nile-play']
        with self.assertRaisesRegex(RuntimeError, 'inventory changed'):
            completion.verify_profiles(state, before, completion.semantic_profile(row), lambda: row)

    def test_finalize_refuses_uncertain_daemon_outcome_before_any_write(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'publication-failed.json').write_text('{"daemonOutcomeUnknown":true}')
            base = SimpleNamespace(ROOT=root, write=lambda *args: self.fail('No writes allowed'))
            with self.assertRaisesRegex(RuntimeError, 'Unexpected publication failure'):
                completion.finalize(base, {}, {})

    def test_network_recovery_connects_only_missing_reviewed_networks(self):
        row, _, _ = fixture()
        expected = completion.semantic_profile(row)
        del row['NetworkSettings']['Networks']['royal_payment_bridge']
        commands = []
        completion.restore_networks(row, expected, ['candidate'], commands.append)
        self.assertEqual(commands, [['docker', 'network', 'connect', 'royal_payment_bridge', 'royal-game-1']])

    def test_network_recovery_refuses_foreign_images_and_extra_networks(self):
        row, _, _ = fixture()
        expected = completion.semantic_profile(row)
        with self.assertRaisesRegex(RuntimeError, 'Unreviewed replacement'):
            completion.restore_networks(row, expected, ['other'], lambda _: self.fail('No network mutation'))
        row['NetworkSettings']['Networks']['extra'] = {}
        with self.assertRaisesRegex(RuntimeError, 'Unexpected replacement network'):
            completion.restore_networks(row, expected, ['candidate'], lambda _: self.fail('No network mutation'))

    def test_finalize_finishes_metadata_without_recreating_container(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'publication-failed.json').write_text('{"errorType":"RuntimeError","reason":"Service configuration changed: royal-game-1","daemonOutcomeUnknown":false,"mutationStarted":true,"databaseRestored":false}')
            writes = {}
            base = SimpleNamespace(ROOT=root, LIVE=root, DELTA={}, CHANGES={'one': 'sha'}, SERVER_DELTA={'index.js': 'sha'},
                write=lambda name, value: writes.update({name: value}))
            state = {'preparedImage': 'candidate', 'container': {'image': 'candidate'}, 'services': {'game': {}, 'nile': {}}}
            result = completion.finalize(base, state, {'helperSourceCommit': 'reviewed-tool'})
            self.assertTrue(result['published'])
            self.assertFalse(result['completionRecreatedContainer'])
            self.assertEqual(result['sourceCommit'], completion.SOURCE)
            self.assertEqual(set(writes), {'after.json', 'completion.json', 'published.json'})


if __name__ == '__main__':
    unittest.main()
