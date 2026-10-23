"""Inventory the financial dependency closure and preserved host identities."""
from pathlib import Path
import hashlib
import json
import subprocess

LIVE=Path('/opt/royal');FINANCE=Path('/opt/royal-finance')
run=lambda args:subprocess.check_output(args,text=True).strip()
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
inspect=lambda name:json.loads(run(['docker','inspect',name]))[0]

def profile(row):
    config=row['Config'];host=row['HostConfig']
    return {'envHash':hashlib.sha256(json.dumps(sorted(config['Env'])).encode()).hexdigest(),
        'user':config.get('User'),'cwd':config.get('WorkingDir'),'cmd':config.get('Cmd'),'entrypoint':config.get('Entrypoint'),
        'resources':{k:host.get(k) for k in ['CpuShares','NanoCpus','Memory','MemorySwap','PidsLimit','ReadonlyRootfs','RestartPolicy','PortBindings','CapAdd','CapDrop','SecurityOpt','Privileged']},
        'mounts':sorted([{k:m.get(k) for k in ['Type','Source','Destination','RW','Propagation']} for m in row['Mounts']],key=lambda m:m['Destination']),
        'networks':sorted(row['NetworkSettings']['Networks'])}

def snapshot():
    manifest=json.loads((Path(__file__).parent/'manifest.json').read_text())
    containers={}
    for name in run(['docker','ps','--format','{{.Names}}']).splitlines():
        if name in ['royal-nile-reconcile-once','royal-nile-account-views-once']:continue
        try:row=inspect(name)
        except subprocess.CalledProcessError:
            if name in ['royal-game-1','royal-nile-play','royal-payments-1']:raise
            continue
        if row['HostConfig']['RestartPolicy']['Name'] not in ['always','unless-stopped']:continue
        containers[name]={'id':row['Id'],'image':row['Image'],'health':row['State'].get('Health',{}).get('Status'),
            'profile':profile(row),'composeFiles':row['Config'].get('Labels',{}).get('com.docker.compose.project.config_files','').split(',')}
    prepared=run(['docker','image','inspect','royal-game:latest','--format','{{.Id}}'])
    sources=lambda root:{n:{'sha256':sha(root/n)} for n in manifest['inputs'] if (root/n).is_file()}
    settings={str(p):sha(p) for p in {LIVE/'.env',*[Path(n) for key in ['royal-game-1','royal-nile-play'] for n in containers[key]['composeFiles']]}}
    return {'source':sources(LIVE),'financeSource':sources(FINANCE),'containers':containers,'preparedImage':prepared,
        'program':{'container':containers['royal-game-1']['id'],'image':containers['royal-game-1']['image']},
        'preparedProgram':{'immutableImage':prepared},'configuration':settings,
        'modules':{str(p):sha(p) for p in Path('/opt/royal-game-modules').rglob('active.json') if p.is_file()},
        'hostContract':sha('/opt/royal-game-modules-state/host.json')}
