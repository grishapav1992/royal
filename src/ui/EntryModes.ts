import '../i18n/entryModesEn';
import { installLanguageSwitcher, t } from '../i18n/index';
import barPreview from './entry-previews/bar.webp';
import catalogPreview from './entry-previews/catalog.webp';
import roulettePreview from './entry-previews/roulette.webp';
import clubMotion from './entry-previews/club.mp4';
import rouletteMotion from './entry-previews/roulette.mp4';
import './entry-modes.css';

export type EntryMode = 'club' | 'casino';
const isEntryMode = (value: unknown): value is EntryMode => value === 'club' || value === 'casino';

export function renderEntryPage(content: string) {
  const app = document.querySelector<HTMLElement>('#app')!;
  app.innerHTML = `
    <main class="entry-page">
      <header class="entry-header">
        <a class="entry-brand" href="/" aria-label="${t('Рояль')}">
          <span aria-hidden="true">♛</span> ${t('РОЯЛЬ')}<small>SOCIAL CASINO CLUB</small>
        </a>
      </header>
      ${content}
    </main>`;
  installLanguageSwitcher(app.querySelector<HTMLElement>('.entry-header')!);
  return app;
}

function installPreviewMotion(app: HTMLElement) {
  const clips = Array.from(app.querySelectorAll<HTMLVideoElement>('.entry-preview-motion'));
  const toggle = app.querySelector<HTMLButtonElement>('.entry-preview-toggle')!;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const visibleClips = new Set<HTMLVideoElement>();
  const visibleThreshold = 0.4;
  const listeners = new AbortController();
  const { signal } = listeners;
  let paused = false;

  const update = () => {
    toggle.hidden = reducedMotion.matches;
    toggle.textContent = t(paused ? 'Включить анимацию' : 'Приостановить анимацию');
    for (const clip of clips) {
      if (paused || document.hidden || reducedMotion.matches || !visibleClips.has(clip)) {
        clip.pause();
        continue;
      }
      if (!clip.getAttribute('src')) clip.src = clip.dataset.clip!;
      if (clip.paused) void clip.play().catch((error: unknown) => {
        if (!signal.aborted && error instanceof DOMException && error.name === 'NotAllowedError') {
          paused = true;
          update();
        }
      });
    }
  };

  const observer = new IntersectionObserver(entries => {
    if (signal.aborted) return;
    for (const { target, intersectionRatio } of entries) {
      const clip = target as HTMLVideoElement;
      if (intersectionRatio >= visibleThreshold) visibleClips.add(clip);
      else visibleClips.delete(clip);
    }
    update();
  }, { threshold: visibleThreshold });

  for (const clip of clips) {
    clip.muted = true;
    clip.addEventListener('playing', () => { clip.dataset.hasFrame = ''; }, { signal });
    observer.observe(clip);
  }
  toggle.addEventListener('click', () => { paused = !paused; update(); }, { signal });
  reducedMotion.addEventListener('change', update, { signal });
  document.addEventListener('visibilitychange', update, { signal });
  update();

  return () => {
    observer.disconnect();
    listeners.abort();
    for (const clip of clips) clip.pause();
  };
}

export function chooseEntryMode(focusMode?: EntryMode): Promise<EntryMode> {
  const linkedMode = new URL(location.href).searchParams.get('mode');
  const fromLink = (mode: EntryMode) => linkedMode === mode
    ? `<span class="entry-mode-hint">${t('Режим из ссылки')}</span>`
    : '';
  const app = renderEntryPage(`
    <section class="entry-content" aria-labelledby="entry-title">
      <h1 id="entry-title">${t('Как будешь играть?')}</h1>
      <div class="entry-options">
        <button type="button" class="entry-option entry-casino" data-entry-mode="casino" aria-labelledby="entry-casino-action" aria-describedby="entry-casino-description">
          <span class="entry-art entry-casino-art" aria-hidden="true">
            <img class="entry-catalog-preview" src="${catalogPreview}" alt="" width="550" height="340">
            <img class="entry-game-preview" src="${roulettePreview}" alt="" width="565" height="348">
            <video class="entry-game-preview entry-preview-motion" data-clip="${rouletteMotion}" width="568" height="350" muted loop playsinline preload="none"></video>
          </span>
          <span class="entry-copy">
            ${fromLink('casino')}
            <strong>${t('Сразу к играм')}</strong>
            <span class="entry-description" id="entry-casino-description">${t('Найди игру в каталоге и открой её в игровом окне. Общий чат будет рядом.')}</span>
            <b class="entry-action" id="entry-casino-action">${t('Открыть казино')} <span aria-hidden="true">↗</span></b>
          </span>
        </button>
        <button type="button" class="entry-option entry-club" data-entry-mode="club" aria-labelledby="entry-club-action" aria-describedby="entry-club-description">
          <span class="entry-art entry-club-art" aria-hidden="true">
            <img src="${barPreview}" alt="" width="370" height="220">
            <video class="entry-preview-motion" data-clip="${clubMotion}" width="640" height="336" muted loop playsinline preload="none"></video>
            <span class="entry-scene-label">${t('Рояль Бар')}</span>
          </span>
          <span class="entry-copy">
            ${fromLink('club')}
            <strong>${t('В клуб с персонажем')}</strong>
            <span class="entry-description" id="entry-club-description">${t('Гуляй по залам, загляни в бар, общайся и открывай игры прямо из клуба.')}</span>
            <b class="entry-action" id="entry-club-action">${t('Войти в клуб')} <span aria-hidden="true">↗</span></b>
          </span>
        </button>
      </div>
      <button type="button" class="entry-preview-toggle" hidden></button>
      <p class="entry-status" role="status"></p>
    </section>`);

  const buttons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-entry-mode]'));
  const status = app.querySelector<HTMLElement>('.entry-status')!;
  const stopPreviewMotion = installPreviewMotion(app);
  if (focusMode) app.querySelector<HTMLButtonElement>(`[data-entry-mode="${focusMode}"]`)?.focus();
  return new Promise(resolve => {
    for (const button of buttons) {
      button.onclick = () => {
        const mode = button.dataset.entryMode;
        if (!isEntryMode(mode)) return;
        stopPreviewMotion();
        app.querySelector('.entry-preview-toggle')?.remove();
        for (const option of buttons) option.disabled = true;
        status.textContent = t('Проверяем вход…');
        resolve(mode);
      };
    }
  });
}

export function installModeSwitcher(initial: EntryMode, change: (mode: EntryMode) => Promise<boolean | void>) {
  let current = initial, busy = false;
  const nav = document.createElement('nav'); nav.className = 'entry-mode-switcher'; nav.setAttribute('aria-label', t('Режим Royal'));
  nav.innerHTML = `<button type="button" data-view-mode="club">${t('Клуб')}</button><button type="button" data-view-mode="casino">${t('Казино')}</button>`;
  document.querySelector('.header .brand')?.after(nav);
  const render = () => nav.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.viewMode === current)); button.disabled = busy;
  });
  render();
  nav.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.onclick = async () => {
    const mode = button.dataset.viewMode;
    if (busy || !isEntryMode(mode) || mode === current) return;
    busy = true; render();
    try {
      if (await change(mode) === false) return;
      current = mode;
      const url = new URL(location.href); if (url.searchParams.has('mode')) { url.searchParams.set('mode', mode); history.replaceState(history.state, '', url); }
    } catch (error) { console.warn('Mode change failed', error); }
    finally { busy = false; render(); }
  });
}
