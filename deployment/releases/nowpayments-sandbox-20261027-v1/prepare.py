"""Prepare the exact committed security overlay without copying the complete project or dependencies."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import re
import shutil
import subprocess
import sys

if not __debug__:
    raise RuntimeError('Optimized Python would disable release verification')


def payment_source(name):
    return name in json.loads((Path(__file__).parent/'scope.json').read_text())


def dependency_transition(old_lock, new_lock):
    assert old_lock == new_lock, 'A Sandbox release must preserve the complete dependency lock'
    return set()


def unchanged_dependencies(stage, before, sha, versions=None):
    expected = {}
    for package, version in versions or [('body-parser', '2.4.0'), ('qs', '6.16.1')]:
        folder = stage/'node_modules'/package
        assert json.loads((folder/'package.json').read_text())['version'] == version
        for path in folder.rglob('*'):
            assert not path.is_symlink(), 'Dependency symlink'
            if path.is_file():
                expected['node_modules/'+path.relative_to(stage/'node_modules').as_posix()] = sha(path)
    actual = {name: digest for name, digest in before['program'].items()
              if name.startswith(('node_modules/body-parser/', 'node_modules/qs/'))}
    assert actual == expected, 'Unchanged dependencies differ from the running files'


def source_paths(stage, revision):
    names = subprocess.check_output(['git','ls-tree','-r','-z','--name-only',revision,'--',
        'src','server','public','scripts','docs','games'],cwd=stage).decode().split('\0')
    selected = []
    for name in names:
        if not name: continue
        path = Path(name)
        assert not path.is_absolute() and '..' not in path.parts
        assert not any(part.startswith(('._','.env')) or part in
            {'node_modules','__pycache__','data','secrets','.git','.DS_Store'} for part in path.parts), 'Excluded tracked source: '+name
        assert not name.endswith(('.orig','.bak','.pyc','.pyo')), 'Generated tracked source: '+name
        assert not any((stage/parent).is_symlink() for parent in path.parents), 'Source directory symlink: '+name
        assert (stage/path).is_file() and not (stage/path).is_symlink(), 'Invalid tracked source: '+name
        selected.append(name)
    return selected


def helper_revision(stage, application, requested):
    assert re.fullmatch(r'[0-9a-f]{40}',requested), 'Full helper commit required'
    subprocess.run(['git','fetch','origin'],cwd=stage,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    for revision in [application,requested]:
        subprocess.run(['git','merge-base','--is-ancestor',revision,'origin/main'],cwd=stage,check=True,
                       stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    return subprocess.check_output(['git','rev-parse','origin/main'],cwd=stage,text=True).strip()


parser = argparse.ArgumentParser()
parser.add_argument('stage', type=Path)
parser.add_argument('before', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--helpers-commit')
args = parser.parse_args()
stage, before_path, out = args.stage, args.before, args.output
release = json.loads((stage/'module-build/release-manifest.json').read_text())
before = json.loads(before_path.read_text())
assert before['program'] == before['preparedProgram'] and before['container']['health'] == 'healthy'
assert release['githubVerified'] and release['build']['passed'] and release['scope'] == 'application'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=stage,text=True).strip() == release['sourceCommit']
assert not subprocess.check_output(['git','status','--porcelain'],cwd=stage,text=True).strip()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
lf = lambda p: hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
for name, digest in release['files'].items(): assert sha(stage/name) == digest, name
helper_commit = args.helpers_commit or release['sourceCommit']
helper_main = helper_revision(stage,release['sourceCommit'],helper_commit)
out.mkdir(exist_ok=False, parents=True)


def copy(source, name):
    target = out/name; target.parent.mkdir(parents=True, exist_ok=True)
    assert source.is_file() and not source.is_symlink()
    shutil.copyfile(source, target)
    return sha(target)


changed = {}
for name in source_paths(stage, release['sourceCommit']):
    path = stage/name
    if lf(path) != before['sourceLF'].get(name):
        if payment_source(name):
            changed[name] = copy(path,'source/'+name)
        else:
            assert not name.startswith(('src/', 'server/', 'games/', 'public/')), 'Unrelated runtime source changed: '+name
for name in ['package-lock.json','package.json']:
    if lf(stage/name) != before['sourceLF'][name]: changed[name] = copy(stage/name,'source/'+name)
for name in ['Dockerfile','.dockerignore','index.html','tsconfig.json','tsconfig.finance.json','vite.config.ts']:
    assert lf(stage/name) == before['sourceLF'][name], 'Unreviewed root input: '+name
metadata = {name:copy(stage/name,'metadata/'+name) for name in ['package-lock.json','package.json']}
assert changed.get('package-lock.json', before['sourceLF']['package-lock.json']) == metadata['package-lock.json']
old_lock_bytes = subprocess.check_output(['git','show',release['baseCommit']+':package-lock.json'],cwd=stage).replace(b'\r\n',b'\n')
assert hashlib.sha256(old_lock_bytes).hexdigest() == before['sourceLF']['package-lock.json']
(out/'old-lock.json').write_bytes(old_lock_bytes)
old_lock = json.loads(old_lock_bytes); new_lock = json.loads((stage/'package-lock.json').read_text())
dependency_changes = dependency_transition(old_lock, new_lock)

old_package_bytes = subprocess.check_output(['git','show',release['baseCommit']+':package.json'],cwd=stage).replace(b'\r\n',b'\n')
assert hashlib.sha256(old_package_bytes).hexdigest() == before['sourceLF']['package.json']
(out/'old-package.json').write_bytes(old_package_bytes)
old_package = json.loads(old_package_bytes); new_package = json.loads((stage/'package.json').read_text())
assert {k:v for k,v in old_package.items() if k != 'scripts'} == {k:v for k,v in new_package.items() if k != 'scripts'}
assert old_package == new_package, 'Sandbox release preserves all package metadata'

dependencies = {}
(out/'dependency-delta').mkdir(exist_ok=True)
unchanged_dependencies(stage, before, sha,
                       [(name, new_lock['packages']['node_modules/'+name]['version'])
                        for name in ['body-parser', 'qs']])

delta, retained = {}, {}
for name, digest in release['files'].items():
    if not name.startswith('dist/') or digest == before['program'].get(name): continue
    relative = name.removeprefix('dist/')
    if digest == before['programLF'].get(name):
        retained[name] = before['program'][name]; continue
    if relative in ['index.html','admin.html'] or relative.startswith('assets/') and Path(relative).suffix in ['.js','.css']:
        assert relative in ['index.html','admin.html'] or name not in before['program'], 'Immutable asset collision: '+name
        delta[relative] = copy(stage/name,'dist-delta/'+relative)
    else:
        source = stage/'public'/relative
        assert source.is_file() and lf(source) == before['sourceLF'].get('public/'+relative), 'Unexpected public byte change: '+name
(out/'dist-delta').mkdir(exist_ok=True)
backend = {'index.js':copy(stage/'dist-server/index.js','server-delta/index.js')}
def preserved_inputs(stage, baseline, inputs):
    assert inputs, 'An unchanged backend requires its complete source graph'
    result = {}
    for name in inputs:
        path = Path(name)
        assert not path.is_absolute() and '..' not in path.parts and name.startswith(('server/','src/','scripts/'))
        source = stage/path
        assert source.is_file() and not source.is_symlink()
        digest = lf(source)
        assert digest == baseline['sourceLF'].get(name), 'Retained backend input changed: '+name
        result[name] = digest
    return result


preserved = {}
for entry, name in [('server/payments/index.ts','payments.js'),('scripts/crypto-reconcile.ts','crypto-reconcile.js')]:
    # Existing independent programs keep their verified production bytes. Require an unchanged transitive source graph.
    code = "import{build}from'esbuild';const r=await build({entryPoints:[process.argv[1]],bundle:true,platform:'node',packages:'external',format:'esm',write:false,metafile:true});console.log(JSON.stringify(Object.keys(r.metafile.inputs)))"
    inputs = json.loads(subprocess.check_output(['node','--input-type=module','-e',code,entry],cwd=stage,text=True))
    preserved[name] = {'runtimeSha256':before['program']['dist-server/'+name], 'localSha256':sha(stage/'dist-server'/name),
        'sourceInputs':preserved_inputs(stage,before,inputs)}
host = json.loads((stage/'module-dist/host-contracts.json').read_text())
assert host == before['moduleHost'], 'Host contracts must remain compatible'
module_delta, module_packages = {}, []
for game_id in []:
    package = next(row for row in release['packages'] if row['gameId'] == game_id)
    folder = stage/'module-dist'/game_id/'versions'/package['version']
    game_manifest = json.loads((folder/'manifest.json').read_text())
    assert all(game_manifest[key] == host['games'][game_id][key] for key in ['apiVersion','rulesVersion','progressVersion'])
    for path in folder.rglob('*'):
        if path.is_file():
            name = path.relative_to(stage/'module-dist').as_posix()
            module_delta[name] = copy(path,'modules/'+name)
    module_packages.append({'gameId':game_id,'version':package['version'],
        'beforeSha256':before['moduleFiles'].get('/opt/royal-game-modules/'+game_id+'/active.json','none')})
helpers = {}
assert lf(stage/'scripts/game-module-release.py') == before['sourceLF']['scripts/game-module-release.py']
for name in ['deploy.py','snapshot.py','runtime-inventory.cjs','quiesce.cjs','verify-runtime.cjs','financial_gate.py','sandbox_config.py','scope.json','compose.nowpayments-sandbox.yaml']:
    data = subprocess.check_output(['git','show',helper_commit+':deployment/releases/nowpayments-sandbox-20261027-v1/'+name],cwd=stage)
    (out/name).write_bytes(data)
    helpers[name] = sha(out/name)
operational = {}
for name in ['cpu-priority-release-v3.py', 'publication-priority.py', 'run-publication.py']:
    data = subprocess.check_output(['git','show',helper_commit+':deployment/releases/nowpayments-sandbox-20261027-v1/'+name],cwd=stage)
    (out/name).write_bytes(data)
    operational[name] = sha(out/name)
helper_proof = {'sourceCommit':helper_commit,'applicationSourceCommit':release['sourceCommit'],
                'originMain':helper_main,'files':{**helpers, **operational}}
helper_proof['commit'] = base64.b64encode(subprocess.check_output(['git','cat-file','commit',helper_commit],cwd=stage)).decode()
helper_proof['trees'] = {}
for suffix in ['',':deployment',':deployment/releases',':deployment/releases/nowpayments-sandbox-20261027-v1']:
    revision = helper_commit+suffix if suffix else helper_commit+'^{tree}'
    identity = subprocess.check_output(['git','rev-parse',revision],cwd=stage,text=True).strip()
    raw = subprocess.check_output(['git','cat-file','tree',identity],cwd=stage)
    helper_proof['trees'][identity] = base64.b64encode(raw).decode()
(out/'helpers-source.json').write_text(json.dumps(helper_proof,indent=2)+'\n')
copy(stage/'module-build/release-manifest.json','release-manifest.json')
copy(stage/'module-build/release-github.json','release-github.json')
deleted = [name for name in json.loads((Path(__file__).parent/'scope.json').read_text()) if name in before['source'] and not (stage/name).exists()]
assert set(deleted) == {'src/nile-wallet.css','src/usdt-wallet.css','src/ui/NileWalletUI.ts','src/ui/UsdtWalletUI.ts'}
(out/'modules').mkdir(exist_ok=True)
private_hash = json.loads((stage/'../sandbox-staging.json').read_text())['sha256']
manifest = {'release':'nowpayments-sandbox-20261027-v1','sourceCommit':release['sourceCommit'],'baseCommit':release['baseCommit'],
    'before':before,'changed':changed,'deleted':deleted,'sandboxConfigHash':private_hash,'sandboxComposeHash':helpers['compose.nowpayments-sandbox.yaml'],'delta':delta,'serverDelta':backend,'runtimePackages':metadata,'dependencyFiles':dependencies,
    'helpers':helpers,'helperSha256':helpers['deploy.py'],'snapshotSha256':helpers['snapshot.py'],
    'operationalHelpers':operational,
    'helperSourceCommit':helper_commit,'helperProofSha256':sha(out/'helpers-source.json'),
    'retainedCanonicalRuntime':retained,'preservedBackend':preserved,'moduleDelta':module_delta,'modulePackages':module_packages,
    'moduleInstallerSha256':before['source']['scripts/game-module-release.py']}
(out/'install-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'sourceFiles':len(changed),'clientFiles':len(delta),'dependencyFiles':len(dependencies),
    'payloadBytes':sum(path.stat().st_size for path in out.rglob('*') if path.is_file())}))
