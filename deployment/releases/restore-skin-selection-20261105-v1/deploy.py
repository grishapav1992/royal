"""Restore the character picker with the existing guarded client installer."""
import sys
sys.dont_write_bytecode = True
import hashlib
import importlib.util
import json
from pathlib import Path

NAME = 'restore-skin-selection-20261105-v1'
ROOT = Path(__file__).resolve().parent
SOURCES = {'src/ui/AuthUI.ts', 'src/ui/CharacterSelector.ts', 'src/ui/character-selector.css'}


def main():
    if ROOT != Path('/opt/royal-releases') / NAME or sys.argv[1:] not in [['release'], ['publish'], ['rollback']]:
        raise RuntimeError('Unexpected character selection release path or operation')
    manifest = json.loads((ROOT / 'install-manifest.json').read_text())
    helper = ROOT / 'client-release.py'
    if helper.is_symlink() or hashlib.sha256(helper.read_bytes()).hexdigest() != manifest['support'][helper.name]:
        raise RuntimeError('Guarded client installer changed')
    spec = importlib.util.spec_from_file_location('guarded_client_release', helper)
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    guard.NAME, guard.ROOT, guard.SOURCES = NAME, ROOT, SOURCES
    guard.SUPPORT = guard.SUPPORT | {helper.name}
    try:
        guard.main()
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'publicationLocksHeld': False, 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
