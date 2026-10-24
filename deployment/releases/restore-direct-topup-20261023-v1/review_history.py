"""Conservatively keep any deletion candidate with source or archive contents not saved elsewhere."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import tarfile

ROOT = Path('/opt/royal-releases/restore-direct-topup-20261023-v1')
STATE = Path('/opt/royal-maintenance/restore-direct-topup-20261023-v1')
plan_path = STATE / 'plan.json'
plan = json.loads(plan_path.read_text())
manifest = json.loads((ROOT / 'install-manifest.json').read_text())
built = json.loads((ROOT / 'build-result.json').read_text())
saved = set(manifest['before']['source'].values()) | set(manifest['changed'].values()) | set(built['program'].values()) | set(manifest['before']['moduleFiles'].values()) | set(manifest['moduleDelta'].values())
history = Path('/opt/royal-backups') / ROOT.name / 'historical-sources.json'
if history.exists():
    saved.update(json.loads(history.read_text())['checksums'])
objects = set((ROOT / 'github-reachable-objects.txt').read_text().split())
generated = {'node_modules', 'dist', 'dist-server', 'module-dist', 'module-build', '__pycache__', 'runtime-context', 'game-context', 'financial-context', 'dist-delta', 'server-delta'}
metadata = {'install-manifest.json', 'source-lock.json', 'before.json', 'after.json', 'build-result.json', 'published.json', 'verification.json', 'owner.json', 'active.json', 'manifest.json', 'recovered.json', 'build.log'}
code_assets = {'.ts','.tsx','.js','.mjs','.cjs','.py','.go','.css','.scss','.html','.json','.yaml','.yml','.toml','.md','.txt','.png','.jpg','.jpeg','.webp','.svg','.mp3','.mp4','.ogg','.wav','.woff2','.ttf','.avif','.gif'}

def reason(name, read):
    parts = PurePosixPath(name).parts
    if any(part in {'.git','data','secrets'} or part.startswith('.env') for part in parts):
        return 'Contains a checkout, configuration or data requiring its owner review'
    if any(part in generated for part in parts):
        return None
    path = PurePosixPath(name)
    if path.name in metadata or path.suffix in {'.log','.pyc'}:
        return None
    if path.suffix not in code_assets and path.name not in {'Dockerfile','.dockerignore','Makefile','go.mod','go.sum'}:
        return 'Unclassified file requires verification before retirement'
    raw = read()
    if hashlib.sha256(raw).hexdigest() in saved:
        return None
    try:
        raw.decode('utf8'); normalized = raw.replace(b'\r\n',b'\n')
    except UnicodeDecodeError:
        normalized = raw
    if hashlib.sha1(b'blob '+str(len(normalized)).encode()+b'\0'+normalized).hexdigest() in objects:
        return None
    return 'Source or required asset has no verified saved copy'

kept = set(plan['keep']); exceptions = plan.get('activeWorkExceptions', {})
reviewed = []
for entry in plan['entries']:
    top = Path(entry['path']); problem = None
    paths = sorted(top.rglob('*')) if top.is_dir() else [top]
    for path in paths:
        if path.is_symlink():
            problem = 'A symlink requires owner review'; break
        if not path.is_file():
            continue
        name = path.relative_to(top).as_posix() if top.is_dir() else path.name
        if path.name.endswith(('.tgz','.tar.gz')):
            if top.parent == Path('/opt/royal-backups') and path.name.startswith('source'):
                continue
            with tarfile.open(path) as archive:
                for member in archive:
                    if member.isdir():continue
                    if not member.isfile():problem='Archive special member requires owner review';break
                    problem = reason(member.name, lambda member=member:archive.extractfile(member).read())
                    if problem:break
        else:
            problem = reason(name, path.read_bytes)
        if problem:break
    if problem:
        kept.add(str(top));exceptions[str(top)]={'reason':problem,'cleanupCondition':'Its owner verifies or preserves every unique source, asset, configuration and unpublished commit before retirement'}
    else:
        reviewed.append(entry)
plan['entries'] = reviewed
plan['keep'] = sorted(kept)
plan['activeWorkExceptions'] = exceptions
plan['additionalArchiveAndSourceReview'] = True
plan_path.write_text(json.dumps(plan,indent=2)+'\n')
print(json.dumps({'planSha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'entries':[row['path'] for row in reviewed],'keptExceptions':len(exceptions),'imagesRemoved':0}))
