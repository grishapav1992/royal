import './game-chat.css';

/** Keep the same connected chat inside the modal's interactive subtree. */
export function installGameChat(dock: HTMLElement, dialog: HTMLDialogElement) {
  const home = document.createComment('Club chat position');
  dock.before(home);
  dock.id = 'club-chat-dock';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'game-chat-toggle';
  toggle.setAttribute('aria-label', 'Общий чат');
  toggle.setAttribute('title', 'Общий чат');
  toggle.setAttribute('aria-controls', dock.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></svg>';
  dialog.querySelector('.mini-top > [data-close]')!.before(toggle);

  const setExpanded = (expanded: boolean) => {
    dock.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    if (expanded) dock.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    else if (dock.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  };
  const sync = () => {
    if (dialog.open && dock.parentElement !== dialog) {
      dialog.append(dock);
      dock.classList.add('game-chat-dock');
      setExpanded(false);
    } else if (!dialog.open && dock.parentElement === dialog) {
      home.after(dock);
      dock.classList.remove('game-chat-dock');
      dock.hidden = false;
      toggle.setAttribute('aria-expanded', 'false');
    }
  };
  toggle.addEventListener('click', () => setExpanded(dock.hidden));
  dock.addEventListener('keydown', event => {
    if (dialog.open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      setExpanded(false);
    }
  }, true);
  dialog.addEventListener('cancel', event => {
    if (!dock.hidden && dock.parentElement === dialog) {
      event.preventDefault(); setExpanded(false); toggle.focus({ preventScroll: true });
    }
  });
  dialog.addEventListener('close', sync);
  new MutationObserver(sync).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  sync();
}
