import hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('cleanup',Path(__file__).with_name('cleanup-release-history.py'))
cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value))
    return hashlib.sha256(path.read_bytes()).hexdigest()

class ModuleSetRetention(unittest.TestCase):
    def fixture(self,base):
        root=Path(base).resolve();release=root/'releases'/'viewport';backup=root/'backups'/'viewport';live=root/'live';modules=root/'modules'
        archive=backup/'source.tgz';archive.parent.mkdir(parents=True);archive.write_bytes(b'verified scoped source archive')
        source={'src/ui/viewport.css':'responsive','games/one/entry.ts':'entry one','games/two/entry.ts':'entry two'}
        hashes={}
        for name,text in source.items():
            p=live/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);hashes[name]=cleanup.sha(p)
        commit='a'*40;packages={};results=[];files={};proof={}
        for slug in ['one','two']:
            game='game-'+slug;version='1.0.0-new';digest=write(modules/game/'versions'/version/'manifest.json',{'gameId':game,'version':version})
            pointer={'manifest':'/game-modules/'+game+'/versions/'+version+'/manifest.json','sha256':digest}
            pointer_sha=write(modules/game/'active.json',pointer);packages[game]={'pointerSha256':pointer_sha}
            results.append({'gameId':game,'version':version,'verified':True})
            files['module-dist/'+game+'/active.json']=pointer_sha
            files['module-dist/'+game+'/versions/'+version+'/manifest.json']=digest
            old=write(backup/game/'manifest.json',{'gameId':game,'version':'old'})
            proof[game]={'passed':True,'beforeManifest':old,'afterManifest':digest}
        receipt_sha=write(release/'release-github.json',{'sourceCommit':commit,'remoteMain':commit})
        manifest={'sourceCommit':commit,'scope':'modules','build':{'passed':True},'modules':['one','two'],
                  'packages':results,'files':files,'moduleProjection':{'inputs':hashes}}
        manifest_sha=write(release/'release-manifest.json',manifest)
        proof_sha=write(release/'program-proof.json',{'sourceCommit':commit,'games':proof})
        operator={'sourceCommit':commit,'source':hashes,'packages':packages,'receiptSha256':receipt_sha,
                  'releaseManifestSha256':manifest_sha,'programProofSha256':proof_sha}
        write(release/'operator.json',operator)
        write(release/'published.json',{'published':True,'sourceCommit':commit,'modules':results,
              'backup':{'sourceArchive':str(archive),'sha256':cleanup.sha(archive)}})
        return root,release,backup,live,modules,hashes

    def check(self,fixture):
        root,release,backup,live,modules,hashes=fixture
        with patch.object(cleanup,'RELEASES',root/'releases'),patch.object(cleanup,'BACKUPS',root/'backups'),patch.object(cleanup,'LIVE',live),patch.object(cleanup,'MODULES',modules):
            return cleanup.module_source_proof('src/ui/viewport.css',hashes['src/ui/viewport.css'])

    def test_complete_current_set_retains_its_rollback(self):
        with tempfile.TemporaryDirectory() as base:
            fixture=self.fixture(base);proof=self.check(fixture)
            self.assertIn(fixture[2]/'source.tgz',proof)
            self.assertIn(fixture[2]/'game-one'/'manifest.json',proof)

    def test_any_newer_pointer_or_changed_source_rejects_the_whole_set(self):
        for mutation in ['pointer','source','new manifest','old manifest']:
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as base:
                fixture=self.fixture(base);root,release,backup,live,modules,hashes=fixture
                path={'pointer':modules/'game-two'/'active.json','source':live/'games/two/entry.ts',
                      'new manifest':modules/'game-two/versions/1.0.0-new/manifest.json','old manifest':backup/'game-two/manifest.json'}[mutation]
                path.write_text('changed')
                self.assertIsNone(self.check(fixture))

    def test_unbound_receipts_and_partial_publication_are_rejected(self):
        for name in ['release-github.json','release-manifest.json','program-proof.json','published.json']:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as base:
                fixture=self.fixture(base);p=fixture[1]/name;data=json.loads(p.read_text())
                if name=='published.json':data['modules'].pop()
                else:data['sourceCommit']='b'*40
                write(p,data);self.assertIsNone(self.check(fixture))

    def test_application_source_cannot_be_smuggled_into_a_module_receipt(self):
        with tempfile.TemporaryDirectory() as base:
            fixture=self.fixture(base);root,release,backup,live,modules,hashes=fixture
            op=json.loads((release/'operator.json').read_text());op['source']['server/demoWallet.ts']='bad';write(release/'operator.json',op)
            self.assertIsNone(self.check(fixture))

if __name__=='__main__':unittest.main()
