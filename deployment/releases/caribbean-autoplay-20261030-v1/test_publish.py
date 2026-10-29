import importlib.util,json,hashlib,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish.py'));publication=importlib.util.module_from_spec(spec);spec.loader.exec_module(publication)
class Guards(unittest.TestCase):
 def test_scope_preserves_the_installed_host_and_excludes_other_games_and_sources(self):
  release={'scope':'modules','modules':['caribbean-treasures'],'build':{'passed':True},'sourceCommit':'a'*40,'baseCommit':'b'*40,'packages':[{'gameId':publication.GAME}]}
  before={'sourceCommit':'b'*40};operator={'sourceCommit':'a'*40,'source':dict.fromkeys(publication.SOURCES,'x')};publication.validate_scope(release,before,operator)
  for item in [{**release,'scope':'application'},{**release,'modules':['girlhub']},{**release,'baseCommit':'c'*40}]:
   with self.assertRaises(RuntimeError):publication.validate_scope(item,before,operator)
  with self.assertRaises(RuntimeError):publication.validate_scope(release,before,{**operator,'source':{**operator['source'],'server/index.ts':'x'}})
 def test_immutable_media_is_reused_without_copying_or_changing_its_bytes(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);old=root/'old';delta=root/'delta';target=root/'package';old.mkdir();delta.mkdir();(old/'media').mkdir()
   (old/'media/art.webp').write_bytes(b'retained immutable media');(delta/'entry.js').write_bytes(b'new client');(delta/'manifest.json').write_text('{}')
   metadata={'files':{'media/art.webp':publication.sha(old/'media/art.webp'),'entry.js':publication.sha(delta/'entry.js')}}
   publication.materialize(old,metadata,delta,target)
   self.assertEqual((old/'media/art.webp').stat().st_ino,(target/'media/art.webp').stat().st_ino)
   self.assertEqual((old/'media/art.webp').read_bytes(),b'retained immutable media')
 def test_missing_changed_resource_and_symlinks_are_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);old=root/'old';delta=root/'delta';old.mkdir();delta.mkdir();(delta/'manifest.json').write_text('{}')
   with self.assertRaises(RuntimeError):publication.materialize(old,{'files':{'missing.js':'a'*64}},delta,root/'missing')
   (old/'real.js').write_bytes(b'old');(old/'link.js').symlink_to(old/'real.js')
   with self.assertRaises(RuntimeError):publication.materialize(old,{'files':{'link.js':publication.sha(old/'real.js')}},delta,root/'links')
if __name__=='__main__':unittest.main()
