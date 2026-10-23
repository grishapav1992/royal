import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
let selectedBinary;
async function binary() {
  if (process.env.ROYAL_GIT_BINARY) return process.env.ROYAL_GIT_BINARY;
  if (!selectedBinary) selectedBinary = (async () => {
    const name = process.platform === 'win32' ? 'git.exe' : 'git';
    const candidates = new Set(['git', ...(process.env.PATH || '').split(delimiter).filter(Boolean).map(path => join(path, name))]);
    for (const candidate of candidates) {
      try { await execute(candidate, ['--version']); return candidate; }
      catch { /* Try another installed Git when a system shim is unavailable. */ }
    }
    throw Error('No working Git executable found. Install Git or set ROYAL_GIT_BINARY.');
  })();
  return selectedBinary;
}
export async function git(root, args) {
  const { stdout } = await execute(await binary(), args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
const counts = async (root, ref) => (await git(root, ['rev-list', '--left-right', '--count', 'HEAD...' + ref])).split(/\s+/).map(Number);
async function hasRef(root, ref) {
  try { await git(root, ['show-ref', '--verify', '--quiet', ref]); return true; }
  catch (error) { if (error.code === 1) return false; throw error; }
}
async function merge(root, ref, fastForward) {
  const [ahead, behind] = await counts(root, ref);
  if (!behind) return;
  try {
    await git(root, ['-c', 'merge.autoStash=false', 'merge', ...(fastForward || !ahead ? ['--ff-only'] : ['--no-edit']), ref]);
  } catch (error) {
    throw Error(`Could not reconcile ${ref}. Resolve the reported Git conflict or divergence, then rerun work:sync. Local work was preserved.\n${error.stderr || error.stdout || error.message}`);
  }
}

export async function syncWork(root, { newFeature = null, log = console.log } = {}) {
  if (newFeature !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newFeature)) throw Error('Use a lowercase feature name, for example chat-recovery.');
  log(await git(root, ['status', '--short', '--branch']));
  try { await git(root, ['fetch', 'origin']); }
  catch { throw Error('GitHub fetch failed. Freshness could not be verified; working files were not updated.'); }
  const before = await counts(root, 'origin/main');
  log(`HEAD...origin/main: ${before[0]} ahead, ${before[1]} behind`);
  if (await git(root, ['status', '--porcelain', '--untracked-files=normal'])) {
    throw Error('Uncommitted files found. Preserve this work and use a clean isolated worktree for a new task; work:sync will not stash or overwrite it.');
  }
  let branch;
  try { branch = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']); }
  catch { throw Error('Choose a named branch before synchronization; detached source snapshots are left unchanged.'); }
  if (newFeature && branch !== 'main') throw Error('Start a new feature from a clean main checkout or an isolated worktree based on origin/main. Save the current feature branch first.');
  if (branch === 'main') {
    if (before[0]) throw Error('Local main has unpublished commits. Preserve and reconcile them before starting another feature.');
    await merge(root, 'origin/main', true);
  } else {
    const remote = 'refs/remotes/origin/' + branch;
    if (await hasRef(root, remote)) await merge(root, remote, false);
    await merge(root, 'origin/main', false);
  }
  if (newFeature) {
    branch = 'feature/' + newFeature;
    await git(root, ['switch', '--no-track', '-c', branch, 'origin/main']);
  }
  const [ahead, behind] = await counts(root, 'origin/main');
  if (behind) throw Error('Synchronization did not include the fetched main.');
  return { synced: true, branch, commit: await git(root, ['rev-parse', 'HEAD']),
    mainCommit: await git(root, ['rev-parse', 'origin/main']), localFeatureCommits: ahead };
}

async function main() {
  const args = process.argv.slice(2);
  let newFeature = null;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--new') throw Error('Use work:sync or work:start -- <feature-name>.');
    newFeature = args[1];
  }
  console.log(JSON.stringify(await syncWork(process.cwd(), { newFeature }), null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
