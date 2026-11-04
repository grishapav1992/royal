import copy, importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('manual_deploy',Path(__file__).with_name('deploy.py'))
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)

class Guards(unittest.TestCase):
    def test_catalogue_keeps_exactly_current_games(self):
        games=['tsu-e-fa']+['game-'+str(n) for n in range(19)]
        manifest={'activeGames':games,'packages':{n:{} for n in games[1:]},'addedGames':[],'restoredGames':[]}
        deploy.validate_catalogue(manifest,{'activeGames':games})
        for field in ['addedGames','restoredGames']:
            changed=copy.deepcopy(manifest);changed[field]=['retired-game']
            with self.assertRaises(RuntimeError):deploy.validate_catalogue(changed,{'activeGames':games})
        changed=copy.deepcopy(manifest);changed['packages']['tsu-e-fa']={}
        with self.assertRaises(RuntimeError):deploy.validate_catalogue(changed,{'activeGames':games})

    def test_projection_cannot_add_an_unreviewed_input(self):
        manifest={'baseCommit':'a'*40,'before':{'source':{'src/a.ts':'a'},'sourceLF':{'src/a.ts':'a'}}}
        scope={'expectedSources':{'src/b.ts':'b'}}
        graph={'productionCommit':'a'*40,'inputs':{'src/a.ts':'a','src/b.ts':'b'}}
        deploy.validate_inputs(graph,manifest,scope)
        for name,value in [('src/a.ts','changed'),('src/c.ts','unexpected')]:
            changed=copy.deepcopy(graph);changed['inputs'][name]=value
            with self.assertRaises(RuntimeError):deploy.validate_inputs(changed,manifest,scope)

    def test_projection_baseline_is_fixed(self):
        with self.assertRaises(RuntimeError):deploy.validate_inputs({'productionCommit':'later','inputs':{}},{'baseCommit':'reviewed'},{})

    def test_module_pointer_updates_keep_every_other_byte(self):
        previous={'/other/file':'unchanged','/opt/royal-game-modules/game/active.json':'old'}
        manifest={'before':{'moduleFiles':previous},'packages':{'game':{'version':'1-new','files':{'manifest.json':'manifest'},'pointerSha256':'new'}}}
        self.assertEqual(deploy.expected_modules(manifest,[]),previous)
        current=deploy.expected_modules(manifest,['game'])
        self.assertEqual(current['/other/file'],'unchanged')
        self.assertEqual(current['/opt/royal-game-modules/game/active.json'],'new')
        self.assertEqual(current['/opt/royal-game-modules/game/versions/1-new/manifest.json'],'manifest')

    def test_recovery_retains_immutable_module_versions(self):
        manifest={'before':{'moduleFiles':{'/opt/royal-game-modules/game/active.json':'old'}},'packages':{'game':{'version':'1-new','files':{'entry.js':'entry'},'pointerSha256':'new'}}}
        restored=deploy.expected_modules(manifest,['game'],True)
        self.assertEqual(restored['/opt/royal-game-modules/game/active.json'],'old')
        self.assertEqual(restored['/opt/royal-game-modules/game/versions/1-new/entry.js'],'entry')

if __name__=='__main__':unittest.main()
