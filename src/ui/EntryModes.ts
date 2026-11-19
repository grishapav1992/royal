import '../i18n/entryModesEn';
import { installLanguageSwitcher, t } from '../i18n/index';
import barPreview from './entry-previews/bar.webp';
import catalogPreview from './entry-previews/catalog.webp';
import roulettePreview from './entry-previews/roulette.webp';
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
      <p class="entry-status" role="status"></p>
    </section>`);

  const buttons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-entry-mode]'));
  const status = app.querySelector<HTMLElement>('.entry-status')!;
  if (focusMode) app.querySelector<HTMLButtonElement>(`[data-entry-mode="${focusMode}"]`)?.focus();
  return new Promise(resolve => {
    for (const button of buttons) {
      button.onclick = () => {
        const mode = button.dataset.entryMode;
        if (!isEntryMode(mode)) return;
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
