"""Install dedicated, checksum-pinned native tools without changing the game image."""
import hashlib
import io
import json
import os
import platform
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path('/opt/royal-project-brain/runtime')
TOOLS = [
    {'name': 'node', 'version': '24.22.2',
     'url': 'https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz',
     'sha256': '48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75',
     'member': 'node-v24.22.2-linux-x64/bin/node'},
    {'name': 'uv', 'version': '0.13.7',
     'url': 'https://github.com/astral-sh/uv/releases/download/0.13.7/uv-x86_64-unknown-linux-gnu.tar.gz',
     'sha256': 'c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83',
     'member': 'uv-x86_64-unknown-linux-gnu/uv'},
]


def main():
    if os.getuid() != 0 or platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise RuntimeError('The shared graph runtime requires a Linux x86_64 administrator.')
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o755)
    for directory in [ROOT.parent, ROOT, ROOT / 'bin']:
        directory.mkdir(exist_ok=True, mode=0o755)
        stat = directory.lstat()
        if directory.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o022:
            raise RuntimeError('Untrusted graph runtime directory.')
    installed = ROOT / 'installed.json'
    if installed.exists():
        receipt = json.loads(installed.read_text())
        if receipt.get('tools') != TOOLS:
            raise RuntimeError('Existing graph runtime has a different installation receipt.')
        for tool in TOOLS:
            binary = ROOT / 'bin' / tool['name']
            if binary.is_symlink() or hashlib.sha256(binary.read_bytes()).hexdigest() != receipt['binaries'][tool['name']]:
                raise RuntimeError('Installed graph runtime differs from its receipt.')
        print(json.dumps({'status': 'unchanged'}))
        return
    binaries = {}
    with tempfile.TemporaryDirectory(prefix='prepare-', dir=ROOT) as scratch:
        scratch = Path(scratch)
        for tool in TOOLS:
            request = urllib.request.Request(tool['url'], headers={'User-Agent': 'royal-project-brain-runtime/1'})
            with urllib.request.urlopen(request, timeout=120) as response:
                archive = response.read(96 * 1024 * 1024 + 1)
            if len(archive) > 96 * 1024 * 1024 or hashlib.sha256(archive).hexdigest() != tool['sha256']:
                raise RuntimeError('Graph runtime download checksum differs.')
            # Extract only the named regular executable, never arbitrary archive paths or links.
            with tarfile.open(fileobj=io.BytesIO(archive)) as package:
                member = package.getmember(tool['member'])
                if not member.isfile() or member.size > 160 * 1024 * 1024:
                    raise RuntimeError('Invalid graph runtime binary.')
                with package.extractfile(member) as source, (scratch / tool['name']).open('xb') as target:
                    shutil.copyfileobj(source, target)
            binary = scratch / tool['name']
            binary.chmod(0o755)
            binaries[tool['name']] = hashlib.sha256(binary.read_bytes()).hexdigest()
        for tool in TOOLS:
            os.replace(scratch / tool['name'], ROOT / 'bin' / tool['name'])
        receipt = scratch / 'installed.json'
        receipt.write_text(json.dumps({'schemaVersion': 1, 'tools': TOOLS, 'binaries': binaries}, sort_keys=True) + '\n')
        os.replace(receipt, installed)
    print(json.dumps({'status': 'installed', 'versions': {tool['name']: tool['version'] for tool in TOOLS}}))


if __name__ == '__main__':
    main()
