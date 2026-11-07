import { filterChatLanguage } from '../src/shared/chatConduct';

export const CHAT_CONDUCT_WINDOW_MS = 30_000;
export const CHAT_MODERATION_RULES_VERSION = 1;
const WORD_LIMIT = 10;
const MAX_ADMITTED_TEXT_LENGTH = 300;
// Allow compatibility normalization and lowercase expansion. U+FDFA alone expands to 18 code units.
const MAX_NORMALIZED_TEXT_LENGTH = MAX_ADMITTED_TEXT_LENGTH * 32;
// The shortest match is t.me/+x. The stored invite: prefix adds at most one extra unit per match.
const MAX_TELEGRAM_REFERENCES = Math.floor(MAX_NORMALIZED_TEXT_LENGTH / 7);

export type ChatSpamSample = Readonly<{ at: number; text: string; telegram: readonly string[] }>;
export type ChatLanguageSample = Readonly<{ at: number; words: number; requestId?: string }>;
type SpamOutcome = 'ok' | 'slow' | 'spam';

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

export function evaluateChatSpam(previous: readonly ChatSpamSample[], text: string, now: number): {
  outcome: SpamOutcome; samples: ChatSpamSample[];
} {
  const cleaned = text.normalize('NFKC').replace(/\p{Cf}/gu, '');
  const normalized = cleaned.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
  const telegram = telegramDestinations(cleaned);
  const samples = previous.filter(sample => now - sample.at < CHAT_CONDUCT_WINDOW_MS);
  samples.push({ at: now, text: normalized, telegram });
  const textCounts = new Map<string, number>();
  for (const sample of samples) textCounts.set(sample.text, (textCounts.get(sample.text) ?? 0) + 1);
  const repeats = textCounts.get(normalized)!;
  // A similar message needs corroboration from an exact duplicate.
  const repeatedVariant = [...textCounts].some(([candidate, count]) =>
    candidate !== normalized && (repeats >= 2 || count >= 2) && nearlyEqual(candidate, normalized));
  const repeatedDestination = telegram.some(destination => samples.filter(sample => sample.telegram.includes(destination)).length >= 3);
  // Short replies and emoji need more repetitions to avoid punishing a normal conversation.
  if (samples.filter(sample => now - sample.at < 10_000).length >= 8 || repeatedDestination || repeatedVariant
    || repeats >= (Array.from(normalized).length >= 8 ? 3 : 5)) {
    return { outcome: 'spam', samples };
  }
  return { outcome: samples.filter(sample => now - sample.at < 5_000).length > 4 ? 'slow' : 'ok', samples };
}

export function evaluateChatLanguage(previous: readonly ChatLanguageSample[], words: number, now: number, requestId?: string): {
  exceeded: boolean; samples: ChatLanguageSample[];
} | undefined {
  if (words === 0) return;
  const samples = previous.filter(sample => now - sample.at < CHAT_CONDUCT_WINDOW_MS);
  const key = requestId?.toLowerCase();
  if (key && samples.some(sample => sample.requestId === key)) return;
  samples.push(key === undefined ? { at: now, words } : { at: now, words, requestId: key });
  return { exceeded: samples.reduce((total, sample) => total + sample.words, 0) >= WORD_LIMIT, samples };
}

export type ChatModerationState = {
  readonly spam: readonly ChatSpamSample[];
  readonly language: readonly Omit<ChatLanguageSample, 'requestId'>[];
};

export type ChatModerationDecision = { state: ChatModerationState } & (
  | { outcome: 'publish'; maskedText: string }
  | { outcome: 'rate_limited' | 'spam' | 'profanity' }
);

// Each ten-second interval can hold at most seven attempts before a violation.
// Retain three intervals plus the attempt that triggers enforcement.
const MAX_SPAM_SAMPLES = 22;

function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function isSpamSample(value: unknown): value is { at: unknown } {
  if (!hasFields(value, ['at', 'text', 'telegram']) || typeof value.text !== 'string'
    || value.text.length > MAX_NORMALIZED_TEXT_LENGTH || !Array.isArray(value.telegram)
    || value.telegram.length > MAX_TELEGRAM_REFERENCES) return false;
  let totalLength = 0;
  for (const reference of value.telegram) {
    if (typeof reference !== 'string' || reference.length > MAX_NORMALIZED_TEXT_LENGTH
      || !/^(?:[a-z\d_]{4,32}|invite:[A-Za-z\d_-]+)$/.test(reference)) return false;
    totalLength += reference.length;
    if (totalLength > MAX_NORMALIZED_TEXT_LENGTH + MAX_TELEGRAM_REFERENCES) return false;
  }
  return true;
}

function isLanguageSample(value: unknown): value is { at: unknown } {
  return hasFields(value, ['at', 'words']) && typeof value.words === 'number' && Number.isSafeInteger(value.words)
    && value.words >= 1 && value.words <= MAX_ADMITTED_TEXT_LENGTH;
}

function assertOrderedSamples(samples: readonly unknown[], receivedAt: number,
  isSample: (value: unknown) => value is { at: unknown }): void {
  let previousAt = 0;
  for (const sample of samples) {
    if (!isSample(sample)) throw new TypeError('Invalid chat moderation sample');
    if (typeof sample.at !== 'number' || !Number.isSafeInteger(sample.at) || sample.at < previousAt || sample.at > receivedAt) {
      throw new RangeError('Chat moderation requires ordered admission times');
    }
    previousAt = sample.at;
  }
}

function assertModerationState(state: unknown, receivedAt: number): asserts state is ChatModerationState {
  if (!hasFields(state, ['spam', 'language']) || !Array.isArray(state.spam) || !Array.isArray(state.language)) {
    throw new TypeError('Invalid chat moderation state');
  }
  if (state.spam.length > MAX_SPAM_SAMPLES || state.language.length > WORD_LIMIT) {
    throw new RangeError('Chat moderation state exceeds its sample limits');
  }
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) throw new RangeError('Invalid chat moderation admission time');
  assertOrderedSamples(state.spam, receivedAt, isSpamSample);
  assertOrderedSamples(state.language, receivedAt, isLanguageSample);
}

/**
 * Use the admitted text and time in account order. The caller deduplicates requests
 * and pauses the account after a violation until the enforcement result is recorded.
 */
export function evaluateChatModeration(
  rulesVersion: number, state: unknown, text: string, receivedAt: number,
): ChatModerationDecision {
  if (rulesVersion !== CHAT_MODERATION_RULES_VERSION) throw new RangeError('Unsupported chat moderation rules version');
  assertModerationState(state, receivedAt);
  if (typeof text !== 'string' || !text.length || text.length > MAX_ADMITTED_TEXT_LENGTH) {
    throw new RangeError('Invalid chat moderation text length');
  }

  const spam = evaluateChatSpam(state.spam, text, receivedAt);
  const nextSpam = spam.samples.slice(-MAX_SPAM_SAMPLES);
  if (spam.outcome !== 'ok') {
    const language = state.language.filter(sample => receivedAt - sample.at < CHAT_CONDUCT_WINDOW_MS);
    return { outcome: spam.outcome === 'slow' ? 'rate_limited' : 'spam', state: { spam: nextSpam, language } };
  }

  // Rule version 1 retains this dictionary and normalization for previously accepted work.
  const filtered = filterChatLanguage(text);
  const language = evaluateChatLanguage(state.language, filtered.count, receivedAt);
  // Only positive word counts enter the window. Ten newest samples suffice to decide the threshold.
  const nextLanguage = language?.samples.slice(-WORD_LIMIT)
    ?? state.language.filter(sample => receivedAt - sample.at < CHAT_CONDUCT_WINDOW_MS);
  const next = { spam: nextSpam, language: nextLanguage };
  if (language?.exceeded) return { outcome: 'profanity', state: next };
  return { outcome: 'publish', maskedText: filtered.text, state: next };
}
