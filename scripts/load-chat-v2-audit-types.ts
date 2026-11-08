import type { ChatLocation } from '../src/shared/chat';

export const CHAT_AUDIT_PAGE_SIZE = 512;
export const CHAT_AUDIT_SENDER_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export type AuditAccount = { accountIndex: number; senderId: string; roomEpoch: string; location: ChatLocation };
export type AuditObserver = { accountIndex: number; senderId?: string };
export type AuditReceipt = {
  publicationId: string; accountIndex: number; roomEpoch: string; location: ChatLocation;
  publicationSeq: number | null; offeredAtMs: number;
};
export type AuditWitness = {
  publicationId: string; accountIndex: number; senderId: string; roomEpoch: string; location: ChatLocation;
  publicationSeq: number; atMs: number;
};

export type ChatAuditSummary = {
  receipts: number;
  uniquePublications: number;
  duplicatePublications: number;
  eligiblePublications: number;
  ineligiblePublications: number;
  witnessedPublications: number;
  unmatchedWitnesses: number;
  mismatchedWitnesses: number;
  changedVisits: number;
  peerDeliveryP95Ms: number | null;
};
