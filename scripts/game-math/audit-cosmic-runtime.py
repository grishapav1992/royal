"""Read-only source and package fingerprint for the Cosmic Escape audit."""
from pathlib import Path
import hashlib,json,subprocess,datetime
root=Path('/opt/royal')
paths=['server/games/luelonSlots.ts','src/shared/luelonSlots.ts','src/shared/luelonSlotsModels.ts','src/shared/luelonSlotsLines.ts','src/shared/cosmicEscapeBets.ts','src/ui/CosmicEscapeUI.ts','src/ui/slotKit/SlotSessions.ts','src/ui/slotKit/SlotScreens.ts','src/wallet/ExpansionClient.ts','server/demoExpansion.ts']
sha=lambda b:hashlib.sha256(b).hexdigest()
report={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'Read-only game source hashes, active immutable package integrity and container metadata. No player data, environment values or operations.','sourceHashes':{p:sha((root/p).read_bytes().replace(b'\r\n',b'\n')) for p in paths}}
module_root=Path('/opt/royal-game-modules')
pointer=json.loads((module_root/'studio-cosmic-escape/active.json').read_text())
manifest_path=(module_root/pointer['manifest'].removeprefix('/game-modules/')).resolve()
manifest_path.relative_to(module_root)
manifest_bytes=manifest_path.read_bytes()
assert sha(manifest_bytes)==pointer['sha256']
manifest=json.loads(manifest_bytes)
files={}
for name,expected in manifest['files'].items():
    path=(manifest_path.parent/name).resolve()
    path.relative_to(manifest_path.parent)
    actual=sha(path.read_bytes())
    assert actual==expected,name
    files[name]=actual
row=json.loads(subprocess.check_output(['docker','inspect','royal-game-1'],text=True))[0]
report.update({'activeModule':pointer,'moduleVersion':manifest['version'],'moduleSourceSha256':manifest.get('sourceSha256'),'immutableFilesVerified':files,'hostSourceCommit':row['Config']['Labels'].get('org.opencontainers.image.revision'),'hostImage':row['Image'],'health':row['State'].get('Health',{}).get('Status')})
print(json.dumps(report))
