"""Publish the player progression signal in the independent Roulette package."""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
NAME = 'player-level-feedback-roulette-20261107-v1'

if __name__ == '__main__':
    spec = importlib.util.spec_from_file_location('roulette_guard', ROOT / 'publish-base.py')
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    operator = guard.read(ROOT / 'operator.json')
    guard.require(guard.sha(ROOT / 'publish-base.py') == operator['guardSha256'], 'Module guard changed')
    guard.NAME, guard.ROOT = NAME, ROOT
    guard.BACKUP = Path('/opt/royal-backups') / NAME
    guard.SOURCES = {'games/royal-roulette/RoyalRoulette.ts'}
    # The shared guard verifies its own entrypoint path as well as the release path.
    guard.__file__ = __file__
    sys.exit(guard.main())
