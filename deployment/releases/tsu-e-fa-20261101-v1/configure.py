"""Bind only the authorized Tsu-e-fa changes to the actual published source."""
import copy, hashlib, importlib.util, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
COMMITS=['8069433','7d85f4a','48e26ff','82fdd4f','0838623','e749c64','cc24e8f','8ed4d87','a01226e','0bc95d2']
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL)
def sha(value):return hashlib.sha256(value).hexdigest()
def blob(commit,name):
    value=git('show',commit+':'+name)
    return value if name.endswith(('.png','.jpg','.webp','.wav')) else value.replace(b'\r\n',b'\n')
def row(commit,name):
    commit=git('rev-parse',commit).decode().strip();value=blob(commit,name)
    return {'commit':commit,'path':name,'baseSha256':sha(value),'sha256':sha(value)}
def projected(value):
    data=blob(value['commit'],value['path']).decode()
    assert sha(data.encode())==value['baseSha256']
    for patch in value.get('patches',[]):
        assert data.count(patch['from'])==1
        data=data.replace(patch['from'],patch['to'])
    assert sha(data.encode())==value['sha256']
    return data
spec=importlib.util.spec_from_file_location('reviewed_overlay',HERE.parent/'hall-elevator-20261101-v1/configure.py')
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
def main():
    before=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    source=before['sourceLF'];candidates={}
    for file in sorted(HERE.parent.glob('*/*projection*.json')):
        if file.parent==HERE:continue
        try:config=json.loads(file.read_text(encoding='utf-8-sig'))
        except (ValueError,UnicodeError):continue
        for name,value in config.get('files',{}).items():
            if isinstance(value,dict) and value.get('sha256')==source.get(name):candidates[name]=value
    def origin(name):
        if name in candidates:return copy.deepcopy(candidates[name])
        for commit in git('log','--format=%H','HEAD','--',name).decode().splitlines():
            try:value=row(commit,name)
            except subprocess.CalledProcessError:continue
            if value['sha256']==source.get(name):candidates[name]=value;return copy.deepcopy(value)
        raise RuntimeError('No committed production origin: '+name)
    current={};changed=set()
    for short in COMMITS:
        commit=git('rev-parse',short).decode().strip()
        paths=git('diff','--name-only',commit+'^',commit,'--','src','server','games','public').decode().splitlines()
        for name in paths:
            if name.endswith('.md'):continue
            try:after=blob(commit,name)
            except subprocess.CalledProcessError:continue
            if name.startswith('public/'):
                current[name]=row(commit,name);changed.add(name);continue
            if name not in current:
                current[name]=origin(name) if name in source else row(commit,name)
                if name not in source:changed.add(name);continue
            live=projected(current[name])
            try:old=blob(commit+'^',name).decode()
            except subprocess.CalledProcessError:old=None
            if old is None:
                assert live==after.decode(),'New source collides with published file: '+name
                continue
            if live==after.decode():continue
            if live==old:current[name]=row(commit,name)
            else:
                value,patches=helper.overlay(old,after.decode(),live)
                current[name]={**current[name],'patches':current[name].get('patches',[])+patches,'sha256':sha(value.encode())}
            changed.add(name)
    # The current qualified financial runtime must be exact, not a mixed graph.
    policy=json.loads(blob('HEAD','scripts/game-math/rtp-policy.json'))
    for name in policy['profiles']['tsu-e-fa']['sources']:
        if not name.startswith(('server/','src/')):continue
        head=row('HEAD',name)
        if name in current:assert current[name]['sha256']==head['sha256'],'Mixed monetary source: '+name
        elif source.get(name)==head['sha256']:continue
        else:raise RuntimeError('Unreviewed monetary source difference: '+name)
    template=HERE.parent/'hall-elevator-20261101-v1'
    preserved_backend=json.loads((template/'backend-projection.json').read_text(encoding='utf-8'))['files']['src/i18n/en.ts']
    for kind in ['host','backend']:
        base=json.loads((template/(kind+'-projection.json')).read_text(encoding='utf-8'))
        files={}
        for name in base['files']:
            if name in source:
                try:files[name]=origin(name)
                except RuntimeError:pass
        # Include verified published dependencies added after the foundation template.
        files.update({name:copy.deepcopy(value) for name,value in candidates.items() if name in source})
        files.update(current)
        if kind=='backend':files['src/i18n/en.ts']=preserved_backend
        base={'format':1,'productionCommit':before['sourceCommit'],'entries':base['entries'],'files':files}
        if kind=='host':
            base.update(moduleGames=['tsu-e-fa'],moduleContracts={'tsu-e-fa':{'apiVersion':1,'rulesVersion':4,'progressVersion':1}},
                moduleAssets={'public/assets/tsu-e-fa/v2/hand-poses.png':current['public/assets/tsu-e-fa/v2/hand-poses.png']['sha256']})
        (HERE/(kind+'-projection.json')).write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    expected={name:value['sha256'] for name,value in current.items() if value['sha256']!=source.get(name)}
    scope={'release':HERE.name,'productionCommit':before['sourceCommit'],'featureCommits':COMMITS,
        'expectedSources':expected,'preservedBackendInputs':{'src/i18n/en.ts':preserved_backend['sha256']},
        'activeGames':json.loads((HERE.parent/'shared-stakes-20261101-v1/scope.json').read_text(encoding='utf-8'))['activeGames'],
        'addedGames':['tsu-e-fa'],'restoredGames':[],'moduleGames':['tsu-e-fa']}
    (HERE/'scope.json').write_text(json.dumps(scope,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'base':before['sourceCommit'],'changedSources':len(expected),'addedGames':['tsu-e-fa']}))
if __name__=='__main__':main()
