#!/usr/bin/env python3
"""Enable the read-only test reconciliation only after a successful live check."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess

if os.geteuid() != 0:
    raise SystemExit('root is required')
os.umask(0o077)
root = Path('/opt/royal-finance')
spec = importlib.util.spec_from_file_location('finance_operations', root / 'deployment/finance/operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
subprocess.run(['python3', str(root / 'deployment/finance/operations.py'), 'nile-reconcile'], check=True, timeout=110)
for name in ('royal-nile-reconcile.service', 'royal-nile-reconcile.timer'):
    target = Path('/etc/systemd/system') / name
    shutil.copyfile(root / 'deployment/finance/systemd' / name, target)
    target.chmod(0o644)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'royal-nile-reconcile.timer'], check=True)
ops.atomic_json(ops.STATE / 'nile-reconciliation-required.json',
                {'network': 'nile', 'asset': 'USDT_NILE_TEST', 'mode': 'read-only'})
if not ops.monitor()['ok']:
    raise SystemExit('monitor did not confirm the required reconciliation')
