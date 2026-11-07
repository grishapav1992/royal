import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const errno = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** The wrapper authorizes and awaits one invocation of the commit callback. */
export type AuditOutputPublisher = (linkOutput: () => Promise<void>) => Promise<void>;

/** The same-directory link is the commit point. A racing file or symlink wins. */
export async function writeAuditOutput<T extends object>(
  path: string, checkActive: () => void, write: (file: FileHandle) => Promise<T>, onExists?: () => Error,
  publish?: AuditOutputPublisher,
): Promise<T & { cleanupPending?: string }> {
  const destination = resolve(path);
  const temporary = join(dirname(destination), '.royal-audit-' + randomUUID() + '.part');
  let file: FileHandle | undefined;
  let ownsTemporary = false, published = false;
  try {
    checkActive();
    await lstat(destination).then(() => {
      throw onExists?.() ?? Object.assign(new Error('Audit output already exists'), { code: 'EEXIST' });
    }, error => { if (errno(error) !== 'ENOENT') throw error; });
    checkActive();
    file = await open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    const result = await write(file);
    await file.sync();
    await file.close();
    file = undefined;
    const linkOutput = async () => {
      checkActive();
      await link(temporary, destination).catch(error => {
        if (errno(error) === 'EEXIST' && onExists) throw onExists();
        throw error;
      });
      published = true;
    };
    let cleanupPending: string | undefined;
    checkActive();
    try {
      await (publish ? publish(linkOutput) : linkOutput());
      if (!published) throw new Error('Audit output publication skipped its commit callback');
    } finally {
      if (published) {
        try { await unlink(temporary); }
        catch (error) { if (errno(error) !== 'ENOENT') cleanupPending = temporary; }
      }
    }
    return cleanupPending ? { ...result, cleanupPending } : result;
  } finally {
    try { await file?.close(); }
    finally {
      if (ownsTemporary && !published) await unlink(temporary).catch(error => {
        if (errno(error) !== 'ENOENT') throw error;
      });
    }
  }
}
