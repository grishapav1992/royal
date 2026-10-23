import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { Dracona } from './DraconaUI';
import { styles } from './styles';
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
  let game: Dracona | undefined;
  const stage = host.closest<HTMLElement>('.mini-stage') ?? host;
  const resize = new ResizeObserver(() => {
    if (!disposed) frame.style.height = Math.max(180, stage.clientHeight) + 'px';
  });
  resize.observe(stage);
  frame.style.height = Math.max(180, stage.clientHeight) + 'px';
  frame.addEventListener('load', () => {
    if (disposed || !frame.contentDocument) return;
    game?.destroy();
    const doc = frame.contentDocument;
    doc.documentElement.lang = readGameHost().i18n.language;
    doc.title = frame.title;
    const style = doc.createElement('style'); style.textContent = styles;
    doc.head.replaceChildren(style);
    const app = doc.createElement('div'); app.id = 'app';
    doc.body.replaceChildren(app);
    game = new Dracona(app);
  });
  frame.src = 'about:blank';
  host.replaceChildren(frame);
  return {
    getState: () => game?.getState() ?? { gameId, loading: true },
    destroy() { disposed = true; resize.disconnect(); game?.destroy(); frame.remove(); },
  };
};
