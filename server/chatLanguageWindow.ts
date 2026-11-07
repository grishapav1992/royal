import { chatQueue } from './chatQueue';

const WINDOW_MS = 30_000;
const WORD_LIMIT = 10;
type Sample = { at: number; words: number; requestId?: string };

// The account window is shared by all rooms in this server process.
export class ChatLanguageWindow {
  private readonly accounts = new Map<string, Sample[]>();
  private cleanedAt = 0;

  constructor(private readonly hasPending: (account: string) => boolean = () => false) {}

  clear(accountId: string) { this.accounts.delete(accountId); }

  check(accountId: string, words: number, now = Date.now(), requestId?: string): boolean {
    if (now - this.cleanedAt >= WINDOW_MS) {
      for (const [id, samples] of this.accounts) {
        if (!this.hasPending(id) && now - samples[samples.length - 1].at >= WINDOW_MS) this.accounts.delete(id);
      }
      this.cleanedAt = now;
    }
    if (words === 0) return false;

    const samples = (this.accounts.get(accountId) ?? []).filter(sample => now - sample.at < WINDOW_MS);
    const key = requestId?.toLowerCase();
    if (key && samples.some(sample => sample.requestId === key)) return false;
    samples.push({ at: now, words, requestId: key });
    this.accounts.set(accountId, samples);
    return samples.reduce((total, sample) => total + sample.words, 0) >= WORD_LIMIT;
  }
}

export const chatLanguageWindow = new ChatLanguageWindow(account => chatQueue.hasPending(account));
