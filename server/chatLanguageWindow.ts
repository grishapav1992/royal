import { CHAT_CONDUCT_WINDOW_MS, evaluateChatLanguage, type ChatLanguageSample } from './chatModerationRules';
import { chatQueue } from './chatQueue';

// The account window is shared by all rooms in this server process.
export class ChatLanguageWindow {
  private readonly accounts = new Map<string, ChatLanguageSample[]>();
  private cleanedAt = 0;

  constructor(private readonly hasPending: (account: string) => boolean = () => false) {}

  clear(accountId: string) { this.accounts.delete(accountId); }
  check(accountId: string, words: number, now = Date.now(), requestId?: string): boolean {
    if (now - this.cleanedAt >= CHAT_CONDUCT_WINDOW_MS) {
      for (const [id, samples] of this.accounts) {
        if (!this.hasPending(id) && now - samples[samples.length - 1].at >= CHAT_CONDUCT_WINDOW_MS) this.accounts.delete(id);
      }
      this.cleanedAt = now;
    }
    const result = evaluateChatLanguage(this.accounts.get(accountId) ?? [], words, now, requestId);
    if (!result) return false;
    this.accounts.set(accountId, result.samples);
    return result.exceeded;
  }
}

export const chatLanguageWindow = new ChatLanguageWindow(account => chatQueue.hasPending(account));
