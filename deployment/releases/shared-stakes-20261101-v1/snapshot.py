"""Retain the reviewed full inventory and exact image identities for this release."""
from pathlib import Path
import importlib.util, json, sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('stake_snapshot_base', ROOT / 'snapshot-base.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
from image_metadata import image
base.ROOT = ROOT
original = base.run

def run(args):
    if args == ['docker','image','inspect','royal-game:latest','--format','{{.Id}}']:
        return image('royal-game:latest')
    return original(args)

base.run = run
if __name__ == '__main__':
    assert sys.argv[1:] in [[], ['--recovery']]
    print(json.dumps(base.snapshot(bool(sys.argv[1:]))))
