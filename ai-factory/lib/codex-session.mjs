import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

// Read only bounded session headers. Conversation content and credentials never leave this helper.
export async function observeCodexSession({ codexHome, threadId, workspace, startedAt = Date.now() }) {
  const unavailable = { actual_model: null, actual_effort: null, observation_status: 'unavailable' };
  if (!THREAD_ID.test(threadId || '') || typeof codexHome !== 'string' || !codexHome.startsWith('/')) return unavailable;
  const dates = [-1, 0, 1].map(offset => new Date(startedAt + offset * 86400000).toISOString().slice(0, 10).replaceAll('-', '/'));
  for (const date of dates) {
    const directory = join(codexHome, 'sessions', date);
    try {
      if (await realpath(directory) !== resolve(directory) || !(await lstat(directory)).isDirectory()) continue;
      const names = await readdir(directory);
      if (names.length > 4096) continue;
      const candidates = names.filter(name => /^rollout-[a-zA-Z0-9T:._-]+\.jsonl$/.test(name)
        && name.toLowerCase().endsWith(`-${threadId.toLowerCase()}.jsonl`));
      if (candidates.length !== 1) continue;
      const path = join(directory, candidates[0]);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1) continue;
        const buffer = Buffer.alloc(64 * 1024);
        let pending = '', bytes = 0, sessionMatches = false;
        while (bytes < 8 * 1024 * 1024) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytes);
          if (!bytesRead) break;
          bytes += bytesRead;
          pending += buffer.toString('utf8', 0, bytesRead);
          let boundary;
          while ((boundary = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
            let event;
            try { event = JSON.parse(line); } catch { continue; }
            if (event?.type === 'session_meta') sessionMatches = event.payload?.id === threadId;
            if (event?.type !== 'turn_context') continue;
            if (!sessionMatches || event.payload?.cwd !== resolve(workspace)) return unavailable;
            const model = event.payload?.model;
            const effort = event.payload?.effort ?? event.payload?.reasoning_effort
              ?? event.payload?.collaboration_mode?.settings?.reasoning_effort;
            if (typeof model !== 'string' || !MODEL_ID.test(model)) return unavailable;
            return { actual_model: model, actual_effort: EFFORTS.has(effort) ? effort : null, observation_status: 'observed' };
          }
        }
      } finally { await handle.close(); }
    } catch { /* Missing or unsupported metadata is explicitly reported as unknown. */ }
  }
  return unavailable;
}
