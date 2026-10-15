import { spawnSync } from 'node:child_process';

const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', CODEX_HOME: '/home/node/.codex' };
const profiles = [['baseline', ':workspace', []]];
if (typeof adapterBase64 === 'string') {
  const { permissionArgs } = await import(`data:text/javascript;base64,${adapterBase64}`);
  for (const role of ['analyst', 'developer', 'tester']) profiles.push([role, `royal-${role}`, permissionArgs(role, { env })]);
}
for (const [role, profile, permission] of profiles) {
  const result = spawnSync('strace', [
    '-f', '-s', '300', '-e', 'trace=clone,clone3,unshare,mount,pivot_root,umount2,execve,capset,setns,mount_setattr,open_tree,move_mount,fsopen,fsconfig,fsmount,fspick',
    'codex', 'sandbox', '-P', profile, '-C', '/tmp', ...permission, '--', '/bin/true',
  ], { env, encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
  const observed = (result.stderr ?? '').split('\n').filter(line =>
    /execve\(|CLONE_NEW|unshare\(|mount\(|pivot_root\(|umount2\(|setns\(|mount_setattr\(|open_tree\(|move_mount\(|fs(?:open|config|mount|pick)\(|EPERM|bwrap:|strace:/.test(line));
  console.log(JSON.stringify({ role, uid: process.getuid(), status: result.status, error: result.error?.code ?? null, observed }, null, 2));
  if (result.status !== 0 || result.error) process.exitCode = 1;
}
