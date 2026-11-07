export type ChatLocation = 'arcade' | 'tables' | 'github' | 'toilet';
export const ROOM_CHAT_PROTOCOL = 1;
export type ChatVisit = { id: number; hall: ChatLocation };
export type ChatRequest = { id: string; text: string; visitId?: number };
export function isChatLocation(hall: string): hall is ChatLocation {
  return hall === 'arcade' || hall === 'tables' || hall === 'github' || hall === 'toilet';
}
export type ChatResult = {
 id: string;
 status: 'queued' | 'published' | 'rejected' | 'cancelled';
 message?: string;
};

export const CHAT_PENDING_LIMIT = 3;
export const CHAT_CONFIRMATION_TIMEOUT_MS = 20000;

export const ROOM_CHAT_PROTOCOL_V2 = 2;
export const CHAT_V2_FIRST_ADMISSION_MS = 24 * 60 * 60_000;
export const CHAT_V2_FUTURE_TOLERANCE_MS = 2 * 60_000;
export const CHAT_V2_RESUME_LIMIT = 50;
export const CHAT_V2_HISTORY_LIMIT = 100;

export type ChatV2ReadyRequest = { version: typeof ROOM_CHAT_PROTOCOL_V2 };
export type ChatV2Ready = ChatV2ReadyRequest & { serverTimeMs: number };
export type ChatV2Visit = { roomEpoch: string; visitId: number; location: ChatLocation; initialCursor: number };
export type ChatV2Send = { messageId: string; text: string; roomEpoch: string; visitId: number };

const rejectedReasons = ['invalid_payload', 'invalid_text', 'message_id_in_future', 'spam', 'profanity', 'rate_limited'] as const;
const cancelledReasons = ['visit_changed', 'session_revoked', 'room_epoch_closed', 'enforcement_cancelled'] as const;
const retryReasons = ['busy', 'storage_unavailable', 'commit_unknown', 'authorization_unavailable', 'enforcement_pending'] as const;

export type ChatV2Receipt = { messageId: string } & (
  | { status: 'accepted' }
  | { status: 'published'; publicationId: string }
  | { status: 'rejected'; reasonCode: (typeof rejectedReasons)[number] }
  | { status: 'cancelled'; reasonCode: (typeof cancelledReasons)[number] }
);
export type ChatV2Result = ChatV2Receipt | ({ messageId: string } & (
  | { status: 'retry_later'; reasonCode: (typeof retryReasons)[number]; retryAfterMs: number }
  | { status: 'id_conflict'; reasonCode: 'id_conflict' }
  | { status: 'expired'; reasonCode: 'message_id_expired' }
));
export type ChatV2ResumeResult = Exclude<ChatV2Result, { status: 'id_conflict' }> | { messageId: string; status: 'not_found' };
export type ChatV2ResumeRequest = { messageIds: string[] };
export type ChatV2ResumeResponse = { results: ChatV2ResumeResult[] };

export type ChatV2HistoryRequest = { visitId: number; afterCursor: number; limit: number };
export type ChatV2Publication = {
  publicationId: string; publicationSeq: number; senderId: string; name: string; text: string; time: number;
  system?: boolean;
};
export type ChatV2Batch = {
  roomEpoch: string; visitId: number; fromCursor: number; scannedThrough: number;
  messages: ChatV2Publication[]; hasMore: boolean; reset: boolean;
};

export type ChatV2ClientPackets = {
  'chat.ready': ChatV2ReadyRequest;
  'chat.send': ChatV2Send;
  'chat.resume': ChatV2ResumeRequest;
  'chat.history': ChatV2HistoryRequest;
};
export type ChatV2ServerPackets = {
  'chat.ready': ChatV2Ready;
  'chat.visit': ChatV2Visit | null;
  'chat.result': ChatV2Result;
  'chat.resume': ChatV2ResumeResponse;
  'chat.batch': ChatV2Batch;
};

const CHAT_TEXT_LIMIT = 300;
const UUID_TIME_MAX = 2 ** 48 - 1;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function canonicalUuid(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length === 36 && UUID.test(value)) return value.toLowerCase();
}

export function canonicalChatMessageId(value: unknown): string | undefined {
  const id = canonicalUuid(value);
  return id?.[14] === '7' ? id : undefined;
}

export function createChatMessageId(serverTimeMs: number): string {
  if (!integerAtLeast(serverTimeMs, 0) || serverTimeMs > UUID_TIME_MAX) throw new RangeError('Invalid UUIDv7 timestamp');
  const timestamp = serverTimeMs.toString(16).padStart(12, '0');
  // The random UUID suffix supplies the RFC 9562 variant bits and 74 random bits.
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${crypto.randomUUID().slice(15)}`;
}

export function chatMessageIdTimestamp(value: unknown): number | undefined {
  const id = canonicalChatMessageId(value);
  if (id) return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

export function chatV2FirstAdmissionAge(messageId: string, serverTimeMs: number): 'valid' | 'expired' | 'future' | 'invalid' {
  const timestamp = chatMessageIdTimestamp(messageId);
  if (timestamp === undefined || !integerAtLeast(serverTimeMs, 0)) return 'invalid';
  if (serverTimeMs - timestamp >= CHAT_V2_FIRST_ADMISSION_MS) return 'expired';
  if (timestamp - serverTimeMs > CHAT_V2_FUTURE_TOLERANCE_MS) return 'future';
  return 'valid';
}

export function normalizeChatV2Text(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function integerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function packet(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function knownCode<T extends string>(codes: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && codes.some(code => code === value);
}

export function parseChatV2ReadyRequest(value: unknown): ChatV2ReadyRequest | undefined {
  const data = packet(value);
  if (data && exactKeys(data, ['version']) && data.version === ROOM_CHAT_PROTOCOL_V2) return { version: data.version };
}

export function parseChatV2Ready(value: unknown): ChatV2Ready | undefined {
  const data = packet(value);
  if (data?.version === ROOM_CHAT_PROTOCOL_V2 && integerAtLeast(data.serverTimeMs, 0) && data.serverTimeMs <= UUID_TIME_MAX) {
    return { version: data.version, serverTimeMs: data.serverTimeMs };
  }
}

export function parseChatV2Visit(value: unknown): ChatV2Visit | null | undefined {
  if (value === null) return null;
  const data = packet(value), roomEpoch = canonicalUuid(data?.roomEpoch);
  if (data && roomEpoch && integerAtLeast(data.visitId, 1) && integerAtLeast(data.initialCursor, 0)
    && typeof data.location === 'string' && isChatLocation(data.location)) {
    return { roomEpoch, visitId: data.visitId, location: data.location, initialCursor: data.initialCursor };
  }
}

export type ChatV2SendValidation = { ok: true; value: ChatV2Send }
  | { ok: false; reasonCode: 'invalid_payload' | 'invalid_text'; messageId?: string };

export function parseChatV2Send(value: unknown): ChatV2SendValidation {
  const data = packet(value), messageId = canonicalChatMessageId(data?.messageId);
  const roomEpoch = canonicalUuid(data?.roomEpoch);
  if (!data || !messageId || !roomEpoch || !exactKeys(data, ['messageId', 'text', 'roomEpoch', 'visitId'])
    || !integerAtLeast(data.visitId, 1) || typeof data.text !== 'string') {
    return messageId ? { ok: false, messageId, reasonCode: 'invalid_payload' } : { ok: false, reasonCode: 'invalid_payload' };
  }
  const text = normalizeChatV2Text(data.text);
  if (!text || text.length > CHAT_TEXT_LIMIT) return { ok: false, messageId, reasonCode: 'invalid_text' };
  return { ok: true, value: { messageId, text, roomEpoch, visitId: data.visitId } };
}

export function parseChatV2ResumeRequest(value: unknown): ChatV2ResumeRequest | undefined {
  const data = packet(value);
  if (!data || !exactKeys(data, ['messageIds']) || !Array.isArray(data.messageIds)
    || data.messageIds.length === 0 || data.messageIds.length > CHAT_V2_RESUME_LIMIT) return;
  const messageIds = new Set<string>();
  for (const value of data.messageIds) {
    const id = canonicalChatMessageId(value);
    if (!id) return;
    messageIds.add(id);
  }
  return { messageIds: [...messageIds] };
}

export function parseChatV2HistoryRequest(value: unknown): ChatV2HistoryRequest | undefined {
  const data = packet(value);
  if (data && exactKeys(data, ['visitId', 'afterCursor', 'limit']) && integerAtLeast(data.visitId, 1)
    && integerAtLeast(data.afterCursor, 0) && integerAtLeast(data.limit, 1) && data.limit <= CHAT_V2_HISTORY_LIMIT) {
    return { visitId: data.visitId, afterCursor: data.afterCursor, limit: data.limit };
  }
}

export function parseChatV2Result(value: unknown): ChatV2Result | undefined {
  const data = packet(value), messageId = canonicalChatMessageId(data?.messageId);
  if (!data || !messageId) return;
  const { status, reasonCode } = data;
  if ((status !== 'published' && data.publicationId !== undefined) || (status !== 'retry_later' && data.retryAfterMs !== undefined)
    || ((status === 'accepted' || status === 'published') && reasonCode !== undefined)) return;
  switch (status) {
    case 'accepted': return { messageId, status };
    case 'published': {
      const publicationId = canonicalUuid(data.publicationId);
      if (publicationId) return { messageId, status, publicationId };
      return;
    }
    case 'rejected': if (knownCode(rejectedReasons, reasonCode)) return { messageId, status, reasonCode }; return;
    case 'cancelled': if (knownCode(cancelledReasons, reasonCode)) return { messageId, status, reasonCode }; return;
    case 'retry_later':
      if (knownCode(retryReasons, reasonCode) && integerAtLeast(data.retryAfterMs, 1) && data.retryAfterMs <= 2 ** 31 - 1) {
        return { messageId, status, reasonCode, retryAfterMs: data.retryAfterMs };
      }
      return;
    case 'id_conflict': if (reasonCode === 'id_conflict') return { messageId, status, reasonCode }; return;
    case 'expired': if (reasonCode === 'message_id_expired') return { messageId, status, reasonCode }; return;
  }
}

export function parseChatV2ResumeResponse(value: unknown): ChatV2ResumeResponse | undefined {
  const data = packet(value);
  if (!Array.isArray(data?.results) || data.results.length === 0 || data.results.length > CHAT_V2_RESUME_LIMIT) return;
  const results: ChatV2ResumeResult[] = [];
  const seen = new Set<string>();
  for (const value of data.results) {
    const entry = packet(value), messageId = canonicalChatMessageId(entry?.messageId);
    if (!messageId || seen.has(messageId)) return;
    const result = entry?.status === 'not_found' ? { messageId, status: 'not_found' } as const : parseChatV2Result(entry);
    if (!result || result.status === 'id_conflict') return;
    seen.add(messageId);
    results.push(result);
  }
  return { results };
}

function parseChatV2Publication(value: unknown): ChatV2Publication | undefined {
  const data = packet(value), publicationId = canonicalUuid(data?.publicationId);
  if (!data || !publicationId || !integerAtLeast(data.publicationSeq, 1) || !integerAtLeast(data.time, 0)
    || typeof data.senderId !== 'string' || typeof data.name !== 'string' || typeof data.text !== 'string'
    || (data.system !== undefined && typeof data.system !== 'boolean')) return;
  return {
    publicationId, publicationSeq: data.publicationSeq, senderId: data.senderId, name: data.name, text: data.text, time: data.time,
    ...(data.system !== undefined ? { system: data.system } : {}),
  };
}

export function parseChatV2Batch(value: unknown): ChatV2Batch | undefined {
  const data = packet(value), roomEpoch = canonicalUuid(data?.roomEpoch);
  if (!data || !roomEpoch || !integerAtLeast(data.visitId, 1) || !integerAtLeast(data.fromCursor, 0)
    || !integerAtLeast(data.scannedThrough, data.fromCursor) || !Array.isArray(data.messages)
    || data.messages.length > CHAT_V2_HISTORY_LIMIT || typeof data.hasMore !== 'boolean' || typeof data.reset !== 'boolean'
    || (data.hasMore && data.scannedThrough === data.fromCursor)) return;
  let sequence = data.fromCursor;
  const messages: ChatV2Publication[] = [], seen = new Set<string>();
  for (const value of data.messages) {
    const message = parseChatV2Publication(value);
    if (!message || message.publicationSeq <= sequence || message.publicationSeq > data.scannedThrough || seen.has(message.publicationId)) return;
    sequence = message.publicationSeq;
    seen.add(message.publicationId);
    messages.push(message);
  }
  return { roomEpoch, visitId: data.visitId, fromCursor: data.fromCursor, scannedThrough: data.scannedThrough, messages, hasMore: data.hasMore, reset: data.reset };
}
