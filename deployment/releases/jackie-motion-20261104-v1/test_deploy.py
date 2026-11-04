import copy, importlib.util, unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('jackie_visual_release',Path(__file__).with_name('deploy.py'))
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)

class PublicationScope(unittest.TestCase):
    def fixture(self):
        source={name:'a'*64 for name in deploy.ALLOWED};commit='a'*40;version='1.2.1-0123456789ab'
        prefix='module-dist/'+deploy.GAME+'/versions/'+version+'/'
        scope={'release':deploy.NAME,'gameId':deploy.GAME,'sourceBefore':source.copy(),'sourceAfter':source.copy(),'preparedBase':'b'*40,'previousPointerSha256':'c'*64,'addedGames':[],'restoredGames':[]}
        files={'manifest.json':'d'*64,'entry-0123456789abcdef.js':'e'*64}
        m={'release':deploy.NAME,'sourceCommit':commit,'version':version,'source':source.copy(),'packageFiles':files.copy(),'pointerSha256':'f'*64}
        release={'sourceCommit':commit,'scope':'modules','modules':['jackie-chan'],'build':{'passed':True},'baseCommit':scope['preparedBase'],
            'moduleProjection':{'productionCommit':scope['preparedBase'],'inputs':source.copy()},
            'packages':[{'gameId':deploy.GAME,'version':version,'pointer':'module-dist/'+deploy.GAME+'/active.json'}],
            'files':{**{prefix+n:h for n,h in files.items()},'module-dist/'+deploy.GAME+'/active.json':m['pointerSha256']}}
        receipt={'sourceCommit':commit,'remoteMain':'b'*40}
        return m,release,receipt,scope

    def test_exact_visual_scope_is_accepted(self): deploy.validate(*self.fixture())

    def test_wallet_source_or_another_package_cannot_be_added(self):
        for kind in ['source','package','catalogue']:
            m,r,g,s=self.fixture()
            if kind=='source':m['source']['server/demoWallet.ts']='a'*64
            elif kind=='package':r['packages'].append({'gameId':'royal-roulette'})
            else:s['restoredGames']=['retired-game']
            with self.subTest(kind=kind),self.assertRaises(RuntimeError):deploy.validate(m,r,g,s)

    def test_stale_build_or_github_identity_is_rejected(self):
        for kind in ['source','receipt','input','manifest']:
            m,r,g,s=self.fixture()
            if kind=='source':m['sourceCommit']='b'*40
            elif kind=='receipt':g['remoteMain']='missing'
            elif kind=='input':r['moduleProjection']['inputs'][next(iter(m['source']))]='b'*64
            else:m['packageFiles']['manifest.json']='b'*64
            with self.subTest(kind=kind),self.assertRaises(RuntimeError):deploy.validate(m,r,g,s)

if __name__=='__main__':unittest.main()
