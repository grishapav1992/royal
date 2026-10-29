"""Apply a reviewed inventory-only correction and publish the already verified images."""
from pathlib import Path
from datetime import datetime,timezone
import fcntl,hashlib,json,os,re,shutil,subprocess,sys

ROOT=Path(__file__).resolve().parent
assert ROOT==Path('/opt/royal-releases/jackie-chan-20261029-v2')
os.umask(0o077)
RUNTIME_SOURCE='ee9319121f33bf14f45bacae448d21d62a17df9e'
ORIGINAL_MANIFEST='fc36a481ecc208bd013cef043fac5df8c4d5807c8ee9c3d4d5a453eb4dda7093'
IMAGES={'game':'sha256:452a691baa92825409c6f66483b50efdb2e5142ab172de6e93b4eccd33cd4d5b','finance':'sha256:041e861af11fce6e2b95c5ad79de8b91524dea861c3e6148e0cf71e195ddc957'}
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
installer=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',installer)
lock=(ROOT/'resume.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert not any((ROOT/name).exists() for name in ['resume-job.json','resume-exit.json','published.json','finance-published.json','module-published.json'])
receipt=load(ROOT/'installer-patch.json')
assert receipt['sourceCommit']==installer and receipt['runtimeSourceCommit']==RUNTIME_SOURCE
assert sha(__file__)==receipt['files']['resume-release.py']
assert set(receipt['files'])=={'snapshot.py','test_deploy.py','resume-release.py'}
assert sha(ROOT/'install-manifest.json')==ORIGINAL_MANIFEST==receipt['originalManifestSha256']
manifest=load(ROOT/'install-manifest.json');assert manifest['sourceCommit']==RUNTIME_SOURCE
assert load(ROOT/'exit.json')['exitCode']==1
assert 'snapshot.py' in (ROOT/'release.log').read_text() and 'royal-nile-account-views-once' in (ROOT/'release.log').read_text()
for name,digest in manifest['payload'].items():assert sha(ROOT/name)==digest,name
for name in ['snapshot.py','test_deploy.py']:assert sha(ROOT/('reviewed-'+name))==receipt['files'][name]
release=load(ROOT/'installer-release-manifest.json');github=load(ROOT/'installer-release-github.json')
assert release['sourceCommit']==github['sourceCommit']==installer and release['githubVerified'] and release['build']['passed']
assert release['baseCommit']==manifest['baseCommit']
for name,digest in release['files'].items():
    if name.startswith('module-dist/original-jackie-chan/'):
        assert manifest['modules'][name.removeprefix('module-dist/')]==digest and sha(ROOT/name)==digest
built=load(ROOT/'build-result.json');assert built['sourceCommit']==RUNTIME_SOURCE
for key,image in IMAGES.items():
    assert built[key]==image
    actual=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True))[0]
    assert actual['Id']==image and actual['Config']['Labels']['org.opencontainers.image.revision']==RUNTIME_SOURCE
expected={**manifest['before']['program'],**{'dist/'+k:v for k,v in manifest['dist'].items()},**{'module-dist/'+k:v for k,v in manifest['modules'].items()},**{'dist-server/'+k:v for k,v in manifest['backend'].items()}}
assert built['program']==expected
shutil.copyfile(ROOT/'install-manifest.json',ROOT/'install-manifest-runtime-original.json')
for name in ['snapshot.py','test_deploy.py']:
    os.replace(ROOT/('reviewed-'+name),ROOT/name);manifest['payload'][name]=receipt['files'][name]
for name in ['resume-release.py','installer-patch.json','installer-release-manifest.json','installer-release-github.json']:manifest['payload'][name]=sha(ROOT/name)
manifest['installerSourceCommit']=installer
manifest['installerPatch']={'originalManifestSha256':ORIGINAL_MANIFEST,'onlyInventoryHelpersChanged':True,'runtimeArtifactsUnchanged':True}
temporary=ROOT/'install-manifest-reviewed.json';temporary.write_text(json.dumps(manifest,indent=2)+'\n');os.replace(temporary,ROOT/'install-manifest.json')
started=datetime.now(timezone.utc).isoformat()
(ROOT/'resume-job.json').write_text(json.dumps({'sourceCommit':RUNTIME_SOURCE,'installerSourceCommit':installer,'pid':os.getpid(),'startedAt':started}))
with (ROOT/'resume-release.log').open('w') as log:
    tests=subprocess.run(['python3',str(ROOT/'test_deploy.py')],stdout=log,stderr=subprocess.STDOUT)
    result=tests if tests.returncode else subprocess.run(['python3',str(ROOT/'deploy.py'),'publish'],env={**os.environ,'DOCKER_BUILDKIT':'0'},stdout=log,stderr=subprocess.STDOUT)
(ROOT/'resume-exit.json').write_text(json.dumps({'sourceCommit':RUNTIME_SOURCE,'installerSourceCommit':installer,'exitCode':result.returncode,'endedAt':datetime.now(timezone.utc).isoformat()}))
sys.exit(result.returncode)
