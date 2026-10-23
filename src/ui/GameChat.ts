import './game-chat.css';
export function registerGameChatDialog(dialog:HTMLDialogElement){window.dispatchEvent(new CustomEvent('royal-game-chat-dialog',{detail:dialog}));}

/** Keep the connected chat beside the game inside the modal's interactive subtree. */
export function installGameChat(dock: HTMLElement, dialog: HTMLDialogElement) {
  const home = document.createComment('Club chat position');
  dock.before(home);
  dock.id = 'club-chat-dock';
  const dialogs = [dialog, document.querySelector<HTMLDialogElement>('#casinoapipro-dialog')]
    .filter((value): value is HTMLDialogElement => value !== null);
  const decorate=(window:HTMLDialogElement)=>{
    const game = document.createElement('div');
    game.className = 'game-chat-game';
    while (window.firstChild) game.append(window.firstChild);
    window.append(game);
    window.classList.add('game-chat-layout');
  };
  for(const window of dialogs)decorate(window);

  const sync = () => {
    const active = dialogs.find(window => window.isConnected&&window.open);
    if (active) {
      if (dock.parentElement !== active) active.append(dock);
      dock.classList.add('game-chat-dock');
    } else {
      if (dock.parentElement !== home.parentElement) home.after(dock);
      dock.classList.remove('game-chat-dock');
    }
    dock.hidden = false;
  };
  dock.addEventListener('keydown', event => {
    if (dialogs.some(window => window.open) && event.key === 'Escape' && !dock.querySelector('[data-chat-media-panel]:not([hidden])')) {
      event.preventDefault();
      event.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, true);
  for (const window of dialogs) {
    window.addEventListener('close', sync);
    new MutationObserver(sync).observe(window, { attributes: true, attributeFilter: ['open'] });
  }
  window.addEventListener('royal-game-chat-dialog',event=>{
    const dialog=(event as CustomEvent<HTMLDialogElement>).detail;
    if(dialogs.includes(dialog))return;decorate(dialog);dialogs.push(dialog);
    dialog.addEventListener('close',sync);new MutationObserver(sync).observe(dialog,{attributes:true,attributeFilter:['open']});sync();
  });
  sync();
}
