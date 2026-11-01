import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [commit, envPath] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(commit || '') || !envPath) {
  throw new Error('Usage: node deployment/a6api/install.mjs <full-source-commit> <local-env-path>');
}
const git = (args, options = {}) => execFileSync(process.env.ROYAL_GIT || 'git', args, options);
git(['fetch', 'origin'], { stdio: 'inherit' });
git(['merge-base', '--is-ancestor', commit, 'origin/main']);
const source = git(['show', `${commit}:deployment/a6api/request.py`]);
const installer = git(['show', `${commit}:deployment/a6api/install.py`], { encoding: 'utf8' });
const match = readFileSync(envPath, 'utf8').match(/^\s*(?:export\s+)?A6API_KEY\s*=\s*(.*?)\s*$/m);
if (!match) throw new Error('A6API_KEY missing from supplied local environment file');
const key = match[1].replace(/^["']|["']$/g, '');
const payload = { commit, sha256: createHash('sha256').update(source).digest('hex'), source: source.toString('base64'), key };
const shellQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const child = spawn('ssh', ['-T', '-i', join(homedir(), '.ssh', 'royal_server_ed25519'),
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
  'root@45.192.12.242', 'python3 -c ' + shellQuote(installer)], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.on('error', () => {});
child.stdin.end(JSON.stringify(payload));
child.once('error', () => { console.error('Cannot start SSH installer'); process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
