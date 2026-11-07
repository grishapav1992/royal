import type { HallId } from './world';

export const SECURITY_BAN_MS = 10 * 60 * 1000;
export const SECURITY_WARNING_MS = 24 * 60 * 60 * 1000;
export const GUARD_HOME = { x: 585, y: 635 };
export const GUARD_EXIT = { x: 540, y: 640 };
export type SecurityDecision = { kind: 'warning' | 'ejecting'; until: number; reason?: 'insult' | 'spam' | 'collision' };
export type GuardView = {
  hall: HallId; x: number; y: number; facing: string; phase: string;
  target: string; progress: number; speech: string;
  routine: string; reply: string;
};
