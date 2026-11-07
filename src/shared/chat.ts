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
