"""Build an overlay from verified bytes without executing the application."""
from pathlib import Path
import hashlib, http.client, io, json, os, re, socket, tarfile, uuid
CONTENT=Path('/var/lib/containerd/io.containerd.content.v1.content/blobs/sha256')

def require(value,message):
    if not value: raise RuntimeError(message)
def blob(digest,content=CONTENT):
    require(re.fullmatch('sha256:[a-f0-9]{64}',digest or ''),'Unsafe OCI digest')
    file=content/digest.split(':')[1];require(file.is_file() and not file.is_symlink() and file.stat().st_size<=4*1024**2,'Unsafe OCI metadata')
    raw=file.read_bytes();require('sha256:'+hashlib.sha256(raw).hexdigest()==digest,'OCI checksum differs');return json.loads(raw)
def metadata(identity,content=CONTENT,architecture=None):
    manifest=blob(identity,content)
    if 'manifests' in manifest:
        arch=architecture or {'x86_64':'amd64','aarch64':'arm64'}.get(os.uname().machine,os.uname().machine)
        rows=[r for r in manifest['manifests'] if r.get('platform',{}).get('os')=='linux' and r.get('platform',{}).get('architecture')==arch]
        require(len(rows)==1,'Ambiguous OCI platform');manifest=blob(rows[0]['digest'],content)
    require(manifest.get('schemaVersion')==2 and manifest.get('config'),'Unsupported OCI manifest')
    config=blob(manifest['config']['digest'],content);layers=config.get('rootfs',{}).get('diff_ids')
    require(isinstance(layers,list) and layers and all(re.fullmatch('sha256:[a-f0-9]{64}',n) for n in layers),'Invalid OCI layers')
    return {'Config':config['config'],'RootFS':{'Layers':layers},'configDigest':manifest['config']['digest']}
def engine(method,path,body=None,binary=False,timeout=300):
    class Connection(http.client.HTTPConnection):
        def connect(self):
            self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(self.timeout);self.sock.connect('/var/run/docker.sock')
    c=Connection('localhost',timeout=timeout)
    try:
        c.request(method,path,body if binary else json.dumps(body).encode() if body is not None else None,{'Content-Type':'application/x-tar' if binary else 'application/json'})
        r=c.getresponse();data=r.read();require(r.status in {200,201,204},'Docker staging request failed: '+method+' '+path+' '+str(r.status));return data
    finally:c.close()
def archive(root,files):
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w') as out:
        for source,destination in sorted(files.items()):
            require(not Path(destination).is_absolute() and all(p not in ['', '.', '..'] for p in destination.split('/')),'Unsafe overlay path')
            file=Path(root)/source;require(file.is_file() and file.resolve()==file,'Unsafe overlay file')
            raw=file.read_bytes();entry=tarfile.TarInfo(destination);entry.size=len(raw);entry.uid=entry.gid=1000;entry.uname=entry.gname='node';entry.mode=0o644;entry.mtime=0;out.addfile(entry,io.BytesIO(raw))
    return data.getvalue()
def build(root,parent,repo,tag,source_commit,files):
    require(re.fullmatch('[a-f0-9]{40}',source_commit),'Invalid source commit')
    require(repo in ['royal-game','royal-nile-play'] and re.fullmatch('[a-z0-9-]+',tag),'Invalid candidate tag')
    owner=uuid.uuid4().hex;identity=None;parent_info=metadata(parent)
    try:
        created=json.loads(engine('POST','/containers/create?name=royal-stake-build-'+owner,{'Image':parent,'Labels':{'royal.stake.build':owner},'HostConfig':{'NetworkMode':'none','CapDrop':['ALL'],'SecurityOpt':['no-new-privileges=true']}}));identity=created['Id'];require(re.fullmatch('[a-f0-9]{64}',identity),'Invalid staging container')
        engine('PUT','/containers/'+identity+'/archive?path=/app&noOverwriteDirNonDir=true&copyUIDGID=true',archive(root,files),True)
        config=dict(parent_info['Config']);config['Labels']={**(config.get('Labels') or {}),'org.opencontainers.image.revision':source_commit}
        committed=json.loads(engine('POST','/commit?container='+identity+'&repo='+repo+'&tag='+tag+'&pause=false',config,timeout=900))
        require(re.fullmatch('sha256:[a-f0-9]{64}',committed.get('Id','')),'Uncertain staging commit')
        return committed['Id']
    finally:
        if identity:
            state=json.loads(engine('GET','/containers/'+identity+'/json'));require(state['Config']['Labels'].get('royal.stake.build')==owner and not state['State']['Running'],'Staging container ownership changed')
            engine('DELETE','/containers/'+identity+'?v=true')
