import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLE_CATALOG } from './roles.mjs';

const SKILLS_ROOT = resolve(fileURLToPath(new URL('../role-skills/', import.meta.url)));
const MAX_SKILL_BYTES = 16 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

function invalid(detail) {
  return new TypeError(`Invalid trusted role skill: ${detail}`);
}

async function readSkill(root, id) {
  const directory = join(root, id);
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || await realpath(directory) !== directory) {
    throw invalid('skill directory must be a canonical directory');
  }
  const path = join(directory, 'SKILL.md');
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw invalid('SKILL.md must be a regular file without additional links');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.ino !== before.ino || info.dev !== before.dev
      || info.size <= 0 || info.size > MAX_SKILL_BYTES) {
      throw invalid('SKILL.md is replaced, empty, linked, or too large');
    }
    const currentDirectory = await lstat(directory);
    if (!currentDirectory.isDirectory() || currentDirectory.isSymbolicLink()
      || currentDirectory.ino !== directoryInfo.ino || currentDirectory.dev !== directoryInfo.dev
      || await realpath(directory) !== directory) {
      throw invalid('skill directory changed before reading');
    }
    const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const content = buffer.subarray(0, length);
    const after = await handle.stat();
    if (content.length > MAX_SKILL_BYTES || content.length !== info.size || info.size !== after.size || info.mtimeMs !== after.mtimeMs
      || info.ctimeMs !== after.ctimeMs) {
      throw invalid('SKILL.md changed while reading');
    }
    const text = decoder.decode(content);
    // Shipped skills use this deliberately small frontmatter contract.
    const match = text.match(/^---\nname: ([a-z0-9-]{1,63})\ndescription: ([^\n]+)\nmetadata:\n  version: "([0-9]+\.[0-9]+\.[0-9]+)"\n---\n([\s\S]+)$/);
    if (!match || match[1] !== id || !match[2].trim() || match[2].length > 1024 || !match[4].trim()
      || /[\0\u2014]/.test(text)) {
      throw invalid('SKILL.md metadata or instructions are invalid');
    }
    return {
      instructions: `## ${id} (version ${match[3]})\n\n${match[4].trim()}`,
      metadata: { id, sha256: createHash('sha256').update(content).digest('hex'), version: match[3] },
    };
  } finally {
    await handle.close();
  }
}

export async function loadRoleSkills(role, ids) {
  const catalogRole = ROLE_CATALOG.roles.find(item => item.id === role);
  if (!catalogRole) throw invalid('unknown role');
  if (!Array.isArray(ids) || ids.length > catalogRole.skills.length || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !catalogRole.skills.includes(id))) {
    throw invalid('IDs must be unique catalog skills belonging to this role');
  }
  if (ids.length === 0) return { instructions: '', skills: [] };
  const rootInfo = await lstat(SKILLS_ROOT);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw invalid('skill root must be a regular directory');
  const root = await realpath(SKILLS_ROOT);
  const loaded = await Promise.all(ids.map(id => readSkill(root, id)));
  return { instructions: loaded.map(skill => skill.instructions).join('\n\n'), skills: loaded.map(skill => skill.metadata) };
}
