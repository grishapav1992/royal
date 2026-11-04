import hashlib,io,json,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import test_module_set_retention as base_tests
write,cleanup=base_tests.write,base_tests.cleanup


class ScopedModuleSuccessors(unittest.TestCase):
    def fixture(self,base):
        f=base_tests.ModuleSetRetention().fixture(base)
        root,release,backup,live,modules,hashes=f
        write(live/'games/two/package.json',{'gameId':'game-two'})
        m=json.loads((release/'release-manifest.json').read_text())
        m['moduleProjection']['modules']={'game-two':{'sourceFiles':{'src/ui/viewport.css':hashes['src/ui/viewport.css']}}}
        h=write(release/'release-manifest.json',m)
        op=json.loads((release/'operator.json').read_text());op['releaseManifestSha256']=h;write(release/'operator.json',op)
        return f

    def transition(self,f,index):
        root,original,original_backup,live,modules,hashes=f;game='game-two';source='games/two/entry.ts'
        release=root/'releases'/('scoped-'+str(index));backup=root/'backups'/release.name
        active=modules/game/'active.json';old_pointer=active.read_bytes();old=json.loads(old_pointer)
        old_manifest=(modules/game/'versions'/old['manifest'].split('/')[4]/'manifest.json').read_bytes()
        backup.mkdir(parents=True);archive=backup/'source.tgz'
        with tarfile.open(archive,'w:gz') as out:
            for name,data in [('active.json',old_pointer),('prior-manifest.json',old_manifest),(source,(live/source).read_bytes())]:
                member=tarfile.TarInfo(name);member.size=len(data);out.addfile(member,io.BytesIO(data))
        (live/source).write_text('scoped source '+str(index));digest=cleanup.sha(live/source)
        version='1.0.0-scoped'+str(index)
        manifest_digest=write(modules/game/'versions'/version/'manifest.json',{'gameId':game,'version':version})
        pointer=write(active,{'manifest':'/game-modules/'+game+'/versions/'+version+'/manifest.json','sha256':manifest_digest})
        commit=str(index+1)*40
        result={'gameId':game,'version':version,'verified':True,'published':True,'beforeSha256':hashlib.sha256(old_pointer).hexdigest(),'activeSha256':pointer}
        manifest={'sourceCommit':commit,'scope':'modules','build':{'passed':True},'modules':['two'],
            'packages':[{'gameId':game,'version':version}],'moduleProjection':{'inputs':{source:digest,'src/ui/viewport.css':hashes['src/ui/viewport.css']}},
            'files':{'module-dist/'+game+'/active.json':pointer,'module-dist/'+game+'/versions/'+version+'/manifest.json':manifest_digest}}
        mh=write(release/'release-manifest.json',manifest)
        write(release/'release-github.json',{'sourceCommit':commit,'remoteMain':commit,'manifestSha256':mh})
        write(release/'operator.json',{'sourceCommit':commit,'source':{source:digest},'pointerSha256':pointer})
        write(release/'published.json',{'published':True,'sourceCommit':commit,'module':result,
            'backup':{'sourceArchive':str(archive),'sha256':cleanup.sha(archive)}})
        return release,backup

    def check(self,f):
        return base_tests.ModuleSetRetention().check(f)

    def test_scoped_handoff_preserves_the_original_group_and_both_backups(self):
        with tempfile.TemporaryDirectory() as base:
            f=self.fixture(base);release,backup=self.transition(f,1);proof=self.check(f)
            self.assertIn(f[2]/'source.tgz',proof);self.assertIn(backup/'source.tgz',proof)
            self.assertIn(release/'release-manifest.json',proof)

    def test_multiple_handoffs_remain_verifiable_after_retiring_intermediate_versions(self):
        with tempfile.TemporaryDirectory() as base:
            f=self.fixture(base);one=self.transition(f,1);two=self.transition(f,2)
            for version in ['1.0.0-new','1.0.0-scoped1']:
                (f[4]/'game-two/versions'/version/'manifest.json').unlink()
            proof=self.check(f)
            self.assertIn(one[1]/'source.tgz',proof);self.assertIn(two[1]/'source.tgz',proof)

    def test_unbound_handoffs_cannot_replace_a_group_pointer(self):
        for mutation in ['previous pointer','receipt','source','shared input','manifest','archive','owner','archived source','archived manifest','archived pointer']:
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as base:
                f=self.fixture(base);release,backup=self.transition(f,1)
                if mutation=='previous pointer':
                    p=release/'published.json';v=json.loads(p.read_text());v['module']['beforeSha256']='0'*64;write(p,v)
                elif mutation=='receipt':
                    p=release/'release-github.json';v=json.loads(p.read_text());v['manifestSha256']='0'*64;write(p,v)
                elif mutation=='source':(f[3]/'games/two/entry.ts').write_text('unpublished')
                elif mutation=='shared input':
                    p=release/'release-manifest.json';v=json.loads(p.read_text());v['moduleProjection']['inputs']['src/ui/viewport.css']='0'*64
                    h=write(p,v);p=release/'release-github.json';v=json.loads(p.read_text());v['manifestSha256']=h;write(p,v)
                elif mutation=='manifest':(f[4]/'game-two/versions/1.0.0-scoped1/manifest.json').write_text('{}')
                elif mutation=='archive':(backup/'source.tgz').write_bytes(b'changed')
                elif mutation=='owner':write(f[3]/'games/two/package.json',{'gameId':'another-game'})
                else:
                    archive=backup/'source.tgz'
                    with tarfile.open(archive,'r:gz') as saved:members={m.name:saved.extractfile(m).read() for m in saved.getmembers()}
                    target={'archived source':'games/two/entry.ts','archived manifest':'prior-manifest.json','archived pointer':'active.json'}[mutation]
                    members[target]=b'{}'
                    with tarfile.open(archive,'w:gz') as saved:
                        for n,data in members.items():
                            m=tarfile.TarInfo(n);m.size=len(data);saved.addfile(m,io.BytesIO(data))
                    p=release/'published.json';v=json.loads(p.read_text());v['backup']['sha256']=cleanup.sha(archive);write(p,v)
                self.assertIsNone(self.check(f))

    def test_unchanged_sources_still_require_their_original_receipts(self):
        with tempfile.TemporaryDirectory() as base:
            f=self.fixture(base);self.transition(f,1)
            (f[1]/'program-proof.json').write_text('{}')
            self.assertIsNone(self.check(f))

if __name__=='__main__':unittest.main()
