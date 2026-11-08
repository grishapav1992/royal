import {
  CHAT_CONFIRMATION_TIMEOUT_MS, CHAT_PENDING_LIMIT, CHAT_V2_RESUME_LIMIT, chatMessageIdTimestamp, chatV2FirstAdmissionAge, createChatMessageId,
  parseChatV2Result, parseChatV2Send, type ChatV2Ready, type ChatV2Result, type ChatV2ResumeRequest,
  type ChatV2ResumeResult, type ChatV2Send, type ChatV2Visit,
} from '../shared/chat';

type DraftResult = Extract<ChatV2Result, { status: 'rejected' | 'cancelled' | 'expired' | 'id_conflict' }>;
type SavedChat = {
  accountId: string; envelope: ChatV2Send; accepted?: true; retryNotBeforeMs?: number; result?: DraftResult;
};
type ChatStore = {
  list(accountId: string): Promise<SavedChat[]>;
  add(record: SavedChat): Promise<void>;
  update(accountId: string, messageId: string, patch: Pick<SavedChat, 'accepted' | 'retryNotBeforeMs' | 'result'>): Promise<void>;
  remove(accountId: string, messageId: string): Promise<void>;
};
type PendingStatus = 'sending' | 'accepted' | 'uncertain';
type RuntimeChat = {
  saved: SavedChat; status: PendingStatus; action: 'resume' | 'send'; at: number; attempts: number; confirmAt?: number;
};
export type ChatOutboxEntry = { envelope: ChatV2Send; time: number; status: PendingStatus; result?: DraftResult };

const DATABASE = 'royal-chat-outbox';
const OUTBOX = 'outbox';
const ACCOUNT_DRAFT_LIMIT = 50;
const RECOVERY_INTERVAL_MS = 1_000;

class IndexedChatStore implements ChatStore {
  private opening?: Promise<IDBDatabase>;

  private open() {
    if (this.opening) return this.opening;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(OUTBOX, { keyPath: ['accountId', 'envelope.messageId'] });
        store.createIndex('accountId', 'accountId');
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('Chat outbox database is blocked')); };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        const forgetConnection = () => { if (this.opening === opening) this.opening = undefined; };
        db.onclose = forgetConnection;
        db.onversionchange = () => { db.close(); forgetConnection(); };
        resolve(db);
      };
    });
    this.opening = opening;
    void opening.catch(() => { if (this.opening === opening) this.opening = undefined; });
    return opening;
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(OUTBOX, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('Chat outbox transaction aborted'));
      run(tx.objectStore(OUTBOX), result => { value = result; });
    });
  }

  list(accountId: string) {
    return this.transaction<SavedChat[]>('readonly', (store, result) => {
      const request = store.index('accountId').getAll(accountId, ACCOUNT_DRAFT_LIMIT);
      request.onsuccess = () => result(request.result);
    });
  }

  add(record: SavedChat) {
    return this.transaction<void>('readwrite', store => {
      // Counting and inserting in one transaction applies the same bound across tabs.
      const count = store.index('accountId').count(record.accountId);
      count.onsuccess = () => {
        if (count.result >= ACCOUNT_DRAFT_LIMIT) store.transaction.abort();
        else store.add(record);
      };
    });
  }

  update(accountId: string, messageId: string, patch: Pick<SavedChat, 'accepted' | 'retryNotBeforeMs' | 'result'>) {
    return this.transaction<void>('readwrite', store => {
      const request = store.get([accountId, messageId]);
      request.onsuccess = () => {
        const record = request.result as SavedChat | undefined;
        if (!record || record.result) return;
        if (patch.accepted) record.accepted = true;
        if (patch.retryNotBeforeMs) record.retryNotBeforeMs = Math.max(record.retryNotBeforeMs ?? 0, patch.retryNotBeforeMs);
        if (patch.result) record.result = patch.result;
        store.put(record);
      };
    });
  }

  remove(accountId: string, messageId: string) {
    return this.transaction<void>('readwrite', store => { store.delete([accountId, messageId]); });
  }
}

export class ChatOutbox {
  private accountId?: string;
  private accountGeneration = 0;
  private connection?: { serverTimeMs: number; at: number };
  private visit?: ChatV2Visit | null;
  private readonly rows = new Map<string, RuntimeChat>();
  private loaded = false;
  private loading = false;
  private loadRetry?: ReturnType<typeof setTimeout>;
  private loadRetryDelay = RECOVERY_INTERVAL_MS;
  private saving = false;
  private blocked = false;
  private nextResumeAt = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private transport: {
    send: (accountId: string, envelope: ChatV2Send) => boolean;
    resume: (accountId: string, request: ChatV2ResumeRequest) => boolean;
    changed: () => void;
  }, private store: ChatStore = new IndexedChatStore()) {}

  selectAccount(accountId?: string) {
    if (this.accountId === accountId) return;
    this.accountId = accountId;
    this.accountGeneration++;
    this.connection = undefined;
    this.visit = undefined;
    this.rows.clear();
    this.loaded = false;
    this.loading = false;
    clearTimeout(this.loadRetry);
    this.loadRetryDelay = RECOVERY_INTERVAL_MS;
    this.saving = false;
    this.nextResumeAt = 0;
    this.changed();
  }

  connect(accountId: string, ready: ChatV2Ready) {
    if (accountId !== this.accountId) return;
    this.connection = { serverTimeMs: ready.serverTimeMs, at: performance.now() };
    this.visit = undefined;
    this.queueRecovery();
    void this.load(accountId);
    this.changed();
  }

  disconnect() {
    if (!this.connection) return;
    this.connection = undefined;
    this.visit = undefined;
    clearTimeout(this.loadRetry);
    this.queueRecovery();
    this.changed();
  }

  setVisit(visit: ChatV2Visit | null) {
    this.visit = visit;
    for (const row of this.rows.values()) {
      if (!row.saved.result && !this.inVisit(row.saved.envelope)) row.status = 'uncertain';
    }
    this.changed();
  }

  setBlocked(blocked: boolean) {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.schedule();
  }

  get entries(): ChatOutboxEntry[] {
    return [...this.rows.values()].map(({ saved, status }) => ({
      envelope: saved.envelope, time: chatMessageIdTimestamp(saved.envelope.messageId)!, status, result: saved.result,
    }));
  }

  get canSend(): boolean {
    return Boolean(this.accountId && this.connection && this.visit && !this.blocked && !this.loading && !this.saving)
      && this.pendingCount < CHAT_PENDING_LIMIT;
  }

  get pendingCount() { return this.pendingInVisit().length; }

  hasPending(text: string) { return this.pendingInVisit().some(row => row.saved.envelope.text === text); }

  async submit(text: string): Promise<'saved' | 'unavailable' | 'storage_failed'> {
    const { accountId, visit } = this;
    if (!accountId || !visit || !this.canSend) return 'unavailable';
    const generation = this.accountGeneration;
    if (!this.loaded) {
      await this.load(accountId);
      if (generation !== this.accountGeneration || visit !== this.visit || !this.canSend) return 'unavailable';
      if (!this.loaded) return 'storage_failed';
    }
    const parsed = parseChatV2Send({ messageId: createChatMessageId(this.serverNow()), text, roomEpoch: visit.roomEpoch, visitId: visit.visitId });
    if (!parsed.ok || this.hasPending(parsed.value.text)) return 'unavailable';
    const saved: SavedChat = { accountId, envelope: parsed.value };
    this.saving = true;
    this.changed();
    try { await this.store.add(saved); }
    catch { return 'storage_failed'; }
    finally {
      if (generation === this.accountGeneration) { this.saving = false; this.changed(); }
    }
    if (accountId !== this.accountId) return 'saved';

    const row = this.restore(saved);
    this.rows.set(saved.envelope.messageId, row);
    if (generation === this.accountGeneration && this.connection && !this.blocked && this.inVisit(saved.envelope)
      && chatV2FirstAdmissionAge(saved.envelope.messageId, this.serverNow()) === 'valid') {
      row.status = 'sending';
      this.transmit(row);
    }
    this.changed();
    return 'saved';
  }

  receive(accountId: string, result: ChatV2ResumeResult | ChatV2Result) {
    if (accountId !== this.accountId || !this.connection) return;
    const row = this.rows.get(result.messageId);
    if (!row || row.saved.result) return;
    const now = performance.now();
    switch (result.status) {
      case 'published':
        this.rows.delete(result.messageId);
        void this.store.remove(accountId, result.messageId).catch(() => {});
        break;
      case 'accepted':
        if (!row.saved.accepted) {
          row.saved.accepted = true;
          void this.store.update(accountId, result.messageId, { accepted: true }).catch(() => {});
        }
        if (row.status === 'sending') row.status = 'accepted';
        row.action = 'resume';
        row.at = row.confirmAt ?? now + this.backoff(row);
        break;
      case 'retry_later': {
        const retryNotBeforeMs = Math.max(row.saved.retryNotBeforeMs ?? 0, this.serverNow() + result.retryAfterMs);
        row.saved.retryNotBeforeMs = retryNotBeforeMs;
        void this.store.update(accountId, result.messageId, { retryNotBeforeMs }).catch(() => {});
        row.action = 'resume';
        row.at = now + this.backoff(row);
        break;
      }
      case 'not_found':
        row.status = 'uncertain';
        row.action = row.saved.accepted ? 'resume' : 'send';
        row.at = now + this.backoff(row);
        break;
      default:
        row.saved.result = result;
        void this.store.update(accountId, result.messageId, { result }).catch(() => {});
    }
    this.changed();
  }

  async dismiss(messageId: string): Promise<boolean> {
    const { accountId, accountGeneration } = this;
    if (!accountId || !this.rows.has(messageId)) return false;
    try { await this.store.remove(accountId, messageId); } catch { return false; }
    if (accountGeneration === this.accountGeneration) { this.rows.delete(messageId); this.changed(); }
    return true;
  }

  private async load(accountId: string) {
    if (accountId !== this.accountId || !this.connection || this.loaded || this.loading) return;
    const generation = this.accountGeneration;
    clearTimeout(this.loadRetry);
    this.loading = true;
    this.changed();
    try {
      for (const saved of await this.store.list(accountId)) {
        if (generation !== this.accountGeneration) return;
        if (!saved || saved.accountId !== accountId) continue;
        const parsed = parseChatV2Send(saved.envelope);
        if (!parsed.ok || this.rows.has(parsed.value.messageId)) continue;
        const result = parseChatV2Result(saved.result);
        const terminal = result?.messageId === parsed.value.messageId
          && (result.status === 'rejected' || result.status === 'cancelled' || result.status === 'expired' || result.status === 'id_conflict') ? result : undefined;
        this.rows.set(parsed.value.messageId, this.restore({ ...saved, envelope: parsed.value, result: terminal }));
      }
      if (generation === this.accountGeneration) {
        this.loaded = true;
        this.loadRetryDelay = RECOVERY_INTERVAL_MS;
      }
    } catch {
      if (generation === this.accountGeneration && this.connection) {
        this.loadRetry = setTimeout(() => void this.load(accountId), this.loadRetryDelay);
        this.loadRetryDelay = Math.min(30_000, this.loadRetryDelay * 2);
      }
    }
    finally {
      if (generation === this.accountGeneration) { this.loading = false; this.changed(); }
    }
  }

  private restore(saved: SavedChat): RuntimeChat {
    return { saved, status: 'uncertain', action: 'resume', at: performance.now(), attempts: 0 };
  }

  private pendingInVisit() {
    return [...this.rows.values()].filter(row => !row.saved.result && this.inVisit(row.saved.envelope));
  }

  private inVisit(envelope: ChatV2Send) {
    return this.visit?.roomEpoch === envelope.roomEpoch && this.visit.visitId === envelope.visitId;
  }

  private serverNow() {
    const { serverTimeMs, at } = this.connection!;
    return serverTimeMs + Math.max(0, Math.floor(performance.now() - at));
  }

  private queueRecovery() {
    const now = performance.now();
    for (const row of this.rows.values()) {
      if (row.saved.result) continue;
      row.status = 'uncertain'; row.action = 'resume'; row.at = now; row.confirmAt = undefined;
    }
  }

  private backoff(row: RuntimeChat) {
    return Math.min(30_000, 500 * 2 ** Math.min(row.attempts++, 6)) + Math.random() * 250;
  }

  private transmit(row: RuntimeChat) {
    row.action = 'resume';
    row.at = row.confirmAt = performance.now() + CHAT_CONFIRMATION_TIMEOUT_MS;
    try { if (this.transport.send(row.saved.accountId, row.saved.envelope)) return; } catch { /* Delivery may be ambiguous. */ }
    row.status = 'uncertain'; row.confirmAt = undefined; row.at = performance.now() + this.backoff(row);
  }

  private dueAt(row: RuntimeChat, now: number, serverNow: number) {
    const resumeAt = this.canRetransmit(row, serverNow) ? 0 : this.nextResumeAt;
    return Math.max(row.at, resumeAt, now + (row.saved.retryNotBeforeMs ?? 0) - serverNow);
  }

  private canRetransmit(row: RuntimeChat, serverNow: number) {
    return row.action === 'send' && !this.blocked && this.inVisit(row.saved.envelope)
      && chatV2FirstAdmissionAge(row.saved.envelope.messageId, serverNow) === 'valid';
  }

  private tick() {
    if (!this.accountId || !this.connection) return;
    const now = performance.now(), serverNow = this.serverNow();
    const ids: string[] = [];
    let retransmits = 0;
    for (const row of this.rows.values()) {
      if (row.saved.result || this.dueAt(row, now, serverNow) > now) continue;
      if (this.canRetransmit(row, serverNow)) {
        if (retransmits++ < CHAT_PENDING_LIMIT) this.transmit(row);
        else row.at = now + RECOVERY_INTERVAL_MS;
        continue;
      }
      if (ids.length >= CHAT_V2_RESUME_LIMIT) continue;
      row.status = 'uncertain'; row.action = 'resume'; row.confirmAt = undefined;
      row.at = now + this.backoff(row);
      ids.push(row.saved.envelope.messageId);
    }
    if (ids.length) {
      this.nextResumeAt = now + RECOVERY_INTERVAL_MS;
      try { this.transport.resume(this.accountId, { messageIds: ids }); }
      catch { /* Keep the IDs for the next status attempt. */ }
    }
    this.changed();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.connection) {
      const now = performance.now(), serverNow = this.serverNow();
      let next = Infinity;
      for (const row of this.rows.values()) if (!row.saved.result) next = Math.min(next, this.dueAt(row, now, serverNow));
      if (next < Infinity) this.timer = setTimeout(() => this.tick(), Math.max(0, next - now));
    }
  }

  private changed() {
    this.schedule();
    this.transport.changed();
  }
}
