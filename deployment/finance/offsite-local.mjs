import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptBackup } from './offsite-crypto.mjs';
import { ensureOffsiteCopy } from './offsite-copy.mjs';
import { ensureNileOffsiteCopy } from './nile-offsite-copy.mjs';
import { ensureNileBindingsCopy } from './nile-bindings-offsite.mjs';
import { ensureNilePlayCopy } from './nile-play-offsite-copy.mjs';

process.umask(0o077);
const home = os.homedir();
const runtime = path.join(home, 'Library/Application Support/RoyalFinanceOperations');
const backups = path.join(home, 'Library/Application Support/RoyalFinanceBackups');
const nileBackups = path.join(home, 'Library/Application Support/RoyalNileTestBackups');
const nileConfig = path.join(nileBackups,'nile-test.json');
const keyFile = path.join(home, '.config/royal-finance-backup/key');
const statusFile = path.join(runtime, 'status.json');
const label = 'com.royal.finance.offsite';
const remote = 'root@45.192.12.242';
const ssh = ['-i', path.join(home, '.ssh/royal_server_ed25519'), '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1',
  '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2'];

function command(binary, args, timeout = 120_000) {
  const attempts=binary === '/usr/bin/ssh' ? 2 : 1;
  for (let attempt=0;attempt<attempts;attempt++) {
    const result = spawnSync(binary, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
    if (!result.error && result.status === 0) return result.stdout;
  }
  throw new Error(binary === '/usr/bin/ssh' ? 'server_unreachable' : 'external_copy_failed');
}

async function jsonFile(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}

async function atomicJson(file, value) {
  const temporary = file + '.' + randomBytes(6).toString('hex') + '.partial';
  try {
    await writeFile(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

async function backupKey(create = false) {
  await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  let key;
  try {
    const info = await stat(keyFile);
    if ((info.mode & 0o077) !== 0) throw new Error('backup_key_permissions_invalid');
    key = await readFile(keyFile);
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    for (const directory of [backups,nileBackups]) {
      if ((await readdir(directory)).some(name => name.endsWith('.aes256gcm'))) throw new Error('existing_backup_key_missing');
    }
    key = randomBytes(32);
    await writeFile(keyFile, key, { flag: 'wx', mode: 0o600 });
  }
  if (key.length !== 32) throw new Error('invalid_backup_key');
  return key;
}

async function pull(key) {
  const latest = JSON.parse(command('/usr/bin/ssh', [...ssh, remote,
    'python3 /opt/royal-finance/deployment/finance/operations.py latest']));
  return ensureOffsiteCopy(latest, backups, key, async temporary => {
    command('/usr/bin/scp', [...ssh, remote + ':' + latest.directory + '/' + latest.metadata.file, temporary], 3_600_000);
  });
}

async function depositPoolPin(){try{return JSON.parse(await readFile(path.join(nileBackups,'deposit-pool.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
async function pullNile(key) {
  const config=JSON.parse(await readFile(nileConfig,'utf8'));
  const latest=JSON.parse(command('/usr/bin/ssh',[...ssh,remote,
    'python3 /opt/royal-finance/deployment/finance/operations.py nile-latest']));
  return ensureNileOffsiteCopy(latest,nileBackups,key,config,async temporary=>{
    command('/usr/bin/scp',['-C',...ssh,remote+':'+latest.directory+'/'+latest.metadata.file,temporary],300000);
  },async (restored,sha256)=>{
    const result=spawnSync(process.execPath,[path.join(runtime,'nile-verify.js'),'verify-backup',restored,sha256],{
      encoding:'utf8',timeout:60000,maxBuffer:1024*1024,
      env:{...process.env,NILE_TEST_MODE:'testnet-only',NILE_TEST_NETWORK:'nile',NILE_TEST_CONFIG_FILE:nileConfig,NILE_DEPOSIT_POOL_FILE:path.join(nileBackups,'deposit-pool.json')},
    });
    if (result.error||result.status!==0) throw new Error('nile_external_restore_failed');
    return JSON.parse(result.stdout);
  },await depositPoolPin());
}

function notify(message) {
  const script = 'display notification ' + JSON.stringify(message) + ' with title "Рояль: финансовый сервер"';
  spawnSync('/usr/bin/osascript', ['-e', script], { timeout: 10_000, stdio: 'ignore' });
}

function secondsSince(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.max(0, (Date.now() - milliseconds) / 1000) : Infinity;
}

async function check() {
  const previous = await jsonFile(statusFile);
  const issues = [];
  let stored,storedNile,storedBindings,storedPlay,state;
  try {
    state = JSON.parse(command('/usr/bin/ssh', [...ssh, remote,
      'python3 /opt/royal-finance/deployment/finance/operations.py status'], 45_000));
    if (secondsSince(state.monitor?.checked_at) > 180) issues.push('server_monitor_stale');
    if (!state.monitor?.ok) issues.push(...(state.monitor?.issues ?? ['server_monitor_failed']));
    if (!state.backup?.ok || secondsSince(state.backup?.last_success_at) > 7200) issues.push('backup_failed_or_stale');
    if (!state.restore?.ok || secondsSince(state.restore?.last_success_at) > 30 * 3600) issues.push('restore_failed_or_stale');
    stored = await pull(await backupKey(true));
    if (secondsSince(stored.created_at) > 7200) issues.push('external_backup_stale');
  } catch (error) {
    issues.push(/^[a-z_]+$/.test(error.message) ? error.message : 'external_check_failed');
  }
  const nileRequired=state?.nile_required ?? previous.nile_required ?? false;
  if (nileRequired && !state?.unified_postgres) {
    try {
      storedNile=await pullNile(await backupKey());
      if (secondsSince(storedNile.createdAt)>7200) issues.push('nile_external_backup_stale');
    } catch (error) {issues.push(/^[a-z_]+$/.test(error.message)?error.message:'nile_external_copy_failed');}
  }
  const accountsRequired=state?.nile_accounts_required ?? previous.nile_accounts_required ?? false;
  if (accountsRequired) {
    try {
      const latest=JSON.parse(command('/usr/bin/ssh',[...ssh,remote,
        'python3 /opt/royal-finance/deployment/finance/nile-account-views.py latest']));
      storedBindings=await ensureNileBindingsCopy(latest,path.join(nileBackups,'account-bindings'),await backupKey(),JSON.parse(await readFile(nileConfig,'utf8')));
    } catch (error) {issues.push(/^[a-z_]+$/.test(error.message)?error.message:'nile_bindings_external_copy_failed');}
  }
  const playRequired=state?.nile_play_required ?? previous.nile_play_required ?? false;
  if(playRequired && !state?.unified_postgres){
    try{
      const pinFile=path.join(nileBackups,'play.json'),pin=JSON.parse(await readFile(pinFile,'utf8'));
      const latest=JSON.parse(command('/usr/bin/ssh',[...ssh,remote,'python3 /opt/royal-finance/deployment/finance/nile-play-operator.py latest']));
      storedPlay=await ensureNilePlayCopy(latest,path.join(nileBackups,'play'),await backupKey(),pin,async temporary=>{
        command('/usr/bin/scp',[...ssh,remote+':'+latest.directory+'/'+latest.metadata.file,temporary]);
      },async(file,sha256)=>{
        const result=spawnSync(process.execPath,[path.join(runtime,'play-verify.js'),'verify-backup',file,sha256],{encoding:'utf8',timeout:60000,maxBuffer:1048576,env:{...process.env,NILE_TEST_MODE:'testnet-only',NILE_TEST_NETWORK:'nile',NILE_PLAY_CONFIG_FILE:pinFile,NILE_DEPOSIT_POOL_FILE:path.join(nileBackups,'deposit-pool.json')}});
        if(result.error||result.status!==0)throw new Error('play_external_restore_failed');return JSON.parse(result.stdout);
      },await depositPoolPin());
      if(secondsSince(storedPlay.createdAt)>900)issues.push('play_external_backup_stale');
    }catch(error){issues.push(/^[a-z_]+$/.test(error.message)?error.message:'play_external_copy_failed');}
  }
  try {
    const response = await fetch('https://stealth-spark-gokmxooi.expresshost.cloud/healthz', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !(await response.json()).ok) issues.push('public_game_unavailable');
  } catch { issues.push('public_game_unavailable'); }
  const uniqueIssues = [...new Set(issues)].sort();
  const signature = uniqueIssues.join(',');
  const failures = signature ? (previous.issue_signature === signature ? (previous.consecutive_failures ?? 0) + 1 : 1) : 0;
  let notified = previous.notified_signature ?? '';
  if (signature && failures >= 2 && notified !== signature) {
    notify('Проверка обнаружила проблему: ' + uniqueIssues.join(', ') + '. Подробности в RoyalFinanceOperations/status.json.');
    notified = signature;
  } else if (!signature && notified) {
    notify('Сервис и резервные копии снова проходят проверки.');
    notified = '';
  }
  const result = { ok: !signature, checked_at: new Date().toISOString(), issues: uniqueIssues,
    issue_signature: signature, consecutive_failures: failures, notified_signature: notified,
    last_copy: stored?.file ?? previous.last_copy, last_copy_at: stored?.copied_at ?? previous.last_copy_at,
    last_verified_at: stored?.verified_at ?? previous.last_verified_at,
    nile_required:nileRequired,nile_accounts_required:accountsRequired,last_bindings_copy:storedBindings?.file ?? previous.last_bindings_copy,
    nile_play_required:playRequired,last_play_copy:storedPlay?.file??previous.last_play_copy,last_play_verified_at:storedPlay?.verified_at??previous.last_play_verified_at,
    last_bindings_verified_at:storedBindings?.verified_at ?? previous.last_bindings_verified_at,last_nile_copy:storedNile?.file ?? previous.last_nile_copy,
    last_nile_copy_at:storedNile?.copied_at ?? previous.last_nile_copy_at,
    last_nile_verified_at:storedNile?.verified_at ?? previous.last_nile_verified_at,
    last_success_at: !signature ? new Date().toISOString() : previous.last_success_at,
    monitor_location: 'Mac', requires_awake_computer: true };
  await atomicJson(statusFile, result);
  console.log(JSON.stringify(result));
  process.exitCode = signature ? 1 : 0;
}

function xml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

async function install() {
  await backupKey(true);
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const hasNilePin=(await jsonFile(nileConfig)).network === 'nile';
  const verifierSource=sourceDirectory===runtime ? path.join(runtime,'nile-verify.js')
    : path.resolve(sourceDirectory,'../../dist-server/nile-verify.js');
  if (hasNilePin) await stat(verifierSource);
  for (const name of ['offsite-local.mjs', 'offsite-crypto.mjs', 'offsite-copy.mjs','nile-offsite-copy.mjs','nile-bindings-offsite.mjs','nile-play-offsite-copy.mjs']) {
    const destination = path.join(runtime, name);
    if (path.join(sourceDirectory, name) !== destination) await copyFile(path.join(sourceDirectory, name), destination);
    await chmod(destination, 0o600);
  }
  if((await jsonFile(path.join(nileBackups,'play.json'))).version===1){const source=sourceDirectory===runtime?path.join(runtime,'play-verify.js'):path.resolve(sourceDirectory,'../../dist-server/play-verify.js');if(source!==path.join(runtime,'play-verify.js'))await copyFile(source,path.join(runtime,'play-verify.js'));await chmod(path.join(runtime,'play-verify.js'),0o600);}
  if (hasNilePin) {
    if (verifierSource!==path.join(runtime,'nile-verify.js')) await copyFile(verifierSource,path.join(runtime,'nile-verify.js'));
    await chmod(path.join(runtime,'nile-verify.js'),0o600);
  }
  const launchDirectory = path.join(home, 'Library/LaunchAgents');
  await mkdir(launchDirectory, { recursive: true, mode: 0o700 });
  const plist = path.join(launchDirectory, label + '.plist');
  let nodeBinary = process.execPath;
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try { await stat(candidate); nodeBinary = candidate; break; } catch { /* Use the active runtime if Homebrew is absent. */ }
  }
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(nodeBinary)}</string><string>${xml(path.join(runtime, 'offsite-local.mjs'))}</string><string>check</string></array>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer>
<key>ProcessType</key><string>Background</string><key>LowPriorityIO</key><true/>
<key>StandardOutPath</key><string>${xml(path.join(runtime, 'launchd.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(runtime, 'launchd-error.log'))}</string>
</dict></plist>\n`;
  await writeFile(plist, document, { mode: 0o600 });
  command('/usr/bin/plutil', ['-lint', plist]);
  const domain = 'gui/' + os.userInfo().uid;
  const current = spawnSync('/bin/launchctl', ['print', domain + '/' + label], { stdio: 'ignore' });
  if (current.status === 0) command('/bin/launchctl', ['bootout', domain + '/' + label]);
  command('/bin/launchctl', ['bootstrap', domain, plist]);
  console.log(JSON.stringify({ installed: true, interval_seconds: 300, backup_directory: backups,
    key_file: keyFile, requires_awake_computer: true }));
}

async function main() {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await mkdir(backups, { recursive: true, mode: 0o700 });
  await mkdir(nileBackups,{recursive:true,mode:0o700});
  await chmod(runtime, 0o700);
  await chmod(backups, 0o700);
  await chmod(nileBackups,0o700);
  const action = process.argv[2];
  if (action === 'install') return install();
  if (action === 'status') { console.log(JSON.stringify(await jsonFile(statusFile))); return; }
  if (action === 'decrypt') {
    const source = process.argv[3];
    const target = process.argv[4];
    if (!source?.endsWith('.aes256gcm') || !target) throw new Error('decrypt_arguments_invalid');
    const metadata = await jsonFile(source.slice(0, -'.aes256gcm'.length) + '.json');
    if (!/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error('backup_metadata_invalid');
    await decryptBackup(source, target, await backupKey(), metadata.sha256);
    console.log(JSON.stringify({ decrypted: true, destination: target, sha256: metadata.sha256 }));
    return;
  }
  if (action !== 'check') throw new Error('unknown_operation');
  // launchd serializes its own executions. This also excludes simultaneous manual runs.
  const lock = path.join(runtime, 'check.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await jsonFile(path.join(lock, 'owner.json'));
    let ownerAlive = false;
    if (Number.isInteger(owner.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); ownerAlive = true; } catch { /* The interrupted check has exited. */ }
    }
    if (ownerAlive || (!owner.pid && Date.now() - (await stat(lock)).mtimeMs < 10 * 60_000)) {
      console.log(JSON.stringify({ skipped: true, reason: 'check_running' })); return;
    }
    await rm(lock, { recursive: true });
    await mkdir(lock, { mode: 0o700 });
  }
  await atomicJson(path.join(lock, 'owner.json'), { pid: process.pid });
  try {
    for (const [directory,pattern] of [
      [backups,/^finance-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump\.[a-f0-9]{12}\.partial(?:\.restore|\.aes256gcm)?$/],
      [nileBackups,/^nile-credit-\d{8}T\d{9}Z-[a-f0-9]{8}\.sqlite(?:\.json)?\.[a-f0-9]{12}\.partial(?:\.restore|\.aes256gcm)?$/],
    ]) for (const name of await readdir(directory)) {
      if (pattern.test(name) && Date.now() - (await stat(path.join(directory, name))).mtimeMs > 30 * 60_000) {
        await rm(path.join(directory, name), { force: true });
      }
    }
    for (const name of ['launchd.log', 'launchd-error.log']) {
      const log = path.join(runtime, name);
      try { if ((await stat(log)).size > 5 * 1024 * 1024) await writeFile(log, '', { mode: 0o600 }); } catch { /* Logging is optional. */ }
    }
    await check();
  } finally { await rm(lock, { recursive: true, force: true }); }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: /^[a-z_]+$/.test(error.message) ? error.message : 'local_operation_failed' }));
  process.exitCode = 1;
});
