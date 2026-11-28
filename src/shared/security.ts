import type { HallId } from './world';

export const GUARD_HOME = { x: 585, y: 635 };
export const GUARD_EXIT = { x: 540, y: 640 };
export type ClubViolation = 'spam' | 'collision' | 'profanity';
// The guard only escorts a confirmed capture. Club sanctions own fines and deadlines.
export type SecurityDecision = { kind: 'ejecting'; until: number; reason?: ClubViolation };
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
  /** The state key: the house guard is 'security', the radio backup has its own id. */
  id?: string;
  hall: HallId; x: number; y: number; facing: string; phase: string;
  target: string; progress: number; speech: string;
  routine: string; reply: string;
};
