"""Exercise publication isolation without Docker or production state."""
from pathlib import Path
import importlib.util
import unittest

spec=importlib.util.spec_from_file_location('forest_guard',Path(__file__).with_name('guard.py'))
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)

class Isolation(unittest.TestCase):
    def test_only_reviewed_host_and_forest_sources_are_allowed(self):
        good=set(guard.HOST_SOURCES)|{'games/forest-heart/ForestLayout.ts'}
        guard.source_scope(good)
        for foreign in ['server/index.ts','src/game/RoomScene.ts','games/caribbean-treasures/CaribbeanUI.ts','.env','games/forest-heart/../../server/index.ts']:
            with self.assertRaises(RuntimeError):guard.source_scope(good|{foreign})
        with self.assertRaises(RuntimeError):guard.source_scope({'games/forest-heart/styles.ts'})

    def test_changed_baseline_and_unmatched_prepared_runtime_are_rejected(self):
        before={'health':'healthy','program':{'dist/index.html':'old'},'preparedProgram':{'dist/index.html':'old'}}
        guard.stable(before,before)
        with self.assertRaises(RuntimeError):guard.stable({**before,'health':'unhealthy'},before)
        damaged={**before,'preparedProgram':{'dist/index.html':'other'}}
        with self.assertRaises(RuntimeError):guard.stable(damaged,damaged)

    def test_only_one_pointer_and_exact_new_immutable_files_may_change(self):
        before={'other/active.json':'keep','studio-forest-heart/active.json':'old','studio-forest-heart/versions/old/entry.js':'keep-old'}
        meta={'version':'new','files':{'entry.js':'new-js'},'_manifestSha256':'manifest'}
        after={**before,'studio-forest-heart/active.json':'new-pointer','studio-forest-heart/versions/new/entry.js':'new-js','studio-forest-heart/versions/new/manifest.json':'manifest'}
        guard.module_scope(before,after,meta,'new-pointer')
        for changed in [{**after,'other/active.json':'tampered'},{**after,'studio-forest-heart/versions/old/entry.js':'tampered'},{**after,'studio-forest-heart/versions/new/extra.js':'unknown'}]:
            with self.assertRaises(RuntimeError):guard.module_scope(before,changed,meta,'new-pointer')

if __name__=='__main__': unittest.main()
