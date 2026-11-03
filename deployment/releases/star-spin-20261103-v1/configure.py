"""Bind Star Spin alone to the verified production host and native money graph."""
import copy,hashlib,importlib.util,json,subprocess,sys
from pathlib import Path
ROOT=Path.cwd();HERE=ROOT/'deployment/releases/star-spin-20261103-v1'
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL)
def sha(data):return hashlib.sha256(data).hexdigest()
def blob(commit,name):
    data=git('show',commit+':'+name)
    return data if Path(name).suffix in ['.png','.jpg','.jpeg','.webp','.wav','.mp3','.ogg','.webm','.mp4','.riv'] else data.replace(b'\r\n',b'\n')
def row(commit,name):
    data=blob(commit,name);origin=git('log','-1','--format=%H',commit,'--',name).decode().strip();assert blob(origin,name)==data
    return dict(commit=origin,path=name,baseSha256=sha(data),sha256=sha(data))
def content(value):
    data=blob(value['commit'],value['path']);assert sha(data)==value['baseSha256']
    if value.get('patches'):
        data=data.decode()
        for patch in value['patches']:assert data.count(patch['from'])==1;data=data.replace(patch['from'],patch['to'])
        data=data.encode()
    assert sha(data)==value['sha256'];return data
spec=importlib.util.spec_from_file_location('star_spin_overlay',HERE.parent/'hall-elevator-20261101-v1/configure.py')
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
def main():
    before=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'));feature=git('rev-parse',sys.argv[2]).decode().strip();base=git('rev-parse','44b12afd').decode().strip()
    configs={kind:json.loads((HERE.parent/'lobby-connection-20261101-v1'/(kind+'-projection.json')).read_text()) for kind in ['host','backend']}
    # Independent modules also consume the root TypeScript configuration.
    # The production backend already pins these exact unchanged bytes.
    configs['host']['files']['tsconfig.json']=copy.deepcopy(configs['backend']['files']['tsconfig.json'])
    # This adapter is compiled only for local accepted-round qualification.
    # Production uses the main host wallet; the retired native service is preserved.
    original_backend=copy.deepcopy(configs['backend']['files'])
    old_native=dict(format=1,productionCommit=before['sourceCommit'],entries=['server/finance/nile-game-runtime.ts'],files=copy.deepcopy(original_backend))
    name='server/finance/nile-game-runtime.ts';candidate=row(feature,name)
    assert candidate['sha256']==before['sourceLF'].get(name),'Native test adapter changed from its reviewed source'
    old_native['files'][name]=candidate
    old_native['files']['package.json']=row(feature,'package.json')
    origins={name:value for config in configs.values() for name,value in config['files'].items() if value['sha256']==before['sourceLF'].get(name)}
    paths=git('diff','--name-only',base,feature,'--','src','server','games/wild-nudge','public/assets/wild-nudge','package.json','package-lock.json').decode().splitlines()
    paths=sorted(set(paths)|set(git('ls-tree','-r','--name-only',feature,'--','games/wild-nudge','public/assets/wild-nudge').decode().splitlines()))
    selected={}
    for name in paths:
        target=row(feature,name)
        if name.startswith(('games/wild-nudge/','public/assets/wild-nudge/')) or name not in before['sourceLF'] or name in ['package.json','package-lock.json']:
            selected[name]=target;continue
        prior=origins.get(name)
        if prior is None:
            for commit in git('log','--format=%H',feature,'--',name).decode().splitlines():
                candidate=row(commit,name)
                if candidate['sha256']==before['sourceLF'][name]:prior=candidate;break
        assert prior is not None,'Missing production origin: '+name
        live=content(prior)
        if live==blob(base,name):selected[name]=target
        else:
            if name=='src/modules/GameModuleCatalog.ts' and "gameId: 'studio-wild-nudge'" not in live.decode():
                old='export const STUDIO_GAME_MODULES = [\n';addition=next(line for line in blob(feature,name).decode().splitlines(True) if "gameId: 'studio-wild-nudge'" in line)
                assert live.decode().count(old)==1;value=live.decode().replace(old,old+addition);patches=[{'from':old,'to':old+addition}]
            elif name in ['src/shared/cabinets.ts','src/ui/RoyalGameArtwork.ts','src/ui/RoyalCatalogArtwork.ts'] and 'studio-wild-nudge' not in live.decode():
                if name=='src/shared/cabinets.ts':old='export const GAME_CABINETS: readonly Cabinet[] = CABINETS.map(c=>({...c}));\n';addition=next(line for line in blob(feature,name).decode().splitlines(True) if "CABINETS.push({id:'studio-wild-nudge'" in line);new=addition+old
                elif name=='src/ui/RoyalGameArtwork.ts':old='const covers: Record<string, string> = {\n';addition=next(line for line in blob(base,name).decode().splitlines(True) if "'studio-wild-nudge':" in line);new=old+addition
                else:old='export function royalCatalogArtwork(id: string): string {\n';addition=next(line for line in blob(base,name).decode().splitlines(True) if "if(id==='studio-wild-nudge')" in line);new=old+addition
                assert live.decode().count(old)==1;value=live.decode().replace(old,new);patches=[{'from':old,'to':new}]
                if name!='src/shared/cabinets.ts':
                    value,extra=helper.overlay(blob(base,name).decode(),blob(feature,name).decode(),value);patches+=extra
            elif name=='src/i18n/en.ts' and "'Галактический реактор':" not in live.decode():
                old='\n};\n';new="\n  'Галактический реактор':'Star Spin',\n};\n";assert live.decode().count(old)==1
                value=live.decode().replace(old,new);patches=[{'from':old,'to':new}]
            else:
                try:value,patches=helper.overlay(blob(base,name).decode(),blob(feature,name).decode(),live.decode())
                except RuntimeError as error:raise RuntimeError(name+': '+str(error)) from error
            selected[name]={**prior,'patches':prior.get('patches',[])+patches,'sha256':sha(value.encode())}
    policy=json.loads(blob(feature,'scripts/game-math/rtp-policy.json'))
    # Every emitted monetary input of Star Spin must be the exact qualified source.
    money=set(policy['profiles']['studio-wild-nudge']['sources'])
    for name in money.intersection(selected):assert selected[name]['sha256']==row(feature,name)['sha256'],'Mixed monetary input: '+name
    expected={name:value['sha256'] for name,value in selected.items() if value['sha256']!=before['sourceLF'].get(name)}
    backend_preserved={}
    for kind,config in configs.items():
        for name in ['moduleGames','moduleContracts','moduleAssets','moduleDependencies']:config.pop(name,None)
        for name,value in config['files'].items():
            if value['sha256']!=before['sourceLF'].get(name):
                assert kind=='backend' and name=='src/i18n/en.ts';backend_preserved[name]=value['sha256']
        config['productionCommit']=before['sourceCommit'];config['files'].update(copy.deepcopy(selected))
        if kind=='backend':
            for name in backend_preserved:config['files'][name]=configs['backend']['files'][name] if name not in selected else json.loads((HERE.parent/'lobby-connection-20261101-v1/backend-projection.json').read_text())['files'][name]
        if kind=='host':
            media={p.as_posix():sha(p.read_bytes()) for p in Path('public/assets/wild-nudge').rglob('*') if p.is_file()}
            dependency='node_modules/@rive-app/webgl2/rive.js'
            config.update(moduleGames=['wild-nudge'],moduleContracts={'studio-wild-nudge':dict(apiVersion=1,rulesVersion=2,progressVersion=1)},moduleAssets=media,moduleDependencies={dependency:sha(Path(dependency).read_bytes())})
        (HERE/(kind+'-projection.json')).write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    new_native=copy.deepcopy(old_native);new_native['files'].update({name:copy.deepcopy(value) for name,value in selected.items() if name in old_native['files'] or name.startswith(('server/','src/shared/'))})
    # Preserve the native service's original translator, protocol and financial configuration.
    for name in ['src/i18n/en.ts']:
        if name in old_native['files']:new_native['files'][name]=copy.deepcopy(old_native['files'][name])
    for kind,config in [('native-before',old_native),('native',new_native)]:
        (HERE/(kind+'-projection.json')).write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    active=json.loads((HERE.parent/'shared-stakes-20261101-v1/scope.json').read_text())['activeGames']+['tsu-e-fa','studio-wild-nudge']
    scope=dict(release=HERE.name,productionCommit=before['sourceCommit'],featureCommit=feature,expectedSources=expected,preservedBackendInputs=backend_preserved,activeGames=active,addedGames=['studio-wild-nudge'],restoredGames=[],moduleGames=['wild-nudge'],hostPosterSource='games/wild-nudge/assets/catalog-cover.webp',hostPosterSha256=sha(blob(feature,'games/wild-nudge/assets/catalog-cover.webp')))
    (HERE/'scope.json').write_text(json.dumps(scope,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(dict(sources=len(expected),activeGames=len(active),base=before['sourceCommit'])))
if __name__=='__main__':main()
