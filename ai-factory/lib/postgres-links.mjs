import { lstat, readlink, realpath, symlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const LINKS = Object.freeze([
  ['libpq.so.5', 'libpq.so.5.17'],
  ['libicuuc.so.60', 'libicuuc.so.60.2'],
  ['libicui18n.so.60', 'libicui18n.so.60.2'],
  ['libicudata.so.60', 'libicudata.so.60.2'],
]);

function unsafe(message) {
  return Object.assign(new Error(message), { code: 'POSTGRES_LINKS_UNSAFE' });
}

function inside(root, path) {
  const child = relative(root, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith('../'));
}

async function metadata(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function directories(workspace) {
  let current = workspace;
  let packageRoot;
  const parts = ['node_modules', '@embedded-postgres', 'linux-x64', 'native', 'lib'];
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    const info = await metadata(current);
    if (!info && index < 3) return null;
    if (!info) throw Object.assign(new Error('Embedded PostgreSQL native libraries are missing.'), { code: 'POSTGRES_LINKS_MISSING' });
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafe('Embedded PostgreSQL parent paths must be real directories.');
    const canonical = await realpath(current);
    if (canonical !== current || !inside(workspace, canonical) || (packageRoot && !inside(packageRoot, canonical))) {
      throw unsafe('Embedded PostgreSQL directories must remain inside the workspace and package.');
    }
    if (index === 2) packageRoot = canonical;
  }
  return { packageRoot, lib: current };
}

async function checkSource(workspace, packageRoot, lib, name) {
  const path = join(lib, name);
  const info = await metadata(path);
  if (!info) throw Object.assign(new Error(`Embedded PostgreSQL library ${name} is missing.`), { code: 'POSTGRES_LINKS_MISSING' });
  if (info.isSymbolicLink() || !info.isFile()) throw unsafe('Embedded PostgreSQL source libraries must be regular files.');
  const canonical = await realpath(path);
  if (canonical !== path || !inside(workspace, canonical) || !inside(packageRoot, canonical) || !inside(lib, canonical)) {
    throw unsafe('Embedded PostgreSQL source libraries must remain inside the package.');
  }
}

async function existingLink(path, expected) {
  const info = await metadata(path);
  if (!info) return false;
  if (!info.isSymbolicLink() || await readlink(path) !== expected) {
    throw unsafe('An existing PostgreSQL library link does not match the fixed target.');
  }
  return true;
}

export async function hydratePostgresLinks(workspace, { variant = process.platform === 'linux' && process.arch === 'x64' ? 'linux-x64' : null } = {}) {
  if (variant === null) return { skipped: true, reason: 'unsupported_platform', created: [], existing: [] };
  if (variant !== 'linux-x64') throw unsafe('Only the Linux x64 PostgreSQL package is supported.');
  if (typeof workspace !== 'string' || !workspace || workspace.includes('\0')) throw new TypeError('A workspace path is required.');
  const requested = resolve(workspace);
  const rootInfo = await metadata(requested);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw unsafe('The workspace must be a real directory.');
  const root = await realpath(requested);
  const layout = await directories(root);
  if (!layout) return { skipped: true, reason: 'missing_package', created: [], existing: [] };

  const present = new Set();
  for (const [name, target] of LINKS) {
    await checkSource(root, layout.packageRoot, layout.lib, target);
    if (await existingLink(join(layout.lib, name), target)) present.add(name);
  }

  const created = [];
  const existing = [];
  for (const [name, target] of LINKS) {
    const current = await directories(root);
    if (!current || current.lib !== layout.lib) throw unsafe('The PostgreSQL package changed during link hydration.');
    await checkSource(root, layout.packageRoot, layout.lib, target);
    if (present.has(name)) {
      if (!await existingLink(join(layout.lib, name), target)) throw unsafe('The PostgreSQL library link changed during hydration.');
      existing.push(name);
      continue;
    }
    try {
      await symlink(target, join(layout.lib, name));
      created.push(name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!await existingLink(join(layout.lib, name), target)) throw unsafe('The PostgreSQL library link changed during hydration.');
      existing.push(name);
    }
  }
  return { skipped: false, created, existing, libraryPath: layout.lib };
}

export default hydratePostgresLinks;
