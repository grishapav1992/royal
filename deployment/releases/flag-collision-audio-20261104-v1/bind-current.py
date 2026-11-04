"""Bind the fixed module artifact to the completed host publication, before install."""
import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path

root=Path('/opt/royal-releases/flag-collision-audio-20261104-v1')
after_path,reader,commit,image=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3],sys.argv[4]
assert root.is_dir() and not root.is_symlink()
assert reader.name=='snapshot.py' and reader.parent.parent==Path('/opt/royal-releases')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
read=lambda p:json.loads(Path(p).read_text())
before=read(after_path);op=read(root/'operator.json');proof=read(root/'module-proof.json')
assert before['sourceCommit']==commit and before['container']['image']==before['preparedImage']==image
assert before['container']['health']=='healthy'
actual=subprocess.check_output(['docker','container','inspect','royal-game-1','--format','{{.Id}} {{.Image}}'],text=True).strip()
assert actual==before['container']['id']+' '+image
assert before['moduleHost']['games']['flag-battle']=={'apiVersion':1,'rulesVersion':2,'progressVersion':1}
expected_sources={
 'games/flag-battle/FlagAudio.ts':'45316e89e621eed3b0276c1038cd0dfea4f4801d8840d6c2020c5f66333883bf',
 'games/flag-battle/package.json':'c3320c93332095d70b32aa7946e852b028c5e3d7bf70659ecee3ec2ce0ae4a3c',
 'games/flag-battle/tsconfig.json':'8c853be9f2b69ec71f4a989a382c2019a41838a8fe8227fe069a865e3b3a0ad2',
}
for name,digest in expected_sources.items():assert before['source'][name]==digest,'Concurrent Flag Battle source change: '+name
pointer=read('/opt/royal-game-modules/flag-battle/active.json')
assert pointer['manifest']=='/game-modules/flag-battle/versions/2.1.1-f46d7dfea3df/manifest.json','Concurrent Flag Battle package change'
assert op['sourceCommit']=='88a99af8c49ac43530c2fb9ae93a8abb4576c60d'
for name,digest in proof['sourceFiles'].items():
 assert digest==(op['source'].get(name) or before['sourceLF'].get(name)), 'Changed game input: '+name
for name,digest in op['source'].items():assert sha(root/'source'/name)==digest
assert sha(root/'publish.py')==op['wrapperSha256']
assert sha(root/'publisher.py')==op['publisherSha256']==before['source']['scripts/game-module-release.py']
image_helper='/opt/royal-maintenance/bin/retention-runtime.py'
assert sha(image_helper)==op['helpers'][image_helper]
helpers={image_helper:sha(image_helper),'/opt/royal/scripts/game-module-release.py':sha('/opt/royal/scripts/game-module-release.py')}
for name in ['snapshot.py','snapshot-base.py','image_metadata.py','runtime-inventory.cjs','install-manifest.json','build-result.json']:
 file=reader.parent/name
 assert file.is_file() and not file.is_symlink(), 'Missing reader binding: '+str(file)
 helpers[str(file)]=sha(file)
op['helpers']=helpers;op['baseCommit']=commit
receipt=read(root/'release-github.json')
assert receipt['sourceCommit']==op['sourceCommit'] and receipt['manifestSha256']==sha(root/'release-manifest.json')
op['receiptSha256']=sha(root/'release-github.json')
temporary=root/'before.json.pending';assert not temporary.exists()
shutil.copyfile(after_path,temporary);temporary.chmod(0o600);os.replace(temporary,root/'before.json')
temporary=root/'operator.json.pending'
with temporary.open('x') as out:json.dump(op,out,indent=2);out.write('\n');out.flush();os.fsync(out.fileno())
temporary.chmod(0o600);os.replace(temporary,root/'operator.json')
print(json.dumps({'bound':True,'sourceCommit':op['sourceCommit'],'baseCommit':commit,'image':image,'reader':str(reader),'beforeSha256':sha(root/'before.json')}))
