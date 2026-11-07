type Entry = { at: number; text: string; telegram: string[] };

// Public channel names are case-insensitive. Invite tokens retain their case.
const TELEGRAM_REFERENCE = /(?:^|[\s([{"'<«])(?:(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.(?:me|dog))\/(?:(?:\+|joinchat\/)([a-z\d_-]+)|(?:s\/)?([a-z\d_]{4,32}))|tg:(?:\/\/)?resolve\?domain=([a-z\d_]{4,32})|(?:telegram|телеграм|тг)\s*:?\s*@([a-z\d_]{4,32}))(?=$|[/?#&\s)\]}"'>».,!])/giu;
const TELEGRAM_SERVICE_PATHS = new Set([
  'addemoji', 'addlist', 'addstickers', 'addstyle', 'addtheme', 'auction', 'auth', 'boost', 'call',
  'confirmphone', 'contact', 'giftcode', 'invoice', 'joinchat', 'login', 'proxy', 'setlanguage', 'share', 'socks',
]);

function telegramDestinations(text: string): string[] {
  const destinations = new Set<string>();
  for (const [, invite, path, deepLink, handle] of text.matchAll(TELEGRAM_REFERENCE)) {
    if (invite) destinations.add('invite:' + invite);
    else {
      const name = (path ?? deepLink ?? handle).toLowerCase();
      if (!path || !TELEGRAM_SERVICE_PATHS.has(name)) destinations.add(name);
    }
  }
  return [...destinations];
}

function nearlyEqual(a: string, b: string): boolean {
  const length = Math.min(a.length, b.length);
  if (length < 28) return false;
  const limit = Math.min(6, Math.floor(length / 10));
  // Changing only an amount or score is common during normal play.
  if (Math.abs(a.length - b.length) > limit || a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#')) return false;

  // Only compute cells within the allowed edit distance of the diagonal.
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);
  for (let row = 1; row <= a.length; row++) {
    const first = Math.max(1, row - limit), last = Math.min(b.length, row + limit);
    current[first - 1] = first === 1 ? row : limit + 1;
    for (let column = first; column <= last; column++) {
      const substitution = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + substitution);
    }
    if (last < b.length) current[last + 1] = limit + 1;
    [previous, current] = [current, previous];
  }
  return previous[b.length] <= limit;
}

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
    const cleaned = text.normalize('NFKC').replace(/\p{Cf}/gu, '');
    const normalized = cleaned.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
    const telegram = telegramDestinations(cleaned);
    const entries = (this.accounts.get(id) ?? []).filter(entry => now-entry.at < 30000);
    entries.push({ at: now, text: normalized, telegram });
    this.accounts.set(id,entries);
    const textCounts = new Map<string, number>();
    for (const entry of entries) textCounts.set(entry.text, (textCounts.get(entry.text) ?? 0) + 1);
    const repeats = textCounts.get(normalized)!;
    // A similar message needs corroboration from an exact duplicate.
    const repeatedVariant = [...textCounts].some(([candidate, count]) =>
      candidate !== normalized && (repeats >= 2 || count >= 2) && nearlyEqual(candidate, normalized));
    const repeatedDestination = telegram.some(destination => entries.filter(entry => entry.telegram.includes(destination)).length >= 3);
    // Short replies and emoji need more repetitions to avoid punishing a normal conversation.
    if (entries.filter(entry => now-entry.at < 10000).length >= 8 || repeatedDestination || repeatedVariant || repeats >= (Array.from(normalized).length >= 8 ? 3 : 5)) {
      this.clear(id);
      return 'spam';
    }
    return entries.filter(entry => now-entry.at < 5000).length > 4 ? 'slow' : 'ok';
  }
}
export const chatSpam = new ChatSpam();
