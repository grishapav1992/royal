"""Overlay only the elevator feature onto verified production source origins."""
import difflib, hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
FIX = '047ac2505a3a693d8960d72ba8ed8f96e15f2bd2'
APPROACH_FIX = '00cfc352dfe627cdafd88df07b7752ef0b100412'

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
    for _, a, b, c, d in reversed(changes):
        before, after = ''.join(left[a:b]), ''.join(right[c:d])
        prefix = 0
        while prefix < min(len(before), len(after)) and before[prefix] == after[prefix]: prefix += 1
        suffix = 0
        while suffix < min(len(before), len(after)) - prefix and before[-suffix-1] == after[-suffix-1]: suffix += 1
        start, end = offsets[a] + prefix, offsets[b] - suffix
        replacement = after[prefix:len(after)-suffix if suffix else len(after)]
        for context in [0, 1, 8, 24, 48, 96, 160]:
            bounds = [(max(0, start-context), min(len(old), end+context)),
                      (max(0, start-context), end), (start, min(len(old), end+context))]
            matched = False
            for lo, hi in bounds:
                source = old[lo:hi]
                if source and live.count(source) == 1:
                    target = old[lo:start] + replacement + old[end:hi]
                    live = live.replace(source, target, 1)
                    patches.append({'from': source, 'to': target})
                    matched = True
                    break
            if matched: break
        else: raise RuntimeError('Elevator patch does not match production: ' + repr(before[:220]) + ' -> ' + repr(after[:220]))
    return live, patches

def main():
    feature = git('rev-parse', '6cfda58').decode().strip()
    base_commit = git('rev-parse', feature + '^').decode().strip()
    before = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    read = lambda name: json.loads((HERE.parent / name).read_text(encoding='utf-8'))
    host = read('guard-counter-20261101-v1/host-projection.json')
    backend = read('guard-counter-20261101-v1/backend-projection.json')
    candidates = {}
    for file in sorted(HERE.parent.glob('*/*projection*.json')):
        try: config = json.loads(file.read_text(encoding='utf-8-sig'))
        except (ValueError, UnicodeError): continue
        for name, row in config.get('files', {}).items():
            if isinstance(row, dict) and row.get('sha256') in [before['source'].get(name), before['sourceLF'].get(name)]:
                candidates[name] = row
    for name in before['source']:
        if name not in candidates:
            value = git('show', 'HEAD:' + name) if name in ['package.json', 'tsconfig.json'] else None
            if value is not None:
                value = value.replace(b'\r\n', b'\n')
                assert sha(value) in [before['source'][name], before['sourceLF'].get(name)], name
                candidates[name] = {'commit': git('rev-parse', 'HEAD').decode().strip(), 'path': name, 'baseSha256': sha(value), 'sha256': sha(value)}
    changes = git('diff', '--name-only', base_commit, feature, '--', 'src', 'server').decode().splitlines()
    assert len(changes) == 13
    selected = {}
    for name in changes:
        origin = FIX if name == 'src/game/ElevatorAudio.ts' else APPROACH_FIX if name == 'src/game/RoomScene.ts' else feature
        current = blob(origin, name)
        if name in before['source']:
            assert name in candidates, 'Missing production source origin: ' + name
            row = candidates[name]
            live = projected(row)
            assert sha(live.encode()) in [before['source'][name], before['sourceLF'].get(name)], name
            try: value, patches = overlay(blob(base_commit, name), current, live)
            except RuntimeError as error: raise RuntimeError('Cannot overlay ' + name) from error
            row = {**row, 'patches': row.get('patches', []) + patches, 'sha256': sha(value.encode())}
        else:
            row = {'commit': origin, 'path': name, 'baseSha256': sha(current.encode()), 'sha256': sha(current.encode())}
        selected[name] = row
    # Preserve the exact existing backend graph, including its inherited dictionary.
    preserved = {'src/i18n/en.ts': backend['files']['src/i18n/en.ts']['sha256']}
    original_backend_dictionary = backend['files']['src/i18n/en.ts']
    for kind, config in [('host', host), ('backend', backend)]:
        config['productionCommit'] = before['sourceCommit']
        config['files'].update(candidates)
        config['files'].update(selected)
        if kind == 'backend': config['files']['src/i18n/en.ts'] = original_backend_dictionary
        for key in ['moduleGames', 'moduleContracts', 'moduleAssets']: config.pop(key, None)
        config['changedSources'] = changes
        (HERE / (kind + '-projection.json')).write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    active = read('shared-stakes-20261101-v1/scope.json')['activeGames']
    scope = {'release': HERE.name, 'productionCommit': before['sourceCommit'], 'featureCommit': feature, 'audioFixCommit': FIX, 'approachFixCommit': APPROACH_FIX,
        'changedSources': changes, 'expectedSources': {name: row['sha256'] for name, row in selected.items()},
        'backendSources': ['server/LobbyRoom.ts', 'src/shared/world.ts', 'src/shared/elevator.ts'],
        'preservedBackendInputs': preserved, 'backendChanges': ['dist-server/index.js'], 'moduleChanges': [],
        'activeGames': sorted(active), 'addedGames': [], 'restoredGames': []}
    (HERE / 'scope.json').write_text(json.dumps(scope, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'base': before['sourceCommit'], 'sources': len(changes), 'games': len(active)}))

if __name__ == '__main__': main()
