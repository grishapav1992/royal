"""Bind the requested header patch to exact preserved production Git sources."""
import difflib, hashlib, json, os, subprocess, sys
from pathlib import Path
ROOT = Path.cwd()
FEATURE = 'a8ef70c308b68daa75e516caf6ef52049073d832'
GIT = os.environ.get('ROYAL_GIT_BINARY', 'git')
def git(*args): return subprocess.check_output([GIT, *args], cwd=ROOT)
def read(commit, name): return git('show', commit + ':' + name).replace(b'\r\n', b'\n')
def digest(data): return hashlib.sha256(data).hexdigest()
before = json.loads(Path(sys.argv[1]).read_text())
prior = json.loads(Path('deployment/releases/shared-stakes-20261101-v1/host-projection.json').read_text())
files = json.loads(Path(sys.argv[2]).read_text())['origins']
for name, row in list(files.items()):
    expected = before['sourceLF'].get(name)
    if expected and row['sha256'] != expected:
        found = None
        for commit in git('log', '--all', '--format=%H', '--', name).decode().splitlines():
            try: data = read(commit, name)
            except subprocess.CalledProcessError: continue
            if digest(data) == expected:
                found = dict(commit=commit, path=name, baseSha256=expected, sha256=expected)
                break
        if found is not None: files[name] = found
changes = ['src/main.ts', 'src/ui/SocialUI.ts', 'src/i18n/en.ts', 'src/ui/compact-header.css']
parent = git('rev-parse', FEATURE + '^').decode().strip()
for name in changes:
    desired = read(sys.argv[3], name) if name == 'src/ui/compact-header.css' else read(FEATURE, name)
    if name not in before['source']:
        h = digest(desired)
        files[name] = dict(commit=sys.argv[3], path=name, baseSha256=h, sha256=h)
        continue
    row = files[name]
    original = read(row['commit'], row['path'])
    assert not row.get('patches') and digest(original) == before['sourceLF'][name]
    old, new = read(parent, name).decode().splitlines(True), desired.decode().splitlines(True)
    patches, value = [], original.decode()
    for group in difflib.SequenceMatcher(a=old, b=new, autojunk=False).get_grouped_opcodes(2):
        first, last = group[0], group[-1]
        old_text, new_text = ''.join(old[first[1]:last[2]]), ''.join(new[first[3]:last[4]])
        assert old_text and value.count(old_text) == 1, 'Header patch must match production once: ' + name
        patches.append(dict(**{'from':old_text}, to=new_text))
        value = value.replace(old_text, new_text, 1)
    if name == 'src/main.ts':
        assert value.count('max-width:1200px') == 1
        patches.append({'from':'max-width:1200px', 'to':'max-width:1400px'})
        value = value.replace('max-width:1200px', 'max-width:1400px', 1)
    assert patches and value.encode() != original
    files[name] = {**row, 'patches':patches, 'sha256':digest(value.encode())}
for field in ['moduleGames', 'moduleContracts', 'moduleAssets']: prior.pop(field, None)
projection = {**prior, 'productionCommit':before['sourceCommit'], 'files':files, 'changedSources':changes}
folder = ROOT / 'deployment/releases/compact-header-20261101-v1'
(folder / 'host-projection.json').write_text(json.dumps(projection, ensure_ascii=False, indent=2) + '\n')
(folder / 'scope.json').write_text(json.dumps(dict(release='compact-header-20261101-v3', productionCommit=before['sourceCommit'], featureCommit=FEATURE, changedSources=changes, addedGames=[], restoredGames=[], backendChanges=[], moduleChanges=[]), indent=2)+'\n')
print(json.dumps(dict(sourceCommit=before['sourceCommit'], sourceCount=len(before['source']), runtimeCount=len(before['program']), changedSources=changes)))
