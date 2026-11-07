import { CHAT_CONDUCT_WINDOW_MS, evaluateChatSpam, type ChatSpamSample } from './chatModerationRules';

// Shared by all rooms: reconnecting or opening another tab does not reset the window.
export class ChatSpam {
  private accounts = new Map<string, ChatSpamSample[]>();
  private cleanedAt = 0;
  clear(id: string) { this.accounts.delete(id); }
  check(id: string, text: string, now = Date.now()): 'ok' | 'slow' | 'spam' {
    if (now - this.cleanedAt >= CHAT_CONDUCT_WINDOW_MS) {
      for (const [key, entries] of this.accounts) {
        if (now - entries[entries.length - 1].at >= CHAT_CONDUCT_WINDOW_MS) this.accounts.delete(key);
      }
      this.cleanedAt = now;
    }
    const result = evaluateChatSpam(this.accounts.get(id) ?? [], text, now);
    if (result.outcome === 'spam') this.clear(id);
    else this.accounts.set(id, result.samples);
    return result.outcome;
  }
}
export const chatSpam = new ChatSpam();
