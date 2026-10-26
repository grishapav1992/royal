from pathlib import Path
import json
import runpy
import tempfile
import unittest


class CombatPriorityScope(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        module = runpy.run_path(str(Path(__file__).with_name('combat-publication-priority.py')))
        self.select = module['checked_rows']
        self.ns = self.select.__globals__
        for key, folder in [('ROOT','release'),('PROC','proc'),('CGROUP','cgroup'),('DOCKER','docker')]:
            path = self.root / folder; path.mkdir(); self.ns[key] = path
        self.identity = 'a' * 64
        self.game = {'ID':self.identity,'Name':'/royal-game-1','Image':'old-image','State':{'Running':True,'Pid':301}}
        self.manifest = {'moduleScope':'combat-only','sourceCommit':'37e5c750f92f9708f92c4c0695e5badcd3bb0366',
                         'before':{'container':{'image':'old-image','host':{'CpuShares':8192}}}}
        (self.ns['ROOT']/'install-manifest.json').write_text(json.dumps(self.manifest))
        self.metadata = self.ns['DOCKER']/self.identity/'config.v2.json'; self.metadata.parent.mkdir()
        self.metadata.write_text(json.dumps(self.game))
        self.group = '/system.slice/docker-' + self.identity + '.scope'
        self.process(301,'docker-init',self.group,532)

    def process(self,pid,name,group,weight):
        p=self.ns['PROC']/str(pid);p.mkdir();(p/'comm').write_text(name);(p/'cgroup').write_text('0::'+group)
        control=self.ns['CGROUP']/group.lstrip('/')/'cpu.weight';control.parent.mkdir(parents=True);control.write_text(str(weight))

    def test_game_scope_selects_only_the_reviewed_game(self):
        rows=self.select('game')
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['old'],532)
        self.assertIn('docker-'+self.identity+'.scope',rows[0]['path'])

    def test_services_scope_never_selects_a_financial_container(self):
        self.process(2877,'dockerd','/system.slice/docker.service',100)
        self.process(122534,'containerd','/system.slice/containerd.service',100)
        rows=self.select('services')
        self.assertEqual(len(rows),2)
        self.assertTrue(all('docker.service' in r['path'] or 'containerd.service' in r['path'] for r in rows))

    def test_foreign_game_image_is_refused(self):
        self.game['Image']='unreviewed-image';self.metadata.write_text(json.dumps(self.game))
        with self.assertRaises(AssertionError):self.select('game')

    def test_wrong_process_control_group_is_refused(self):
        (self.ns['PROC']/'301/cgroup').write_text('0::/system.slice/financial.service')
        with self.assertRaises(AssertionError):self.select('game')

    def test_unexpected_existing_weight_is_not_overwritten(self):
        (self.ns['CGROUP']/self.group.lstrip('/')/'cpu.weight').write_text('777')
        with self.assertRaises(AssertionError):self.select('game')

    def test_unknown_scope_is_refused(self):
        with self.assertRaises(ValueError):self.select('finance')


if __name__=='__main__':
    unittest.main()
