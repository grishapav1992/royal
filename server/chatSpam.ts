type Entry = { at: number; text: string };

// Shared by all rooms: reconnecting or opening another tab does not reset the window.
export class ChatSpam {
  private accounts = new Map<string, Entry[]>();
  private cleanedAt = 0;
  clear(id: string) { this.accounts.delete(id); }
  check(id: string, text: string, now = Date.now()): 'ok' | 'slow' | 'spam' {
    if (now - this.cleanedAt >= 30000) {
      for (const [key, entries] of this.accounts) if (now - entries[entries.length-1].at >= 30000) this.accounts.delete(key);
      this.cleanedAt = now;
    }
    const normalized = text.normalize('NFKC').toLowerCase().replace(/\p{Cf}/gu,'').replace(/[\p{P}\p{Z}\s]/gu,'');
    const entries = (this.accounts.get(id) ?? []).filter(entry => now-entry.at < 30000);
    entries.push({at:now,text:normalized});
    this.accounts.set(id,entries);
    const repeats = entries.filter(entry => entry.text === normalized).length;
    // Short replies and emoji need more repetitions to avoid punishing a normal conversation.
    if (entries.filter(entry => now-entry.at < 10000).length >= 8 || repeats >= (Array.from(normalized).length >= 8 ? 3 : 5)) {
      this.clear(id);
      return 'spam';
    }
    return entries.filter(entry => now-entry.at < 5000).length > 4 ? 'slow' : 'ok';
  }
}
export const chatSpam = new ChatSpam();
