"""Bind the retained Native alias and remove two verified transport archives."""
from pathlib import Path
import fcntl, importlib.util, json, shutil, sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('stake_finalize_installer', ROOT / 'deploy.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


def main():
    locks = []
    for path in [Path('/opt/royal-releases/themed-publish.lock'), d.LIVE / '.client-presentation-deploy.lock', d.STATE / 'module.lock']:
        d.require(not path.is_symlink(), 'Unsafe publication lock')
        handle = path.open('a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    m = d.manifest()
    built = d.read(ROOT / 'build-result.json')
    published = d.read(ROOT / 'published.json')
    unused = d.read(ROOT / 'unused-native-candidate.json')
    original = m['before']['services']['/royal-nile-play']['image']
    d.require(published['published'] and published['sourceCommit'] == m['sourceCommit'], 'Unpublished release')
    d.require(built.get('nativeRestoredToOriginal') and built['nativeImage'] == original, 'Native restoration is not verified')
    d.require(d.inspect('royal-game-1')['Image'] == built['image'] and d.inspect('royal-nile-play')['Image'] == original, 'A later release blocks finalization')
    d.require(d.image('royal-nile-play:before-' + d.NAME) == original, 'Original Native image changed')
    alias = 'royal-nile-play:' + d.BUILD_TAG
    prior = d.image(alias)
    d.require(prior in [unused['image'], original], 'A later Native candidate blocks finalization')
    archives = {'final.tgz': 'f0e4a56bc6eb28f9b87136a1ee9907830cede0a45f4cd454c5b8f0285d157e3b',
                'engine-update.tgz': '47022b6a0fcd948e98f0e6640fd961b28777e31d7a123ad884f99161c3b3d262'}
    for name, digest in archives.items():
        path = ROOT / name
        if path.exists():
            d.require(path.is_file() and not path.is_symlink() and d.sha(path) == digest, 'Transport archive changed')
    d.health()
    # The rollback supervisor requires candidate aliases to match the retained programs.
    d.run(['ctr', '--namespace', 'moby', 'images', 'tag', '--force', 'docker.io/library/royal-nile-play:before-' + d.NAME, 'docker.io/library/' + alias])
    d.require(d.image(alias) == built['nativeImage'] and d.image('royal-game:' + d.BUILD_TAG) == built['image'], 'Rollback candidate alias differs')
    result = {'sourceCommit': m['sourceCommit'], 'nativeAliasBefore': prior, 'nativeAliasAfter': original,
              'runningProgramsUnchanged': True, 'databaseRestored': False,
              'operatorSha256': d.sha(__file__), 'freeBefore': shutil.disk_usage(d.LIVE).free, 'removedArchives': []}
    engine = d.load('stake_finalize_engine', ROOT / 'engine_build.py')
    candidate = unused['image']
    candidate_config = engine.metadata(candidate)['configDigest']
    containers = json.loads(engine.engine('GET', '/containers/json?all=1'))
    d.require(all(row['ImageID'] not in [candidate, candidate_config] for row in containers), 'Unused candidate acquired a container reference')
    image_path = '/images/' + quote(candidate, safe='')
    info = json.loads(engine.engine('GET', image_path + '/json'))
    d.require(not info.get('RepoTags'), 'Unused candidate still has image tags')
    result['removedUnusedNativeImage'] = candidate
    result['unusedNativeImageLogicalBytes'] = info.get('Size')
    result['imageRemoval'] = json.loads(engine.engine('DELETE', image_path + '?noprune=1'))
    for name in archives:
        path = ROOT / name
        if path.exists():
            size = path.stat().st_size
            path.unlink()
            result['removedArchives'].append({'path': str(path), 'bytes': size})
    result['freeAfter'] = shutil.disk_usage(d.LIVE).free
    d.capacity()
    d.save('finalization.json', result)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    d.require(sys.argv[1:] == ['finalize'], 'Explicit finalization operation required')
    main()
