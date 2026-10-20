import { english } from './en';

export type Language = 'ru' | 'en';
export const LANGUAGE_KEY = 'royal-language';

export function resolveLanguage(url: string, saved?: string | null): Language {
  const requested = new URL(url).searchParams.get('lang');
  return requested === 'en' || requested === 'ru' ? requested : saved === 'en' ? 'en' : 'ru';
}

function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'ru';
  let saved: string | null = null;
  try { saved = localStorage.getItem(LANGUAGE_KEY); } catch { /* URL selection also works without storage. */ }
  return resolveLanguage(location.href, saved);
}

export const language = initialLanguage();
export const locale = language === 'en' ? 'en-US' : 'ru-RU';
const russian = /[А-Яа-яЁё]/;
const own = (key: string) => Object.hasOwn(english, key);

function exact(source: string): string | undefined {
  const key = source.trim();
  if (!own(key)) return undefined;
  return source.slice(0, source.length - source.trimStart().length) + english[key] + source.slice(source.trimEnd().length);
}

/** Translate fixed source text only. Never pass player names or chat messages here. */
export function t(source: string): string {
  if (language !== 'en' || !russian.test(source)) return source;
  const translated = exact(source);
  if (translated !== undefined) return translated;
  // Markup comes from source literals; dynamic template values are handled separately by tr.
  if (/[<>]/.test(source)) return source.replace(/[^<>"'\n]+/g, part => exact(part) ?? part);
  return translateMessage(source);
}

/** Keep interpolated values outside the translation process, including user content. */
export function tr(parts: TemplateStringsArray, ...values: unknown[]): string {
  if (language === 'en' && !parts.some(part => /[<>]/.test(part))) {
    const key = parts.map((part, i) => part + (i < values.length ? `{${i}}` : '')).join('');
    if (own(key.trim())) {
      const translated = exact(key)!;
      return translated.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]));
    }
  }
  return parts.map((part, i) => t(part) + (i < values.length ? String(values[i]) : '')).join('');
}

const escapePattern = (source: string) => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const messagePatterns = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const slots: number[] = [];
  let expression = '', position = 0;
  for (const match of key.matchAll(/\{(\d+)\}/g)) {
    expression += escapePattern(key.slice(position, match.index)) + '(.*?)';
    slots.push(Number(match[1])); position = match.index! + match[0].length;
  }
  expression += escapePattern(key.slice(position));
  return { pattern: new RegExp('^' + expression + '$', 's'), value, slots };
});
const fragments = Object.keys(english).filter(key => !/[<>{}\n]/.test(key) && russian.test(key)).sort((a, b) => b.length - a.length);
const fragmentPattern = new RegExp(fragments.map(escapePattern).join('|'), 'gu');

function matchMessage(source: string): string | undefined {
  for (const { pattern, value, slots } of messagePatterns) {
    const match = source.match(pattern);
    if (match) return value.replace(/\{(\d+)\}/g, (_, index) => match[slots.indexOf(Number(index)) + 1] ?? '');
  }
  return undefined;
}

/** Localize known server notices without changing stored sessions or payment data. */
export function translateMessage(source: string): string {
  if (language !== 'en' || !russian.test(source)) return source;
  const translated = exact(source);
  if (translated !== undefined) return translated;
  const message = matchMessage(source);
  if (message !== undefined) return message;
  return source.replace(fragmentPattern, (match, offset: number) => {
    const before = source[offset - 1] ?? '', after = source[offset + match.length] ?? '';
    if (russian.test(before) && russian.test(match[0]) || russian.test(after) && russian.test(match.at(-1)!)) return match;
    return english[match];
  });
}

const translatedMessages = new Set(Object.values(english));
const translatedPatterns = Object.values(english).filter(value => /\{\d+\}/.test(value))
  .map(value => new RegExp('^' + value.split(/\{\d+\}/).map(escapePattern).join('.*?') + '$', 's'));

export function isUserMessage(message: string): boolean {
  return russian.test(message) || own(message.trim()) || translatedMessages.has(message.trim())
    || translatedPatterns.some(pattern => pattern.test(message.trim()));
}

export function installLanguageSwitcher(host: HTMLElement): void {
  const label = document.createElement('label'); label.className = 'language-switcher';
  const caption = document.createElement('span'); caption.className = 'language-caption'; caption.textContent = language === 'en' ? 'Language' : 'Язык';
  const select = document.createElement('select'); select.name = 'language'; select.setAttribute('aria-label', caption.textContent);
  for (const [value, name] of [['ru', 'Русский'], ['en', 'English']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = name; option.selected = value === language; select.append(option);
  }
  select.addEventListener('change', () => {
    const next = select.value === 'en' ? 'en' : 'ru';
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* The URL preserves the selection. */ }
    const url = new URL(location.href); url.searchParams.set('lang', next);
    // Keep the hall recovery state on the current history entry.
    history.replaceState(history.state, '', url);
    location.reload();
  });
  label.append(caption, select); host.append(label);
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = language;
  document.title = language === 'en' ? 'Royal • Arcade Club' : 'Рояль • Аркадный клуб';
  document.querySelector('meta[name="description"]')?.setAttribute('content', language === 'en'
    ? 'Royal: a social arcade club. Explore the floors, meet other players and discover the games.'
    : 'Рояль: аркадный клуб. Исследуй этажи, знакомься с игроками и открывай игры.');
  try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Storage is optional. */ }
}
