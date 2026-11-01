import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('shared_cleanup',Path(__file__).with_name('cleanup-release-history.py'));cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)
class SharedSourceProof(unittest.TestCase):
 def test_all_current_pointers_and_committed_receipts_are_required(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);releases=root/'releases';modules=root/'modules';folder=releases/'five-games';folder.mkdir(parents=True)
   name='src/ui/slotKit/SlotCascadeBoard.ts';digest='b'*64;source='a'*40;games=['studio-one','studio-two'];version='1.0.1';files={};packages={}
   for game in games:
    active=modules/game/'active.json';active.parent.mkdir(parents=True);active.write_text(json.dumps({'manifest':f'/game-modules/{game}/versions/{version}/manifest.json','sha256':'c'*64}))
    packages[game]={'pointerSha256':cleanup.sha(active)};files[f'module-dist/{game}/active.json']=cleanup.sha(active);files[f'module-dist/{game}/versions/{version}/manifest.json']='c'*64
   manifest={'sourceCommit':source,'scope':'modules','build':{'passed':True},'moduleProjection':{'inputs':{name:digest}},'packages':[{'gameId':g,'version':version} for g in games],'files':files}
   receipt={'sourceCommit':source,'remoteMain':source};published={'published':True,'sourceCommit':source,'modules':[{'gameId':g,'version':version,'verified':True} for g in games]}
   for filename,value in [('release-manifest.json',manifest),('release-github.json',receipt),('published.json',published)]: (folder/filename).write_text(json.dumps(value))
   operator={'sourceCommit':source,'source':{name:digest},'packages':packages,'receiptSha256':cleanup.sha(folder/'release-github.json'),'releaseManifestSha256':cleanup.sha(folder/'release-manifest.json')};(folder/'operator.json').write_text(json.dumps(operator))
   with patch.object(cleanup,'RELEASES',releases),patch.object(cleanup,'MODULES',modules):
    self.assertEqual(len(cleanup.module_source_proof(name,digest)),4)
    self.assertIsNone(cleanup.module_source_proof('server/index.ts',digest))
    self.assertIsNone(cleanup.module_source_proof(name,'d'*64))
    (modules/games[1]/'active.json').write_text('{}');self.assertIsNone(cleanup.module_source_proof(name,digest))
if __name__=='__main__':unittest.main()
