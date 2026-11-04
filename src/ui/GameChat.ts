import { t } from '../i18n/index';
import { gameLayoutPolicy } from './GameLayoutPolicy';
import './game-chat.css';

let registerDialog: ((dialog: HTMLDialogElement) => () => void) | undefined;
export const registerGameChatDialog = (dialog: HTMLDialogElement) => registerDialog?.(dialog) ?? (() => {});

/** One connected chat is moved between the hall and the active game's modal subtree. */
export function installGameChat(dock: HTMLElement, dialog: HTMLDialogElement) {
  const home = document.createComment('Club chat position');
  dock.before(home);
  dock.id = 'club-chat-dock';
  const windows = new Map<HTMLDialogElement, { game: HTMLElement; toggle: HTMLButtonElement; scrim: HTMLElement }>();
  let active: HTMLDialogElement | undefined;
  let overlayOpen = false;
  let columnHidden = false;
  let unread = 0;
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'game-chat-close'; close.textContent = '×';
  close.setAttribute('aria-label', t('Закрыть чат'));
  dock.querySelector('.chat-heading')?.append(close);
  const policyFor = (window: HTMLDialogElement) => {
    const style = getComputedStyle(window);
    return gameLayoutPolicy(window.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      window.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  };

  const sync = () => {
    // Setup modals leave the connected chat in the hall until a game actually opens.
    const next = [...windows.keys()].filter(window => window.isConnected && window.open && !window.hasAttribute('data-game-chat-suspended')).at(-1);
    if (next !== active) { overlayOpen = false; active = next; }
    for (const [window, entry] of windows) {
      const policy = policyFor(window);
      const overlay = policy.chat === 'overlay';
      const visible = window === active && (overlay ? overlayOpen : !columnHidden);
      window.dataset.gameChat = overlay ? (visible ? 'overlay' : 'closed') : (visible ? 'column' : 'closed');
      window.dataset.gameComposition = policy.composition;
      entry.game.inert = visible && overlay;
      entry.scrim.hidden = !visible || !overlay;
      entry.toggle.setAttribute('aria-expanded', String(visible));
      entry.toggle.setAttribute('aria-label', t(visible ? 'Свернуть чат' : 'Открыть чат') + (unread ? ` (${unread})` : ''));
      entry.toggle.textContent = t('Чат') + (unread ? ` · ${unread > 99 ? '99+' : unread}` : '');
    }
    if (active) {
      if (dock.parentElement !== active) active.append(dock);
      dock.classList.add('game-chat-dock');
      dock.hidden = active.dataset.gameChat === 'closed';
      const overlay = active.dataset.gameChat === 'overlay';
      dock.setAttribute('role', overlay ? 'dialog' : 'complementary');
      if (overlay) dock.setAttribute('aria-modal', 'true'); else dock.removeAttribute('aria-modal');
      close.hidden = false;
    } else {
      if (dock.parentElement !== home.parentElement) home.after(dock);
      dock.classList.remove('game-chat-dock'); dock.hidden = false;
      dock.removeAttribute('role'); dock.removeAttribute('aria-modal'); close.hidden = true;
    }
  };
  const markRead = () => { if (!document.hidden && !dock.hidden) unread = 0; };
  const hide = () => {
    const entry = active && windows.get(active);
    overlayOpen = false;
    if (active && policyFor(active).chat === 'column') columnHidden = true;
    if (dock.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    sync(); entry?.toggle.focus({ preventScroll: true });
  };
  close.addEventListener('click', hide);
  const add = (window: HTMLDialogElement) => {
    if (windows.has(window)) return () => {};
    const game = document.createElement('div'); game.className = 'game-chat-game';
    while (window.firstChild) game.append(window.firstChild);
    window.append(game); window.classList.add('game-chat-layout');
    let toolbar = game.querySelector<HTMLElement>('.mini-top');
    if (!toolbar) { toolbar = document.createElement('div'); toolbar.className = 'game-chat-toolbar'; game.prepend(toolbar); }
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'game-chat-toggle'; toggle.setAttribute('aria-controls', dock.id);
    toolbar.insertBefore(toggle, toolbar.querySelector('[data-close]'));
    const settings = toolbar.querySelector('.settings-shortcut');
    if (settings) toolbar.insertBefore(settings, toggle);
    const title = toolbar.querySelector(':scope > div');
    if (title) {
      const mode = document.createElement('span'); mode.className = 'game-mode-badge'; mode.textContent = t('Демо'); title.append(mode);
    }
    const scrim = document.createElement('div'); scrim.className = 'game-chat-scrim'; scrim.hidden = true;
    scrim.addEventListener('click', hide); window.append(scrim);
    toggle.addEventListener('click', () => {
      const overlay = policyFor(window).chat === 'overlay';
      if (overlay) overlayOpen = !overlayOpen; else columnHidden = !columnHidden;
      sync(); markRead(); sync();
      if (!dock.hidden && overlay) close.focus({ preventScroll: true });
    });
    const observer = new MutationObserver(sync);
    observer.observe(window, { attributes: true, attributeFilter: ['open', 'data-game-chat-suspended'] });
    const resize = new ResizeObserver(() => {
      const hadFocus = dock.contains(document.activeElement);
      sync();
      if (hadFocus && dock.hidden) toggle.focus({ preventScroll: true });
      markRead(); sync();
    });
    resize.observe(window);
    const onClose = () => { overlayOpen = false; sync(); };
    window.addEventListener('close', onClose);
    const onKey = (event: KeyboardEvent) => {
      if (window !== active || dock.hidden || event.defaultPrevented) return;
      if (event.key === 'Escape' && !dock.querySelector('[data-chat-media-panel]:not([hidden])')) {
        if (window.dataset.gameChat === 'overlay') hide();
        else if (dock.contains(event.target as Node)) (document.activeElement as HTMLElement | null)?.blur();
        else return;
        event.preventDefault(); event.stopPropagation();
      }
      if (event.key === 'Tab' && window.dataset.gameChat === 'overlay') {
        const items = Array.from(dock.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]'))
          .filter(element => element.getClientRects().length && !element.closest('[hidden]'));
        const first = items[0], last = items.at(-1);
        if (!first) event.preventDefault();
        else if (!dock.contains(document.activeElement) || event.shiftKey && document.activeElement === first) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    windows.set(window, { game, toggle, scrim }); sync();
    return () => {
      observer.disconnect(); resize.disconnect(); window.removeEventListener('close', onClose);
      window.removeEventListener('keydown', onKey, true); windows.delete(window); sync();
    };
  };
  add(dialog);
  const provider = document.querySelector<HTMLDialogElement>('#casinoapipro-dialog');
  if (provider) add(provider);
  registerDialog = add;
  document.addEventListener('visibilitychange', () => { markRead(); sync(); });
  return {
    messageReceived() { if (active && (dock.hidden || document.hidden)) unread++; markRead(); sync(); },
    reset() { unread = 0; sync(); },
  };
}
