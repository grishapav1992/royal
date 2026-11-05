from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import publish


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.source = {name: 'new' for name in publish.SOURCES}
        self.before = {'sourceCommit': 'base', 'source': {name: 'old' for name in self.source},
                       'sourceLF': {**{name: 'old' for name in self.source}, 'shared.ts': 'live'},
                       'moduleFiles': {'other': 'untouched'}, 'program': {'server.js': 'live'}}
        self.proof = {'hostSingletonsExternalized': True, 'serverImplementationIncluded': False,
                      'sourceFiles': {'shared.ts': 'live'}}
        self.release = {'scope': 'modules', 'modules': [publish.GAME], 'build': {'passed': True},
                        'sourceCommit': 'next', 'baseCommit': 'build-base', 'packages': [{'gameId': publish.GAME}],
                        'moduleProjection': {'productionCommit': 'build-base', 'inputs': {**self.source, 'shared.ts': 'live'},
                                             'modules': {publish.GAME: {'sourceFiles': self.proof['sourceFiles']}}}}
        self.operator = {'sourceCommit': 'next', 'baseCommit': 'base', 'buildBaseCommit': 'build-base', 'source': self.source}

    def test_binds_changed_files_and_compiles_other_inputs_from_the_live_host(self):
        publish.validate_inputs(self.before, self.release, self.operator, self.proof)
        self.release['moduleProjection']['inputs']['shared.ts'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'Unreviewed module input'):
            publish.validate_inputs(self.before, self.release, self.operator, self.proof)

    def test_rejects_a_second_module_or_extra_source(self):
        self.release['modules'].append('unrelated')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected release scope'):
            publish.validate_inputs(self.before, self.release, self.operator, self.proof)
        self.release['modules'].pop()
        self.operator['source']['server/index.ts'] = 'unreviewed'
        with self.assertRaisesRegex(RuntimeError, 'Unexpected source update'):
            publish.validate_inputs(self.before, self.release, self.operator, self.proof)

    def test_checks_other_module_pointers_and_program_bytes_after_publication(self):
        after = deepcopy(self.before)
        after['source'].update(self.source)
        after['sourceLF'].update(self.source)
        root = str(publish.MODULES / publish.GAME)
        after['moduleFiles'].update({root + '/versions/version/manifest.json': 'manifest', root + '/active.json': 'pointer'})
        publish.validate_after(self.before, after, self.source, {'manifest.json': 'manifest'}, 'pointer', 'version')
        after['program']['server.js'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'Unexpected change'):
            publish.validate_after(self.before, after, self.source, {'manifest.json': 'manifest'}, 'pointer', 'version')

    def test_busy_lock_releases_the_preceding_lock(self):
        with TemporaryDirectory() as folder:
            locks = [Path(folder) / str(i) for i in range(3)]
            with patch.object(publish, 'LOCKS', locks), locks[1].open('a') as busy:
                publish.fcntl.flock(busy, publish.fcntl.LOCK_EX | publish.fcntl.LOCK_NB)
                with self.assertRaises(publish.PublicationBusy), publish.publication_locks():
                    self.fail('Entered publication while busy')
                with locks[0].open('a') as first:
                    publish.fcntl.flock(first, publish.fcntl.LOCK_EX | publish.fcntl.LOCK_NB)
            with patch.object(publish, 'LOCKS', locks), publish.publication_locks():
                pass


if __name__ == '__main__':
    unittest.main()
