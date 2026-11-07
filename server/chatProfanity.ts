const WINDOW_MS = 30_000;
const WORD_LIMIT = 10;
type Sample = { at: number; words: number };

// The account window is shared by all rooms in this server process.
export class ChatProfanity {
  private readonly accounts = new Map<string, Sample[]>();
  private cleanedAt = 0;

  clear(accountId: string) { this.accounts.delete(accountId); }

  check(accountId: string, words: number, now = Date.now()): boolean {
    if (now - this.cleanedAt >= WINDOW_MS) {
      for (const [id, samples] of this.accounts) {
        if (now - samples[samples.length - 1].at >= WINDOW_MS) this.accounts.delete(id);
      }
      this.cleanedAt = now;
    }
    if (words === 0) return false;

    const samples = (this.accounts.get(accountId) ?? []).filter(sample => now - sample.at < WINDOW_MS);
    samples.push({ at: now, words });
    this.accounts.set(accountId, samples);
    return samples.reduce((total, sample) => total + sample.words, 0) >= WORD_LIMIT;
  }
}

export const chatProfanity = new ChatProfanity();
