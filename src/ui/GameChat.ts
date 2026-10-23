import './game-chat.css';

let registerDialog:((dialog:HTMLDialogElement)=>()=>void)|undefined;
export const registerGameChatDialog=(dialog:HTMLDialogElement)=>registerDialog?.(dialog)??(()=>{});

/** Keep the connected chat beside the game inside the modal's interactive subtree. */
export function installGameChat(dock: HTMLElement, dialog: HTMLDialogElement) {
  const home = document.createComment('Club chat position');
  dock.before(home);
  dock.id = 'club-chat-dock';
  const dialogs = [dialog, document.querySelector<HTMLDialogElement>('#casinoapipro-dialog')]
    .filter((value): value is HTMLDialogElement => value !== null);
  for (const window of dialogs) {
    const game = document.createElement('div');
    game.className = 'game-chat-game';
    while (window.firstChild) game.append(window.firstChild);
    window.append(game);
    window.classList.add('game-chat-layout');
  }

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
  registerDialog = window => {
    if(dialogs.includes(window))return ()=>{};
    const game = document.createElement('div');game.className='game-chat-game';
    while(window.firstChild)game.append(window.firstChild);
    window.append(game);window.classList.add('game-chat-layout');dialogs.push(window);
    const observer=new MutationObserver(sync);observer.observe(window,{attributes:true,attributeFilter:['open']});
    window.addEventListener('close',sync);sync();
    return ()=>{observer.disconnect();window.removeEventListener('close',sync);const index=dialogs.indexOf(window);if(index>=0)dialogs.splice(index,1);sync();};
  };
  sync();
}
