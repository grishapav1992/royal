"""Remove this verified release's redundant transport and image-build context only."""
import fcntl,hashlib,json,re,shutil,subprocess,sys
from pathlib import Path
ROOT=Path('/opt/royal-releases/tsu-e-fa-20261101-v1')
ARCHIVES={
 'transport.tgz':'a21ab2c1b351a8ec0742504141fd0d887fc45468fe73d86eb3e49324f9f096f9',
 'transport-ready.tgz':'ebd5c5fca90f44cddc48e70cd984d52fe6b826b62580d738197d383b125b6d27',
 'transport-current.tgz':'922dac3213bb5baeb6f46e328a4c302f520cab61d9b4a3c77f871f7c4158cffe',
}
def require(value,reason):
    if not value:raise RuntimeError(reason)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text())
def inventory(path):return {p.relative_to(path).as_posix():sha(p) for p in path.rglob('*') if p.is_file()}

def valid_host_rollback(own,backup,current,expected):
    return backup==expected or (not own and current==expected)
def valid_successor(image,label,own_image,own_source,p,m,b,receipt):
    return (p.get('published') is True and p.get('runningImage')==b.get('image')==image
        and p.get('sourceCommit')==m.get('sourceCommit')==receipt.get('sourceCommit')==label
        and bool(re.fullmatch('[a-f0-9]{40}',str(receipt.get('remoteMain',''))))
        and m.get('before',{}).get('preparedImage')==own_image
        and m.get('before',{}).get('sourceCommit')==own_source)
def current_release(game,own):
    image=game['Image'];label=game['Config']['Labels'].get('org.opencontainers.image.revision')
    if image==own['image']:
        require(label==own['sourceCommit'],'Current source label differs');return ROOT.name
    for path in ROOT.parent.glob('*/published.json'):
        if path.parent.resolve()!=path.parent:continue
        try:
            p=read(path)
            if p.get('runningImage')!=image:continue
            m,b,receipt=[read(path.parent/n) for n in ['install-manifest.json','build-result.json','release-github.json']]
            if valid_successor(image,label,own['image'],own['sourceCommit'],p,m,b,receipt):
                require(sha(path.parent/'release-github.json')==m['receiptSha256'],'Successor receipt changed')
                return path.parent.name
        except (OSError,ValueError,KeyError):continue
    raise RuntimeError('Current image is not this release or its verified immediate successor')
def context_expected(m):
    name=m['release']
    text='FROM royal-game:before-'+name+'-prepared\nCOPY --chown=node:node dist-delta/ /app/dist/\nLABEL org.opencontainers.image.revision="'+m['sourceCommit']+'"\n'
    ignore='**\n!Dockerfile\n!.dockerignore\n!dist-delta\n!dist-delta/**\n!server-delta\n!server-delta/index.js\n'
    result={'Dockerfile':hashlib.sha256(text.encode()).hexdigest(),'.dockerignore':hashlib.sha256(ignore.encode()).hexdigest()}
    for prefix,key in [('dist-delta/','delta'),('server-delta/','serverDelta')]:
        for n,h in m[key].items():
            require(not Path(n).is_absolute() and all(p not in ['', '.', '..'] for p in n.split('/')),'Unsafe context artifact')
            result[prefix+n]=h
    return result
def main():
    require(Path(__file__).resolve().parent==ROOT and ROOT.resolve()==ROOT,'Unexpected cleanup root')
    require(len(sys.argv)==2 and re.fullmatch('[a-f0-9]{40}',sys.argv[1]),'Verified GitHub preservation commit required')
    locks=[]
    for path in [ROOT.parent/'themed-publish.lock',Path('/opt/royal/.client-presentation-deploy.lock'),Path('/opt/royal-game-modules-state/module.lock')]:
        require(not path.is_symlink(),'Unsafe cleanup lock')
        handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX);locks.append(handle)
    m,b,p=[read(ROOT/n) for n in ['install-manifest.json','build-result.json','published.json']]
    require(p['published'] and p['sourceCommit']==m['sourceCommit']==b['sourceCommit'],'Incomplete publication')
    require(p['runningImage']==b['image'],'Image evidence differs')
    game=json.loads(subprocess.check_output(['docker','inspect','royal-game-1']))[0]
    require(game['State'].get('Health',{}).get('Status')=='healthy','Current image is not healthy')
    protected_release=current_release(game,b)
    # Retention keeps the current release and its rollback. Once a verified
    # successor is current, its backup preserves our image; our older rollback
    # may already have been retired by the completed automatic maintenance.
    protected_root=ROOT.parent/protected_release
    protected_m,protected_b=[read(protected_root/n) for n in ['install-manifest.json','build-result.json']]
    backup=Path(protected_b['backup'])
    require(backup==Path('/opt/royal-backups')/protected_m['release'] and not backup.is_symlink(),'Unexpected backup')
    require(sha(backup/'source.tgz')==protected_b['sourceBackupSha256'],'Current rollback source backup differs')
    # A host-only successor preserves the external module contract in place.
    host_backup=backup/'host.json'
    host_current=Path('/opt/royal-game-modules-state/host.json')
    require(valid_host_rollback(protected_release==ROOT.name,sha(host_backup) if host_backup.exists() else None,sha(host_current),protected_m['before']['moduleHostContract']),'Current rollback host contract differs')
    rows=[];context=ROOT/'runtime-context'
    if context.exists():
        require(context.resolve()==context and context.is_dir() and not any(p.is_symlink() for p in context.rglob('*')),'Unsafe build context')
        require(inventory(context)==context_expected(m),'Build context bytes changed')
        rows.append({'path':str(context),'directory':True,'logicalBytes':sum(p.stat().st_size for p in context.rglob('*') if p.is_file())})
    for name,digest in ARCHIVES.items():
        path=ROOT/name
        if path.exists():
            require(not path.is_symlink() and path.is_file() and sha(path)==digest,'Transport changed: '+name)
            rows.append({'path':str(path),'directory':False,'logicalBytes':path.stat().st_size})
    free=shutil.disk_usage('/opt/royal').free
    for row in rows:
        path=Path(row['path']);require(path.parent==ROOT and path.resolve()==path,'Cleanup escaped release directory')
        if row['directory']:shutil.rmtree(path)
        else:path.unlink()
    result={'removed':rows,'removedLogicalBytes':sum(r['logicalBytes'] for r in rows),'freeBefore':free,'freeAfter':shutil.disk_usage('/opt/royal').free,'preservedInGitHub':sys.argv[1],'sourceCommit':m['sourceCommit'],'image':b['image'],'protectedCurrentRelease':protected_release,'healthyCurrentImage':game['Image'],'protectedRollbackBackup':str(backup),'backupPreserved':True,'databaseRestored':False}
    (ROOT/'cleanup.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
if __name__=='__main__':main()
