"""Install the unchanged packages over the explicitly reviewed newer lobby."""
from pathlib import Path
import hashlib, importlib.util, json, re, subprocess, sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
CONCURRENT = Path('/opt/royal-releases/player-recovery-20261104-v2')


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def sha(path):
    require(path.is_file() and not path.is_symlink(), 'Unsafe evidence file: ' + str(path))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    sha(path)
    return json.loads(path.read_text())


def transition(original, changes):
    expected = dict(original)
    for name, row in changes.items():
        require(expected.get(name) == row['before'], 'Unreviewed transition origin: ' + name)
        if row['after'] is None:
            expected.pop(name, None)
        else:
            expected[name] = row['after']
    return expected


def validate_transition(plan, prepared, current, release, operator):
    require(release['sourceCommit'] == plan['applicationSourceCommit'], 'Application artifact changed')
    require(prepared['sourceCommit'] == release['baseCommit'] == plan['preparedBaseCommit'], 'Prepared baseline changed')
    require(current['sourceCommit'] == current['sourceRevision'] == plan['actualBaseCommit'], 'Actual baseline changed')
    require(current['container']['image'] == current['preparedImage'] == plan['actualBaseImage'], 'Actual image changed')
    require(current['program'] == current['preparedProgram'], 'Running program differs from its image')
    for key, changes in [('source', 'sourceRawChanges'), ('sourceLF', 'sourceChanges'), ('program', 'programChanges')]:
        require(current[key] == transition(prepared[key], plan[changes]), 'Unreviewed production transition: ' + key)
    ignored = {'at', 'availableBytes', 'sourceCommit', 'sourceRevision', 'source', 'sourceLF', 'program',
               'preparedProgram', 'preparedImage', 'container', 'services', 'serviceProfiles'}
    require({k:v for k,v in prepared.items() if k not in ignored} ==
            {k:v for k,v in current.items() if k not in ignored}, 'Modules, settings or protected programs changed')
    for key, game in [('services', '/royal-game-1'), ('serviceProfiles', 'royal-game-1')]:
        require(set(prepared[key]) == set(current[key]), 'Service scope changed')
        require({k:v for k,v in prepared[key].items() if k != game} ==
                {k:v for k,v in current[key].items() if k != game}, 'Other service changed')
    require({k:v for k,v in prepared['container'].items() if k not in {'id', 'image', 'startedAt'}} ==
            {k:v for k,v in current['container'].items() if k not in {'id', 'image', 'startedAt'}}, 'Host configuration changed')
    for name, digest in release['moduleProjection']['inputs'].items():
        if name not in operator['source']:
            require(current['sourceLF'].get(name) == digest, 'Game build input changed: ' + name)
    for name in operator['source']:
        require(current['source'].get(name) == prepared['source'].get(name) and
                current['sourceLF'].get(name) == prepared['sourceLF'].get(name), 'Presentation source changed: ' + name)


def validate_receipt(receipt, operator, plan):
    require(re.fullmatch('[a-f0-9]{40}', receipt.get('sourceCommit', '')) and
            re.fullmatch('[a-f0-9]{40}', receipt.get('remoteMain', '')), 'Missing tooling GitHub evidence')
    require(receipt['sourceCommit'] == operator['continuationSourceCommit'] and
            receipt['applicationSourceCommit'] == plan['applicationSourceCommit'], 'Tooling revision changed')
    require(set(receipt['files']) == {'continuation.py', 'continuation.json'}, 'Unexpected continuation tooling')
    for name, digest in receipt['files'].items():
        require(sha(ROOT / name) == digest, 'Continuation tooling changed: ' + name)


def main():
    require(ROOT == Path('/opt/royal-releases/uniform-spin-response-20261104-v1') and not sys.argv[1:], 'Wrong continuation invocation')
    plan, operator = read(ROOT / 'continuation.json'), read(ROOT / 'operator.json')
    require(sha(ROOT / 'continuation-github.json') == operator['continuationReceiptSha256'], 'Tooling receipt changed')
    validate_receipt(read(ROOT / 'continuation-github.json'), operator, plan)
    require(sha(ROOT / 'prepared-before.json') == plan['preparedBeforeSha256'], 'Prepared baseline bytes changed')
    require(sha(ROOT / 'before.json') == plan['currentBeforeSha256'], 'Reviewed current baseline bytes changed')
    for name, digest in plan['readerSupport'].items():
        require(sha(CONCURRENT / name) == digest, 'Reviewed snapshot reader changed: ' + name)
    prepared = read(ROOT / 'prepared-before.json')
    spec = importlib.util.spec_from_file_location('fixed_uniform_publisher', ROOT / 'publish.py')
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    original_scope = publisher.validate_scope

    def scope(release, current, op):
        original_scope(release, prepared, op)
        validate_transition(plan, prepared, current, release, op)

    def snapshot():
        for name, digest in plan['readerSupport'].items():
            require(sha(CONCURRENT / name) == digest, 'Snapshot reader changed during publication: ' + name)
        return json.loads(subprocess.check_output(['python3', str(CONCURRENT / 'snapshot.py')], text=True, timeout=600))

    publisher.validate_scope = scope
    publisher.snapshot = snapshot
    publisher.BASE_HELPER = CONCURRENT / 'snapshot.py'
    # The unchanged publisher acquires all three locks nonblockingly immediately
    # before rechecking the live inventory. Preparation and tests run beforehand.
    publisher.main()
    record = read(ROOT / 'published.json')
    record.update(actualBaseCommit=plan['actualBaseCommit'], preservedConcurrentRelease=plan['concurrentRelease'],
                  continuationSourceCommit=operator['continuationSourceCommit'])
    publisher.save('published.json', record)


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError:
        print('Publication locks busy; no automatic restart. Retry the ready package explicitly.', file=sys.stderr)
        sys.exit(75)
