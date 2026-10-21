"""Snapshot only the unchanged game schema and verify it in an isolated temporary database."""
import contextlib, datetime, hashlib, importlib.util, io, json, os, pathlib, subprocess, time

directory = pathlib.Path('/opt/royal-backups/cr-leo-20261021-data')
directory.mkdir(mode=0o700, exist_ok=True)
os.environ['FINANCE_BACKUP_DIR'] = str(directory)
os.environ['FINANCE_STATE_DIR'] = str(directory / 'state')
(directory / 'state').mkdir(mode=0o700, exist_ok=True)
spec = importlib.util.spec_from_file_location('royal_ops', '/opt/royal/deployment/finance/operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
ops.ROYAL_SCHEMAS = ('royal_game',)
os.umask(0o077)
with contextlib.redirect_stdout(io.StringIO()):
    dump = ops.backup()
metadata_path = dump.with_suffix('.dump.json')
metadata = json.loads(metadata_path.read_text())
metadata['scope'] = 'royal-game-postgres'
metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
assert metadata['schemas'] == ['royal_game']
container = 'royal-cr-leo-backup-check-' + str(os.getpid())
source = ops.db_container()
image = subprocess.check_output(['docker','inspect',source,'--format','{{.Image}}'],text=True).strip()
start = time.monotonic()
try:
    subprocess.run(['docker','run','-d','--name',container,'--network=none','--read-only',
        '--memory=768m','--cpus=0.5','--tmpfs','/var/lib/postgresql/data:rw,size=1g',
        '--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=32m',
        '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=finance_schema_owner',
        '-e','POSTGRES_DB=royal_finance_sim',image],check=True,stdout=subprocess.DEVNULL)
    for attempt in range(60):
        ready = subprocess.run(['docker','exec',container,'pg_isready','-U','finance_schema_owner','-d','royal_finance_sim'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        command = subprocess.check_output(['docker','exec',container,'cat','/proc/1/comm'],text=True).strip()
        if ready.returncode == 0 and command == 'postgres': break
        time.sleep(1)
    else: raise RuntimeError('Isolated database did not start')
    with dump.open('rb') as data, (directory/'restore.log').open('w') as log:
        subprocess.run(['docker','exec','-i',container,'pg_restore','-U','finance_schema_owner','-d','royal_finance_sim','--exit-on-error','--no-owner','--no-privileges'],stdin=data,stdout=log,stderr=log,check=True)
    content = ops.query(container,"SET timezone='UTC'; " + ops.qualified_copy_sql(metadata['all_tables']),'game_restore_fingerprint')
    digest, size = hashlib.sha256(content).hexdigest(), len(content)
    assert digest == metadata['data_sha256']
    proof_path = dump.with_suffix('.dump.restore.json')
    proof = {'ok':True,'scope':'royal-game-postgres','data_sha256':digest,'bytes':size,'isolated':True,'network':'none','liveVolumes':False,'seconds':round(time.monotonic()-start,2)}
    proof_path.write_text(json.dumps(proof,indent=2)+'\n')
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    assert sha(dump) == metadata['sha256']
    print(json.dumps({'verified':True,'dumpPath':str(dump),'dumpSha256':sha(dump),'metadataPath':str(metadata_path),'metadataSha256':sha(metadata_path),'restoreProofPath':str(proof_path),'restoreProofSha256':sha(proof_path),'created_at':metadata['created_at'],'scope':'royal-game-postgres','dataMatches':True,'restoreSeconds':proof['seconds']}))
finally:
    subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
