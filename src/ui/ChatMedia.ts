import { t as translateText } from '../i18n/index';
import { CHAT_EMOJI, CHAT_MEDIA_BASE, CHAT_STICKERS, chatEmojiFromText, chatStickerFromId, chatStickerFromText, type ChatEmoji, type ChatSticker } from '../shared/chatMedia';
import './chat-media.css';

type Pack = 'emoji' | 'duck' | 'cat' | 'capybara' | 'recent';
const PACKS: { id: Pack; icon: string; name: string }[] = [
  { id: 'emoji', icon: '😊', name: translateText('Смайлики') }, { id: 'duck', icon: '🦆', name: translateText('Уточка') },
  { id: 'cat', icon: '🐱', name: translateText('Котики') }, { id: 'capybara', icon: '🤎', name: translateText('Капибара') },
  { id: 'recent', icon: '◷', name: translateText('Недавние') },
];
const RECENT_KEY = 'royal.chat-media.recent.v1';
const MAX_ANIMATIONS = 8;

function animal(sticker: ChatSticker) {
  const picture = document.createElement('span');
  picture.className = 'chat-animal'; picture.setAttribute('role', 'img'); picture.setAttribute('aria-label', sticker.name);
  picture.style.backgroundPosition = `${sticker.col * 100 / 3}% ${sticker.row * 50}%`;
  return picture;
}

export class ChatMedia {
  private panel = document.createElement('section');
  private toggle = document.createElement('button');
  private grid = document.createElement('div');
  private search = document.createElement('input');
  private heading = document.createElement('strong');
  private pack: Pack = 'emoji';
  private tabs = new Map<Pack, HTMLButtonElement>();
  private recent: string[] = [];
  private selection = { start: 0, end: 0 };
  private animations = new Map<HTMLImageElement, { item: ChatEmoji; fallback: HTMLElement; visible: boolean; failed: boolean }>();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const img = entry.target.querySelector('img');
      const record = img ? this.animations.get(img) : undefined;
      if (record) record.visible = entry.isIntersecting;
    }
    this.refreshAnimations();
  });

  constructor(private chat: HTMLElement, private input: HTMLInputElement, private send: (text: string) => boolean, typing: (value: boolean) => void) {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(stored)) this.recent = [...new Set(stored.filter((id): id is string => typeof id === 'string' && Boolean(chatStickerFromId(id) || chatEmojiFromText(id))))].slice(0, 20);
    } catch { /* An unavailable preference store does not block chat. */ }
    this.toggle.id = 'chat-media-toggle'; this.toggle.type = 'button'; this.toggle.textContent = '😊';
    this.toggle.setAttribute('aria-label', translateText('Смайлики и стикеры')); this.toggle.title = translateText('Смайлики и стикеры');
    this.toggle.setAttribute('aria-controls', 'chat-media-panel'); this.toggle.setAttribute('aria-expanded', 'false'); this.toggle.disabled = true;
    input.before(this.toggle);
    this.panel.id = 'chat-media-panel'; this.panel.className = 'chat-media-panel'; this.panel.hidden = true;
    this.panel.dataset.chatMediaPanel = ''; this.panel.setAttribute('aria-label', translateText('Смайлики и стикеры'));
    const top = document.createElement('div'); top.className = 'chat-media-top';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', translateText('Закрыть смайлики и стикеры'));
    close.addEventListener('click', () => this.close(true)); top.append(this.heading, close);
    const tabs = document.createElement('div'); tabs.className = 'chat-media-tabs'; tabs.setAttribute('aria-label', translateText('Наборы стикеров'));
    for (const pack of PACKS) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = pack.icon; tab.title = pack.name;
      tab.setAttribute('aria-label', pack.name); tab.setAttribute('aria-pressed', 'false'); tab.dataset.chatPack = pack.id;
      tab.addEventListener('click', () => { this.pack = pack.id; this.search.value = ''; this.render(); });
      tabs.append(tab); this.tabs.set(pack.id, tab);
    }
    this.search.type = 'search'; this.search.placeholder = translateText('Найти эмоцию…'); this.search.setAttribute('aria-label', translateText('Найти смайлик или стикер'));
    this.search.maxLength = 60; this.search.addEventListener('input', () => this.render());
    this.grid.className = 'chat-media-grid'; this.grid.setAttribute('aria-label', translateText('Выбрать смайлик или стикер'));
    const credits = document.createElement('a'); credits.href = CHAT_MEDIA_BASE + 'credits.html'; credits.target = '_blank'; credits.rel = 'noopener'; credits.textContent = translateText('Наборы и авторы'); credits.className = 'chat-media-credits';
    this.panel.append(top, tabs, this.search, this.grid, credits); chat.append(this.panel);
    const rememberSelection = () => { this.selection = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length }; };
    for (const event of ['input', 'select', 'keyup', 'pointerup']) input.addEventListener(event, rememberSelection);
    this.toggle.addEventListener('pointerdown', rememberSelection);
    this.toggle.addEventListener('click', () => {
      if (this.panel.hidden) { this.panel.hidden = false; this.toggle.setAttribute('aria-expanded', 'true'); this.render(); this.search.focus({ preventScroll: true }); }
      else this.close(true);
    });
    chat.addEventListener('keydown', event => {
      if (!this.panel.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
      else if (this.panel.contains(event.target as Node)) event.stopPropagation();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.panel.hidden && this.panel.getClientRects().length) {
        event.preventDefault(); event.stopPropagation(); this.close(true);
      }
    }, true);
    this.panel.addEventListener('pointerdown', event => event.stopPropagation());
    chat.addEventListener('focusin', () => typing(true));
    chat.addEventListener('focusout', event => { if (!chat.contains(event.relatedTarget as Node | null)) typing(false); });
    document.addEventListener('pointerdown', event => { if (!this.panel.hidden && !this.panel.contains(event.target as Node) && event.target !== this.toggle) this.close(false); });
    this.reduced.addEventListener('change', () => this.refreshAnimations());
    document.addEventListener('visibilitychange', () => this.refreshAnimations());
  }

  setDisabled(disabled: boolean) {
    this.toggle.disabled = disabled;
    this.search.disabled = disabled;
    for (const button of Array.from(this.grid.querySelectorAll<HTMLButtonElement>('button'))) button.disabled = disabled;
    if (disabled) this.close(false);
  }

  close(focus: boolean) {
    this.panel.hidden = true; this.toggle.setAttribute('aria-expanded', 'false');
    if (focus && !this.input.disabled) this.input.focus({ preventScroll: true });
  }

  private remember(id: string) {
    this.recent = [id, ...this.recent.filter(previous => previous !== id)].slice(0, 20);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent)); } catch { /* Recents are optional. */ }
  }

  private render() {
    this.heading.textContent = PACKS.find(pack => pack.id === this.pack)!.name;
    for (const [id, tab] of this.tabs) tab.setAttribute('aria-pressed', String(id === this.pack));
    const query = this.search.value.trim().toLocaleLowerCase('ru');
    const entries: (ChatEmoji | ChatSticker)[] = this.pack === 'emoji' ? [...CHAT_EMOJI] : this.pack === 'recent'
      ? this.recent.map(id => chatStickerFromId(id) || chatEmojiFromText(id)).filter((item): item is ChatEmoji | ChatSticker => Boolean(item))
      : CHAT_STICKERS.filter(sticker => sticker.pack === this.pack);
    this.grid.replaceChildren(); this.grid.classList.toggle('chat-media-emoji-grid', this.pack === 'emoji');
    for (const entry of entries.filter(item => (item.name + ('emoji' in item ? item.emoji : item.text)).toLocaleLowerCase('ru').includes(query))) {
      const button = document.createElement('button'); button.type = 'button'; button.title = entry.name; button.setAttribute('aria-label', entry.name);
      button.disabled = this.input.disabled;
      if ('emoji' in entry) {
        button.textContent = entry.emoji; button.className = 'chat-media-emoji-choice'; button.dataset.chatEmoji = entry.emoji;
        button.addEventListener('click', () => {
          if (this.input.disabled) return;
          const start = Math.min(this.selection.start, this.input.value.length);
          const end = Math.max(start, Math.min(this.selection.end, this.input.value.length));
          if (this.input.value.length - (end - start) + entry.emoji.length > this.input.maxLength) return;
          this.input.setRangeText(entry.emoji, start, end, 'end'); this.input.dispatchEvent(new Event('input', { bubbles: true }));
          this.remember(entry.emoji); this.close(true);
        });
      } else {
        button.append(animal(entry)); button.className = 'chat-media-sticker-choice'; button.dataset.chatSticker = entry.id;
        button.addEventListener('click', () => { if (!this.input.disabled && this.send(entry.text)) { this.remember(entry.id); this.close(true); } });
      }
      this.grid.append(button);
    }
    if (!this.grid.childElementCount) { const empty = document.createElement('p'); empty.className = 'chat-media-empty'; empty.textContent = this.pack === 'recent' && !query ? translateText('Здесь появятся отправленные стикеры и выбранные смайлики.') : translateText('Ничего не найдено'); this.grid.append(empty); }
  }

  content(text: string, system = false): HTMLElement {
    const sticker = !system && chatStickerFromText(text);
    if (sticker) { const figure = document.createElement('div'); figure.className = 'chat-sticker-message'; figure.dataset.stickerId = sticker.id; figure.append(animal(sticker)); return figure; }
    const p = document.createElement('p');
    if (system) { p.textContent = text; return p; }
    // Render only allowlisted Unicode, never URLs or HTML from a chat message.
    const parts = Array.from(new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text), part => part.segment);
    let animated = 0;
    const nonempty = parts.filter(part => part.trim());
    const large = nonempty.length > 0 && nonempty.length <= 3 && nonempty.every(part => Boolean(chatEmojiFromText(part)));
    if (large) p.className = 'chat-emoji-only';
    for (const part of parts) {
      const item = chatEmojiFromText(part);
      if (!item || animated++ >= 8) { p.append(document.createTextNode(part)); continue; }
      const span = document.createElement('span'); span.className = 'chat-animated-emoji'; span.setAttribute('role', 'img'); span.setAttribute('aria-label', item.name); span.title = item.name;
      const fallback = document.createElement('span'); fallback.textContent = item.emoji; fallback.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img'); img.alt = ''; img.width = 48; img.height = 48; img.hidden = true; img.decoding = 'async'; img.setAttribute('aria-hidden', 'true');
      this.animations.set(img, { item, fallback, visible: false, failed: false });
      img.addEventListener('error', () => { const record = this.animations.get(img); if (record) record.failed = true; this.refreshAnimations(); });
      span.append(fallback, img); p.append(span); span.dataset.emojiCode = item.code;
      this.observer.observe(span);
    }
    return p;
  }

  prune() {
    for (const [img] of this.animations) if (!img.isConnected) { this.observer.unobserve(img.parentElement!); this.animations.delete(img); }
  }

  private refreshAnimations() {
    let budget = MAX_ANIMATIONS;
    for (const [img, record] of [...this.animations].reverse()) {
      const active = record.visible && img.isConnected && !record.failed && !this.reduced.matches && !document.hidden && budget-- > 0;
      img.hidden = !active; record.fallback.hidden = active;
      if (active && !img.hasAttribute('src')) img.src = CHAT_MEDIA_BASE + record.item.code + '.webp';
      else if (!active) img.removeAttribute('src');
    }
  }
}
