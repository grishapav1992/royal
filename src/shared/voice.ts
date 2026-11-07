import type { HallId } from './world';

export type VoiceCredentials = { url: string; token: string; hall: HallId };
export type VoiceResult = { requestId: number; credentials?: VoiceCredentials; unavailable?: boolean };
export type VoiceMember = { playerId: string; muteKey: string };
