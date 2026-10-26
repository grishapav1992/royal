"""Local PostgreSQL integration bridge; no Docker or production access."""
import importlib.util
import json
from pathlib import Path
import signal
import sys

helpers = Path(__file__).resolve().parent
root = helpers.parents[2]
spec = importlib.util.spec_from_file_location('financial_gate', helpers / 'financial_gate.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
gate = module.FinancialGate([sys.argv[1], '-e', (helpers / 'quiesce.cjs').read_text()], str(root),
    sys.argv[2], min_free_bytes=5 * 1024**3, disk_paths=(str(root),))
signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
try:
    gate.acquire()
    gate.confirm()
    print(json.dumps({'phase': 'acquired'}), flush=True)
    gate.run([sys.executable, '-c', 'import time; time.sleep(36)'], timeout=45)
    gate.confirm()
    print(json.dumps({'phase': 'held-past-35-seconds'}), flush=True)
    if sys.stdin.readline().strip() != 'release':
        raise RuntimeError('Local test did not authorize release')
    gate.release()
    print(json.dumps({'phase': 'released'}), flush=True)
finally:
    gate.close()
