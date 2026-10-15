import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

const MANAGED_WORKSPACE = /^\/workspaces\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PROTECTED_DIRECTORIES = ['.git', '.factory', '.codex', '.agents', '.aws'];

async function canonicalDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('The checks workspace and protected directories must be canonical directories.');
  }
}

export async function bwrapArgs(binary, args, { cwd, env = {} } = {}) {
  if (typeof cwd !== 'string' || resolve(cwd) !== cwd || !MANAGED_WORKSPACE.test(cwd)) {
    throw new Error('The checks must use an absolute managed workspace path.');
  }
  if (typeof binary !== 'string' || !binary || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new Error('The fixed checks command must contain string arguments.');
  }
  await canonicalDirectory(cwd);
  for (const name of PROTECTED_DIRECTORIES) await canonicalDirectory(`${cwd}/${name}`);
  if (env.NODE_OPTIONS !== undefined && env.NODE_OPTIONS !== '--max-old-space-size=384') {
    throw new Error('Only the fixed checks heap limit is accepted.');
  }
  if (env.PLAYWRIGHT_BROWSERS_PATH !== undefined && env.PLAYWRIGHT_BROWSERS_PATH !== '/opt/pw-browsers') {
    throw new Error('Only the bundled browser directory is accepted.');
  }
  const options = [
    '--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net',
    '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/etc/passwd', '/etc/passwd', '--ro-bind', '/etc/group', '/etc/group',
    '--ro-bind', '/etc/hosts', '/etc/hosts',
    '--dir', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--dir', '/tmp/factory-test-home', '--bind', cwd, cwd,
  ];
  for (const name of PROTECTED_DIRECTORIES) options.push('--ro-bind', `${cwd}/${name}`, `${cwd}/${name}`);
  if (env.PLAYWRIGHT_BROWSERS_PATH) {
    await canonicalDirectory('/opt/pw-browsers');
    options.push('--ro-bind', '/opt/pw-browsers', '/opt/pw-browsers');
  }
  for (const [name, value] of Object.entries({
    PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: '/tmp/factory-test-home',
    NODE_ENV: 'test', TMPDIR: '/tmp',
    ...(env.NODE_OPTIONS ? { NODE_OPTIONS: env.NODE_OPTIONS } : {}),
    ...(env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: env.PLAYWRIGHT_BROWSERS_PATH } : {}),
  })) options.push('--setenv', name, value);
  options.push('--chdir', cwd, '--', binary, ...args);
  return options;
}
