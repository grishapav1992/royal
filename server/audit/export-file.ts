import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const errno = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** The same-directory link is the commit point. A racing file or symlink wins. */
export async function writeAuditOutput<T extends object>(
  path: string, checkActive: () => void, write: (file: FileHandle) => Promise<T>, onExists?: () => Error,
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
    checkActive();
    await link(temporary, destination).catch(error => {
      if (errno(error) === 'EEXIST' && onExists) throw onExists();
      throw error;
    });
    published = true;
    try { await unlink(temporary); }
    catch (error) { if (errno(error) !== 'ENOENT') return { ...result, cleanupPending: temporary }; }
    return result;
  } finally {
    try { await file?.close(); }
    finally {
      if (ownsTemporary && !published) await unlink(temporary).catch(error => {
        if (errno(error) !== 'ENOENT') throw error;
      });
    }
  }
}
