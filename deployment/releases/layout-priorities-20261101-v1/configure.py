"""Apply only the reviewed layout delta to the exact published source origins."""
import difflib, hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
FEATURE = '831ede0765e7bb0fe323bd52290657497da370a2'
MAIN = 'e43676becdf0b1a8eb51f7169f228835f837cd4f'
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT)
def sha(value): return hashlib.sha256(value).hexdigest()
def blob(commit, name): return git('show', commit + ':' + name).decode().replace('\r\n', '\n')
def projected(row):
    value = blob(row['commit'], row['path'])
    assert sha(value.encode()) == row['baseSha256']
    for patch in row.get('patches', []):
        assert value.count(patch['from']) == 1
        value = value.replace(patch['from'], patch['to'])
    assert sha(value.encode()) == row['sha256']
    return value
def overlay(old, new, live):
    patches = []
    left, right = old.splitlines(keepends=True), new.splitlines(keepends=True)
    offsets = [0]
    for line in left: offsets.append(offsets[-1] + len(line))
    changes = [x for x in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes() if x[0] != 'equal']
    # Apply from the end, preserving every unrelated published byte.
    for _, a, b, c, d in reversed(changes):
        before, after = ''.join(left[a:b]), ''.join(right[c:d])
        prefix = 0
        while prefix < min(len(before), len(after)) and before[prefix] == after[prefix]: prefix += 1
        suffix = 0
        while suffix < min(len(before), len(after)) - prefix and before[-suffix-1] == after[-suffix-1]: suffix += 1
        start, end = offsets[a] + prefix, offsets[b] - suffix
        replacement = after[prefix:len(after)-suffix if suffix else len(after)]
        for context in [0, 1, 8, 24, 48, 96, 160]:
            lo, hi = max(0, start-context), min(len(old), end+context)
            source = old[lo:hi]
            if source and live.count(source) == 1:
                target = old[lo:start] + replacement + old[end:hi]
                live = live.replace(source, target, 1)
                patches.append({'from': source, 'to': target})
                break
        else: raise RuntimeError('Layout patch does not match published source')
    return live, patches

def main():
    before = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    read = lambda name: json.loads((HERE.parent / name).read_text(encoding='utf-8'))
    base = read('shared-stakes-20261101-v1/host-projection.json')
    guard = read('guard-counter-20261101-v1/host-projection.json')
    forest = read('forest-heart-video-20261101-v1/module-projection.json')
    base['files'].update(guard['files'])
    base['files'].update(forest['files'])
    base['moduleAssets'].update(forest['moduleAssets'])
    base['productionCommit'] = before['sourceCommit']
    base['entries'] = guard['entries']
    for name, row in list(base['files'].items()):
        if row['sha256'] in [before['source'].get(name), before['sourceLF'].get(name)]: continue
        try: value = blob(MAIN, name)
        except subprocess.CalledProcessError: continue
        if sha(value.encode()) in [before['source'].get(name), before['sourceLF'].get(name)]:
            base['files'][name] = {'commit': MAIN, 'path': name, 'baseSha256': sha(value.encode()), 'sha256': sha(value.encode())}
    changes = git('diff', '--name-only', MAIN, FEATURE, '--', 'src', 'games').decode().splitlines()
    changes = [n for n in changes if not n.endswith('.md')]
    selected = {}
    for name in changes:
        current = blob(FEATURE, name)
        if name not in base['files'] and name in before['source']:
            value = blob(MAIN, name)
            assert sha(value.encode()) in [before['source'][name], before['sourceLF'].get(name)], name
            base['files'][name] = {'commit': MAIN, 'path': name, 'baseSha256': sha(value.encode()), 'sha256': sha(value.encode())}
        if name in base['files']:
            row = base['files'][name]
            live = projected(row)
            assert row['sha256'] in [before['source'].get(name), before['sourceLF'].get(name)], name
            try: prior = blob(MAIN, name)
            except subprocess.CalledProcessError: raise RuntimeError('Existing source has no integration baseline: '+name)
            if live == prior:
                row = {'commit': FEATURE, 'path': name, 'baseSha256': sha(current.encode()), 'sha256': sha(current.encode())}
            else:
                value, patches = overlay(prior, current, live)
                row = {**row, 'patches': row.get('patches', []) + patches, 'sha256': sha(value.encode())}
        else:
            assert name not in before['source'], 'Missing published origin: '+name
            row = {'commit': FEATURE, 'path': name, 'baseSha256': sha(current.encode()), 'sha256': sha(current.encode())}
        base['files'][name] = row
        selected[name] = row['sha256']
    active = read('shared-stakes-20261101-v1/scope.json')['activeGames']
    base['moduleContracts'] = {game: before['moduleHost']['games'][game] for game in active}
    base['changedSources'] = changes
    scope = {'release': HERE.name, 'productionCommit': before['sourceCommit'], 'featureCommit': FEATURE,
             'changedSources': changes, 'expectedSources': selected, 'moduleGames': base['moduleGames'],
             'activeGames': sorted(base['moduleContracts']), 'addedGames': [], 'restoredGames': [], 'backendChanges': []}
    assert len(scope['activeGames']) == 18
    backend = read('guard-counter-20261101-v1/backend-projection.json')
    backend['productionCommit'] = before['sourceCommit']
    for name, value in [('host-projection.json', base), ('backend-projection.json', backend), ('scope.json', scope)]:
        (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'productionCommit': before['sourceCommit'], 'layoutSources': len(changes), 'games': len(scope['activeGames'])}))

if __name__ == '__main__': main()
