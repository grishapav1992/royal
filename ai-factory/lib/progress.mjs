import { ROLE_TIMEOUT_MS } from './roles.mjs';

export const PROGRESS_PHASES = Object.freeze(['preparing', 'model', 'build', 'server_tests', 'browser_tests', 'saving']);
export const ACTIVITY_KINDS = Object.freeze(['starting', 'thinking', 'tool_running', 'tool_completed', 'responding']);
const TOOL_TYPES = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'tool_call', 'collab_tool_call', 'collaboration_tool_call']);

export function initialProgress(role, now = new Date().toISOString()) {
  return { phase: 'preparing', phase_started_at: now, updated_at: now, last_activity_at: null,
    activity_kind: null, tool_calls: 0, tool_completed: 0, model_started_at: null,
    timeout_ms: ROLE_TIMEOUT_MS[role] ?? null };
}

// Item IDs stay inside the controller. Only enumerated activity and counts leave this tracker.
export class CodexActivityTracker {
  constructor() { this.items = new Map(); }
  event(event) {
    if (['thread.started', 'turn.started'].includes(event.type)) return { activity_kind: 'starting', tool_calls_delta: 0, tool_completed_delta: 0 };
    if (!['item.started', 'item.updated', 'item.completed'].includes(event.type)) return null;
    const type = event.item?.type;
    if (type === 'reasoning') return { activity_kind: 'thinking', tool_calls_delta: 0, tool_completed_delta: 0 };
    if (type === 'agent_message') return { activity_kind: 'responding', tool_calls_delta: 0, tool_completed_delta: 0 };
    if (!TOOL_TYPES.has(type)) return null;
    let started = 0, completed = 0;
    const key = event.item?.id;
    const terminal = event.type === 'item.completed';
    if (typeof key === 'string' && key.length > 0 && key.length <= 256 && !/[\r\n\0]/.test(key)) {
      const previous = this.items.get(key) ?? 0;
      if (previous || this.items.size < 8192) {
        if (!(previous & 1)) started = 1;
        if (terminal && !(previous & 2)) completed = 1;
        this.items.set(key, previous | 1 | (terminal ? 2 : 0));
      }
    }
    return { activity_kind: terminal ? 'tool_completed' : 'tool_running', tool_calls_delta: started, tool_completed_delta: completed };
  }
}

// At most one pending snapshot and one in-flight write. Flush waits for the latest state.
export class RunProgress {
  constructor({ role, initial, write, now = () => Date.now(), intervalMs = 2000, onError = () => {} }) {
    this.now = now; this.write = write; this.intervalMs = intervalMs; this.onError = onError;
    this.state = initial ? { ...initial } : initialProgress(role, new Date(now()).toISOString());
    this.pending = false; this.writing = null; this.timer = null; this.lastWriteAt = -Infinity; this.closed = false; this.error = null;
  }
  phase(phase) {
    if (!PROGRESS_PHASES.includes(phase)) throw new TypeError('Unknown progress phase');
    if (this.closed) return;
    const stamp = new Date(this.now()).toISOString();
    if (this.state.phase !== phase) {
      this.state.phase = phase; this.state.phase_started_at = stamp;
      if (phase === 'model' && !this.state.model_started_at) this.state.model_started_at = stamp;
    }
    this.state.updated_at = stamp; this.pending = true;
    this.schedule();
  }
  activity(value) {
    if (this.closed || this.state.phase !== 'model' || !value || !ACTIVITY_KINDS.includes(value.activity_kind)) return;
    if (![value.tool_calls_delta, value.tool_completed_delta].every(count => Number.isSafeInteger(count) && count >= 0 && count <= 1)) return;
    const stamp = new Date(this.now()).toISOString();
    this.state.last_activity_at = stamp; this.state.updated_at = stamp; this.state.activity_kind = value.activity_kind;
    this.state.tool_calls += value.tool_calls_delta; this.state.tool_completed += value.tool_completed_delta;
    this.pending = true; this.schedule();
  }
  schedule() {
    if (this.timer || this.writing || this.closed || !this.pending) return;
    const wait = Math.max(0, this.lastWriteAt + this.intervalMs - this.now());
    this.timer = setTimeout(() => { this.timer = null; void this.drain(false); }, wait);
    this.timer.unref?.();
  }
  async drain(force) {
    while (this.writing) { await this.writing.catch(() => {}); if (!force) return; }
    while (this.pending && !this.closed) {
      if (!force && this.now() < this.lastWriteAt + this.intervalMs) { this.schedule(); return; }
      const snapshot = { ...this.state }; this.pending = false; this.lastWriteAt = this.now();
      this.writing = Promise.resolve().then(() => this.write(snapshot));
      try { await this.writing; }
      catch (error) { this.error = error; this.closed = true; this.pending = false; try { this.onError(error); } catch {} }
      finally { this.writing = null; }
      if (!force) { this.schedule(); return; }
    }
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    await this.drain(true);
    if (this.error) throw this.error;
  }
  async close() {
    try { await this.flush(); }
    finally { this.closed = true; clearTimeout(this.timer); this.timer = null; }
  }
}
