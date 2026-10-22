export type ChatRequest = { id: string; text: string };
export type ChatResult = {
 id: string;
 status: 'queued' | 'published' | 'rejected' | 'cancelled';
 message?: string;
};

export const CHAT_PENDING_LIMIT = 3;
export const CHAT_CONFIRMATION_TIMEOUT_MS = 20000;
