#!/usr/bin/env python3
"""Compare full and reused immutable image checks without running the application."""
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import time

ROOT=Path('/opt/royal-maintenance')

def require(value,message):
    if not value:raise RuntimeError(message)

def read(path):return json.loads(path.read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    installed=read(ROOT/'installed.json');helper=ROOT/'bin/retention-runtime.py'
    require(sha(helper)==installed['files']['retention-runtime.py'],'Installed helper differs from its GitHub receipt')
    spec=importlib.util.spec_from_file_location('proof_benchmark_runtime',helper);runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
    cleanup_path=ROOT/'bin/cleanup-release-history.py'
    require(sha(cleanup_path)==installed['files']['cleanup-release-history.py'],'Installed cleanup differs')
    spec=importlib.util.spec_from_file_location('proof_benchmark_cleanup',cleanup_path);cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)
    locks=[]
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        path=Path(name);require(not path.is_symlink(),'Unsafe deployment lock');handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
    before=cleanup.healthy();source=before['Config']['Labels']['org.opencontainers.image.revision'];release=cleanup.select_current_release(before['Image'],source);folder=cleanup.RELEASES/release
    manifest,built,published,receipt=[read(folder/name) for name in ['install-manifest.json','build-result.json','published.json','release-github.json']]
    require(manifest['sourceCommit']==built['sourceCommit']==published['sourceCommit']==receipt['sourceCommit']==source,'Release source evidence differs')
    require(built['image']==published['runningImage']==before['Image'] and published['published'],'Running image differs')
    if manifest.get('receiptSha256'):require(sha(folder/'release-github.json')==manifest['receiptSha256'],'GitHub receipt differs')
    support={**manifest.get('helpers',{}),**manifest.get('support',{})};reader=folder/'runtime-inventory.cjs';require(sha(reader)==support['runtime-inventory.cjs'],'Program reader changed')
    program=reader.read_text();rows=[]
    rollback=manifest['before'];require(rollback['program']==rollback['preparedProgram'],'Rollback inventory is ambiguous')
    for role,image,expected in [('current',built['image'],built['program']),('rollback',rollback['preparedImage'],rollback['preparedProgram'])]:
        checks=[]
        for n in range(2):
            started=time.monotonic();result=runtime.verify_image_program(image,program,expected);checks.append({'durationMs':round((time.monotonic()-started)*1000),'reused':result['reused']})
        rows.append({'role':role,'image':image,'files':len(expected),'checks':checks})
    after=cleanup.healthy();require(all(before[k]==after[k] for k in ['Id','Image']) and before['State']['StartedAt']==after['State']['StartedAt'],'Running application changed')
    print(json.dumps({'sourceCommit':installed['sourceCommit'],'applicationSource':source,'release':release,'checks':rows,'runningContainerUnchanged':True,'walletOperations':0}))

if __name__=='__main__':main()
