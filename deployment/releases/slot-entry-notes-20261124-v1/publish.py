"""Publish seven reviewed slot intro copy updates with the existing module guard."""
from contextlib import ExitStack
import fcntl
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
NAME = 'slot-entry-notes-20261124-v1'
ROOT = Path('/opt/royal-releases') / NAME
SLUGS = ('caramel-carnival', 'cosmic-escape', 'girlhub', 'last-convoy', 'meme-overload', 'nitro-run', 'velvet-reign')
GAME_IDS = {slug: 'studio-' + ('afterglow' if slug == 'girlhub' else slug) for slug in SLUGS}
INTRO_FILES = {
    'games/caramel-carnival/CaramelCarnivalUI.ts', 'games/cosmic-escape/CosmicEscapeUI.ts',
    'games/girlhub/AfterglowUI.ts', 'games/last-convoy/LastConvoyUI.ts',
    'games/meme-overload/MemeOverloadUI.ts', 'games/nitro-run/NitroRunUI.ts',
    'games/velvet-reign/VelvetReignUI.ts', 'games/velvet-reign/velvetReignText.ts',
}


def main():
    if Path(__file__).resolve() != ROOT / 'publish.py' or sys.argv[1:]:
        raise RuntimeError('Unexpected installer invocation')
    from hashlib import sha256
    import importlib.util

    def load(name, digest):
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or sha256(path.read_bytes()).hexdigest() != digest:
            raise RuntimeError('Invalid reviewed helper: ' + name)
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    operator = json.loads((ROOT / 'operator.json').read_bytes())
    guard = load('scope_guard.py', operator['guardSha256'])
    helpers = load('scope_packages.py', operator['packagesHelperSha256'])
    guard.NAME, guard.ROOT, guard.BACKUP = NAME, ROOT, Path('/opt/royal-backups') / NAME
    guard.HELPERS = ROOT.with_name('cosmic-crew-20261124-v1')
    guard.SLUGS, guard.GAMES = SLUGS, tuple(GAME_IDS.values())
    guard.SOURCES = set(operator['source'])
    guard.require(INTRO_FILES <= guard.SOURCES and len(guard.SOURCES) <= 64
                  and all(len(Path(name).parts) == 3 and Path(name).parts[0] == 'games'
                          and Path(name).parts[1] in SLUGS and Path(name).suffix in ('.css', '.ts', '.json')
                          for name in guard.SOURCES), 'Unexpected source scope')
    helpers.ROOT = ROOT
    helpers.CONTRACTS = {game: {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 3 if slug == 'girlhub' else 1}
                         for slug, game in GAME_IDS.items()}
    helpers.GAMES = guard.GAMES
    guard.prepare_packages = lambda *args: helpers.prepare_packages(guard, *args)
    guard.backup = lambda *args: helpers.backup(guard, *args)
    arguments = guard.inputs()
    with ExitStack() as stack:
        for path in guard.LOCKS:
            stream = stack.enter_context(guard.safe(path).open('a'))
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print('A production publication lock is busy.', file=sys.stderr)
                return 75
        print(json.dumps(guard.publish(*arguments)), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
