import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 8192;
const PREPARATION_MS = Object.freeze({ analyst: 5 * 60000, developer: 5 * 60000, tester: 20 * 60000 });
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value);

function invalid() { throw new TypeError('Session progress could not be verified'); }
function stamp(value) { const time = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : null; }

// Never retain or return conversation text, tool arguments, outputs, or item IDs.
export function parseSessionProgress(source, { threadId, workspace, startedAt, model, effort, role, now = Date.now() }) {
  const start = stamp(startedAt);
  if (!UUID.test(threadId || '') || !workspace?.startsWith('/') || resolve(workspace) !== workspace
    || !Object.hasOwn(PREPARATION_MS, role) || start === null || !Number.isFinite(now) || start > now || typeof model !== 'string' || typeof effort !== 'string'
    || typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) invalid();
  let sessionStart = null, context = false, lastActivity = null, activityKind = null;
  const calls = new Set(), returned = new Set();
  for (const line of source.split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    if (event.type === 'session_meta') {
      if (sessionStart !== null || event.payload?.id !== threadId || event.payload?.cwd !== workspace) invalid();
      sessionStart = stamp(event.payload?.timestamp ?? event.timestamp);
      if (sessionStart === null || sessionStart > now || sessionStart < start
        || sessionStart - start > PREPARATION_MS[role] + 30000) invalid();
      continue;
    }
    if (sessionStart === null) continue;
    if (event.type === 'turn_context') {
      const actualEffort = event.payload?.effort ?? event.payload?.reasoning_effort
        ?? event.payload?.collaboration_mode?.settings?.reasoning_effort;
      if (event.payload?.cwd !== workspace || event.payload?.model !== model || actualEffort !== effort) invalid();
      context = true; continue;
    }
    if (!context) continue;
    const time = stamp(event.timestamp);
    if (time === null || time < start || time < sessionStart || time > now) continue;
    const payload = event.payload;
    let kind = null;
    if (event.type === 'response_item') {
      if (['function_call', 'custom_tool_call'].includes(payload?.type)) {
        if (!identifier(payload.call_id)) continue;
        if (!calls.has(payload.call_id) && calls.size >= MAX_ITEMS) invalid();
        calls.add(payload.call_id); kind = 'tool_running';
      } else if (['function_call_output', 'custom_tool_call_output'].includes(payload?.type)) {
        if (!identifier(payload.call_id)) continue;
        if (!returned.has(payload.call_id) && returned.size >= MAX_ITEMS) invalid();
        returned.add(payload.call_id); kind = 'tool_completed';
      } else if (payload?.type === 'reasoning') kind = 'thinking';
      else if (payload?.type === 'message' && payload.role === 'assistant') kind = 'responding';
    } else if (event.type === 'event_msg') {
      if (['agent_reasoning', 'reasoning'].includes(payload?.type)) kind = 'thinking';
      if (payload?.type === 'agent_message') kind = 'responding';
    }
    if (kind && (lastActivity === null || time >= lastActivity)) { lastActivity = time; activityKind = kind; }
  }
  if (sessionStart === null || !context) invalid();
  return { model_started_at: new Date(sessionStart).toISOString(),
    last_activity_at: lastActivity === null ? null : new Date(lastActivity).toISOString(),
    activity_kind: activityKind, tool_calls: calls.size,
    tool_completed: [...returned].filter(id => calls.has(id)).length };
}

export async function readSessionProgress({ codexHome, ...options }) {
  const start = stamp(options.startedAt);
  if (!UUID.test(options.threadId || '') || !Object.hasOwn(PREPARATION_MS, options.role) || start === null || typeof codexHome !== 'string'
    || !codexHome.startsWith('/') || resolve(codexHome) !== codexHome) invalid();
  const paths = [];
  const dates = [...new Set([-1, 0, 1].map(offset => new Date(start + offset * 86400000).toISOString().slice(0, 10).replaceAll('-', '/')))];
  for (const date of dates) {
    const directory = join(codexHome, 'sessions', date);
    let info;
    try { info = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) invalid();
    const names = await readdir(directory);
    if (names.length > 4096) invalid();
    const suffix = `-${options.threadId.toLowerCase()}.jsonl`;
    for (const name of names) if (/^rollout-[a-zA-Z0-9T:._-]+\.jsonl$/.test(name) && name.toLowerCase().endsWith(suffix)) paths.push(join(directory, name));
  }
  if (paths.length !== 1) invalid();
  const handle = await open(paths[0], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES) invalid();
    const buffer = Buffer.alloc(info.size);
    let read = 0;
    while (read < buffer.length) {
      const result = await handle.read(buffer, read, buffer.length - read, read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    return parseSessionProgress(buffer.toString('utf8', 0, read), options);
  } finally { await handle.close(); }
}
