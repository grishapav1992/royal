import type { HallId } from './world';

export const SECURITY_BAN_MS = 10 * 60 * 1000;
export const SECURITY_WARNING_MS = 24 * 60 * 60 * 1000;
export const GUARD_HOME = { x: 585, y: 635 };
export const GUARD_EXIT = { x: 540, y: 640 };
export type SecurityDecision = { kind: 'warning' | 'ejecting'; until: number; reason?: 'insult' | 'spam' | 'collision' | 'profanity' };
export type ClubViolation = 'spam' | 'collision' | 'profanity';
export type ClubSanction = { id: string; until: number; amountCents: number; revision: number };
export const CLUB_FINE_SOURCE = 'club-fine';
export type ClubFineRequest = { id: string; sanctionId: string; revision: number; amountCents: number };
export type ClubFineReceipt = ClubFineRequest & { paidAt: number };
export type ClubFineResult =
  | { status: 'paid'; receipt: ClubFineReceipt; sanction: ClubSanction | null; replayed: boolean }
  | { status: 'changed' | 'inactive' | 'insufficient' | 'id-conflict'; sanction: ClubSanction | null };
export type ClubFineStatus = { sanction: ClubSanction | null; serverNow: number };
export type ClubFineResponse = ClubFineResult & ClubFineStatus;
export type ClubPursuit = { id: string; sanctionId: string; until: number; reason?: ClubViolation };
export type ClubCaptureDecision = SecurityDecision & { pursuitId: string };
export type GuardView = {
  hall: HallId; x: number; y: number; facing: string; phase: string;
  target: string; progress: number; speech: string;
  routine: string; reply: string;
};
