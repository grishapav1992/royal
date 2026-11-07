import { createHash } from 'node:crypto';
import {
  chatV2FirstAdmissionAge, normalizeChatV2Text, parseChatV2Result, ROOM_CHAT_PROTOCOL_V2,
  type ChatV2Receipt, type ChatV2Result, type ChatV2ResumeRequest, type ChatV2ResumeResponse,
  type ChatV2Send, type ChatV2Visit,
} from '../src/shared/chat';

export type ChatV2StoredReceipt = { accountId: string; fingerprint: string; result: ChatV2Receipt };
type ReceiptKey = { accountId: string; messageId: string };
type FindReceipt = (key: ReceiptKey) => Promise<ChatV2StoredReceipt | undefined>;
type FindReceipts = (accountId: string, messageIds: readonly string[]) => Promise<readonly ChatV2StoredReceipt[]>;

export type ChatV2SendDecision = { kind: 'new'; fingerprint: string } | { kind: 'result'; result: ChatV2Result };

export function fingerprintChatV2Envelope(request: ChatV2Send): string {
  const envelope = [ROOM_CHAT_PROTOCOL_V2, request.roomEpoch.toLowerCase(), request.visitId, normalizeChatV2Text(request.text)];
  return createHash('sha256').update(JSON.stringify(envelope), 'utf8').digest('hex');
}

function firstAdmissionFailure(messageId: string, serverTimeMs: number): Extract<ChatV2Result, { status: 'expired' | 'rejected' }> | undefined {
  switch (chatV2FirstAdmissionAge(messageId, serverTimeMs)) {
    case 'expired': return { messageId, status: 'expired', reasonCode: 'message_id_expired' };
    case 'future': return { messageId, status: 'rejected', reasonCode: 'message_id_in_future' };
    case 'invalid': return { messageId, status: 'rejected', reasonCode: 'invalid_payload' };
  }
}

function storedResult(receipt: ChatV2StoredReceipt): ChatV2Receipt {
  const result = parseChatV2Result(receipt.result);
  if (result?.status === 'accepted' || result?.status === 'published' || result?.status === 'rejected' || result?.status === 'cancelled') return result;
  throw new Error('Invalid stored chat receipt');
}

/** The account comes from authenticated context and the request from parseChatV2Send. */
export async function decideChatV2Send(accountId: string, request: ChatV2Send,
  getCurrentVisit: () => Pick<ChatV2Visit, 'roomEpoch' | 'visitId'> | null, serverTimeMs: number,
  findReceipt: FindReceipt): Promise<ChatV2SendDecision> {
  const { messageId } = request;
  const receipt = await findReceipt({ accountId, messageId });
  if (receipt?.accountId === accountId && receipt.result.messageId === messageId) {
    const result = receipt.fingerprint === fingerprintChatV2Envelope(request)
      ? storedResult(receipt) : { messageId, status: 'id_conflict' as const, reasonCode: 'id_conflict' as const };
    return { kind: 'result', result };
  }

  const failure = firstAdmissionFailure(messageId, serverTimeMs);
  if (failure) return { kind: 'result', result: failure };
  const currentVisit = getCurrentVisit();
  if (currentVisit?.roomEpoch !== request.roomEpoch || currentVisit.visitId !== request.visitId) {
    return { kind: 'result', result: { messageId, status: 'cancelled', reasonCode: 'visit_changed' } };
  }
  // Only this branch may reserve capacity. At the write boundary, 02.2 must recheck the unique receipt key,
  // live visit and room lease after any further waits. ACK follows the durable commit.
  return { kind: 'new', fingerprint: fingerprintChatV2Envelope(request) };
}

/** Recovery reads only account-bound receipt metadata and does not require a live chat visit. */
export async function readChatV2Resume(accountId: string, request: ChatV2ResumeRequest,
  serverTimeMs: number, findReceipts: FindReceipts): Promise<ChatV2ResumeResponse> {
  const { messageIds } = request;
  const receipts = await findReceipts(accountId, messageIds);
  const requested = new Set(messageIds);
  const own = new Map(receipts.filter(receipt => receipt.accountId === accountId && requested.has(receipt.result.messageId))
    .map(receipt => [receipt.result.messageId, storedResult(receipt)]));
  return { results: messageIds.map(messageId => own.get(messageId) ?? firstAdmissionFailure(messageId, serverTimeMs)
    ?? { messageId, status: 'not_found' }) };
}
