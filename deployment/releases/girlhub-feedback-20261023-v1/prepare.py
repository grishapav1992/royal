"""Reproduce this package from tracked sources with current RTP enforcement."""
from pathlib import Path
import json
import subprocess
import sys
import tarfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
LOCK = json.loads((HERE / 'source-lock.json').read_text())
TARGET = Path(sys.argv[1]).resolve()
if TARGET.exists():
    raise RuntimeError('The build destination must not exist')
TARGET.mkdir(parents=True)
process = subprocess.Popen(['git', '-c', 'core.autocrlf=false', 'archive', LOCK['buildBaseCommit']], cwd=REPO, stdout=subprocess.PIPE)
with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
    archive.extractall(TARGET, filter='data')
if process.wait():
    raise RuntimeError('Git archive failed')
for name in LOCK['productionDependencies']:
    (TARGET / name).write_bytes(subprocess.check_output(['git', 'show', LOCK['productionDependencyCommit'] + ':' + name], cwd=REPO))
for name in LOCK['sourcePaths']:
    source = REPO / (LOCK['productionUiPath'] if name == 'src/ui/AfterglowUI.ts' else name)
    target = TARGET / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes().replace(b'\r\n', b'\n'))
print(TARGET)
