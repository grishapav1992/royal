import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { ForestHeartUI } from './ForestHeartUI';
import { styles } from './styles';
import './shell.css';

export const gameId = 'studio-forest-heart';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
  const language = readGameHost().i18n.language;
  const frame = host.ownerDocument.createElement('iframe');
  frame.className = 'forest-heart-frame';
  frame.title = language === 'en' ? 'Forest Heart' : 'Сердце леса';
  const stage = host.closest<HTMLElement>('.mini-stage') ?? host;
  let game: ForestHeartUI | undefined, disposed = false;
  const fit = () => { frame.style.height = Math.max(1, stage.clientHeight) + 'px'; };
  const observer = new ResizeObserver(fit); observer.observe(stage); fit();
  frame.addEventListener('load', () => {
    if (disposed || !frame.contentDocument) return;
    game?.destroy();
    const doc = frame.contentDocument; doc.documentElement.lang = language;
    const style = doc.createElement('style'); style.textContent = styles;
    doc.head.replaceChildren(style); const root = doc.createElement('div');
    doc.body.replaceChildren(root); game = new ForestHeartUI(root);
  });
  frame.src = 'about:blank'; host.replaceChildren(frame);
  return {
    getState: () => game?.getState() ?? { gameId, loading: true },
    pause: () => game?.pause(), resume: () => game?.resume(),
    destroy() { disposed = true; observer.disconnect(); game?.destroy(); frame.remove(); },
  };
};
