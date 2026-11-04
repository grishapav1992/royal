import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { Dracona } from './DraconaUI';
import { styles } from './styles';
import {requestStyles} from './requestStyles';
import './shell.css';

export const gameId = 'studio-dracona';
export const apiVersion = 1;
export const rulesVersion = 3;
export const progressVersion = 2;

export const mount: GameModuleV1['mount'] = host => {
  readGameHost();
  const frame = host.ownerDocument.createElement('iframe');
  frame.title = 'Дракона: Наследие Малфоев';
  frame.className = 'dracona-frame';
  let disposed = false;
  let paused = false;
  const feedbackLifetime = new AbortController();
  const syncRequest = () => {
    const doc=frame.contentDocument;
    if(doc?.body)doc.body.dataset.requestPaused=String(paused||doc.hidden||host.ownerDocument.hidden);
  };
  host.ownerDocument.addEventListener('visibilitychange',syncRequest,{signal:feedbackLifetime.signal});
  let game: Dracona | undefined;
  const stage = host.closest<HTMLElement>('.mini-stage') ?? host;
  const resize = new ResizeObserver(() => {
    if (!disposed) frame.style.height = Math.max(1, stage.clientHeight) + 'px';
  });
  resize.observe(stage);
  frame.style.height = Math.max(1, stage.clientHeight) + 'px';
  frame.addEventListener('load', () => {
    if (disposed || !frame.contentDocument) return;
    game?.destroy();
    const doc = frame.contentDocument;
    doc.documentElement.lang = readGameHost().i18n.language;
    doc.title = frame.title;
    const style = doc.createElement('style'); style.textContent = styles+requestStyles;
    doc.head.replaceChildren(style);
    const app = doc.createElement('div'); app.id = 'app';
    doc.body.replaceChildren(app);
    doc.addEventListener('visibilitychange',syncRequest,{signal:feedbackLifetime.signal});syncRequest();
    game = new Dracona(app);
  });
  frame.src = 'about:blank';
  host.replaceChildren(frame);
  return {
    getState: () => game?.getState() ?? { gameId, loading: true },
    pause() { paused=true;syncRequest(); },
    resume() { paused=false;syncRequest(); },
    destroy() { disposed = true; feedbackLifetime.abort(); resize.disconnect(); game?.destroy(); frame.remove(); },
  };
};
