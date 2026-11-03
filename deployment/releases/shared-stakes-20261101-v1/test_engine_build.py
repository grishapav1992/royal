import hashlib, importlib.util, io, json, tempfile, tarfile, unittest
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('engine_builder',Path(__file__).with_name('engine_build.py'));builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class EngineBuildTests(unittest.TestCase):
    def store(self,folder,value):
        raw=json.dumps(value).encode();h=hashlib.sha256(raw).hexdigest();(folder/h).write_bytes(raw);return 'sha256:'+h
    def fixture(self,folder):
        config=self.store(folder,{'config':{'User':'node','Env':['NODE_ENV=production']},'rootfs':{'diff_ids':['sha256:'+'a'*64]}})
        manifest=self.store(folder,{'schemaVersion':2,'config':{'digest':config}});return config,manifest
    def test_reads_exact_single_platform_layers(self):
        with tempfile.TemporaryDirectory() as t:
            config,manifest=self.fixture(Path(t));m=builder.metadata(manifest,Path(t));self.assertEqual(m['configDigest'],config);self.assertEqual(m['RootFS']['Layers'],['sha256:'+'a'*64])
    def test_selects_native_platform_from_index(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);config,manifest=self.fixture(root);index=self.store(root,{'manifests':[{'digest':manifest,'platform':{'os':'linux','architecture':'amd64'}}]});self.assertEqual(builder.metadata(index,root,'amd64')['configDigest'],config)
    def test_rejects_ambiguous_platform(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);_,manifest=self.fixture(root);row={'digest':manifest,'platform':{'os':'linux','architecture':'amd64'}};index=self.store(root,{'manifests':[row,row]})
            with self.assertRaisesRegex(RuntimeError,'Ambiguous'):builder.metadata(index,root,'amd64')
    def test_rejects_changed_oci_bytes(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);_,manifest=self.fixture(root);(root/manifest.split(':')[1]).write_text('{}')
            with self.assertRaisesRegex(RuntimeError,'checksum'):builder.metadata(manifest,root)
    def test_overlay_contains_only_reviewed_destinations_and_bytes(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();(root/'input.js').write_bytes(b'checked bytes')
            with tarfile.open(fileobj=io.BytesIO(builder.archive(root,{'input.js':'dist-server/index.js'}))) as a:
                member=a.getmembers()[0];self.assertEqual(member.name,'dist-server/index.js');self.assertEqual(member.uid,1000);self.assertEqual(a.extractfile(member).read(),b'checked bytes')
    def test_rejects_overlay_escape_and_symlink(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();(root/'input.js').write_text('bytes');(root/'link.js').symlink_to(root/'input.js')
            for source,dest in [('input.js','../escape'),('link.js','play.js')]:
                with self.assertRaises(RuntimeError):builder.archive(root,{source:dest})
    def test_only_layer_export_gets_the_longer_deadline(self):
        calls=[];owner=None
        def exchange(method,path,body=None,binary=False,timeout=300):
            nonlocal owner
            calls.append((method,path,timeout))
            if path.startswith('/containers/create'):
                owner=body['Labels']['royal.stake.build'];return json.dumps({'Id':'a'*64}).encode()
            if path.startswith('/commit?'):return json.dumps({'Id':'sha256:'+'b'*64}).encode()
            if method=='GET':return json.dumps({'Config':{'Labels':{'royal.stake.build':owner}},'State':{'Running':False}}).encode()
            return b''
        with patch.object(builder,'metadata',return_value={'Config':{}}),patch.object(builder,'archive',return_value=b'reviewed overlay'),patch.object(builder,'engine',side_effect=exchange):
            self.assertEqual(builder.build(Path('/reviewed'),'sha256:'+'c'*64,'royal-game','checked-release','d'*40,{}),'sha256:'+'b'*64)
        self.assertEqual([timeout for _,path,timeout in calls if path.startswith('/commit?')],[900])
        self.assertTrue(all(timeout==300 for _,path,timeout in calls if not path.startswith('/commit?')))
        self.assertFalse(any('/start' in path for _,path,_ in calls))

if __name__=='__main__':unittest.main()
