import '../i18n/entryModesEn';
import { t } from '../i18n/index';
import './entry-modes.css';

export type EntryMode = 'club' | 'casino';
const storageKey = 'royal-entry-mode';
export const isEntryMode = (value: unknown): value is EntryMode => value === 'club' || value === 'casino';
export function rememberEntryMode(mode: EntryMode | null) {
  try { if (mode) localStorage.setItem(storageKey, mode); else localStorage.removeItem(storageKey); } catch { /* Choice still works without storage. */ }
}
export async function chooseEntryMode(): Promise<EntryMode> {
  const url = new URL(location.href);
  if (url.searchParams.get('offline') === '1') return 'club';
  const explicit = url.searchParams.get('mode');
  if (isEntryMode(explicit)) return explicit;
  try { const saved = localStorage.getItem(storageKey); if (isEntryMode(saved)) return saved; } catch { /* Ask for this visit. */ }
  const app = document.querySelector<HTMLElement>('#app')!;
  app.innerHTML = `<main class="entry-page"><a class="entry-brand" href="/" aria-label="${t('Рояль')}"><span aria-hidden="true">♛</span> РОЯЛЬ<small>SOCIAL CASINO CLUB</small></a><section class="entry-content" aria-labelledby="entry-title"><span class="entry-eyebrow">${t('ТВОЙ ВЕЧЕР В ROYAL')}</span><h1 id="entry-title">${t('Как начнём?')}</h1><div class="entry-options"><button class="entry-option entry-club" data-entry-mode="club"><span class="entry-art entry-club-art" aria-hidden="true"><span class="entry-door">R</span><span class="entry-lamp"></span></span><span class="entry-copy"><small>${t('АТМОСФЕРА И ОБЩЕНИЕ')}</small><strong>${t('Войти в клуб')}</strong><span>${t('Гуляй персонажем, знакомься и находи любимые игры.')}</span><b>${t('Исследовать клуб')} <span aria-hidden="true">↗</span></b></span></button><button class="entry-option entry-casino" data-entry-mode="casino"><span class="entry-art entry-casino-art" aria-hidden="true"><span class="entry-card entry-card-back">♠</span><span class="entry-card">♦</span><span class="entry-chip">R</span></span><span class="entry-copy"><small>${t('СРАЗУ К ЛЮБИМЫМ ИГРАМ')}</small><strong>${t('Открыть казино')}</strong><span>${t('Выбирай игры в каталоге и общайся в общем чате.')}</span><b>${t('Открыть каталог')} <span aria-hidden="true">↗</span></b></span></button></div><label class="entry-remember"><input id="remember-entry-mode" type="checkbox">${t('Открывать выбранный режим при следующем входе')}</label></section><footer class="entry-footer">ROYAL <span>✦</span> ${t('Игры и люди в одном месте')}</footer></main>`;
  return new Promise(resolve => {
    app.querySelectorAll<HTMLButtonElement>('[data-entry-mode]').forEach(button => button.onclick = () => {
      const mode = button.dataset.entryMode;
      if (!isEntryMode(mode)) return;
      rememberEntryMode(app.querySelector<HTMLInputElement>('#remember-entry-mode')!.checked ? mode : null);
      resolve(mode);
    });
  });
}

export function installModeSwitcher(initial: EntryMode, change: (mode: EntryMode) => Promise<void | boolean>) {
  const nav = document.createElement('nav'); nav.className = 'entry-mode-switcher'; nav.setAttribute('aria-label', t('Режим Royal'));
  nav.innerHTML = `<button type="button" data-view-mode="club">${t('Клуб')}</button><button type="button" data-view-mode="casino">${t('Казино')}</button>`;
  document.querySelector('.header .brand')!.after(nav);
  let current = initial, busy = false;
  const preference = document.createElement('label'); preference.className = 'entry-mode-preference';
  const remember = document.createElement('input'); remember.type = 'checkbox';
  try { remember.checked = isEntryMode(localStorage.getItem(storageKey)); } catch { /* Optional preference. */ }
  preference.append(remember, t('Запоминать режим входа'));
  document.querySelector('#name-dialog h2')?.after(preference);
  remember.onchange = () => rememberEntryMode(remember.checked ? current : null);
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
      try { if (isEntryMode(localStorage.getItem(storageKey))) rememberEntryMode(mode); } catch { /* Optional preference. */ }
      const url = new URL(location.href); if (url.searchParams.has('mode')) { url.searchParams.set('mode', mode); history.replaceState(history.state, '', url); }
    } catch (error) { console.warn('Mode change failed', error); }
    finally { busy = false; render(); }
  });
}
