import { CosmicEscapeUI } from '../../src/ui/CosmicEscapeUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/studio-games.css';
import { StudioSlotUI } from '../../src/ui/StudioSlotUI';
import { LuelonGameRouter } from '../../src/ui/LuelonGameRouter';
export const gameId = 'studio-cosmic-escape';
export const apiVersion = 1;
export const rulesVersion = 2;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 const runtime = readGameHost();
 if (runtime.cosmicStakeLimit !== 1) {
  const document = host.ownerDocument;
  const panel = document.createElement('div');
  panel.style.cssText = 'padding:32px;text-align:center;color:inherit';
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  const english = runtime.i18n.language === 'en';
  message.textContent = english ? 'Refresh the page to play Cosmic Escape.' : 'Обнови страницу, чтобы играть в Cosmic Escape.';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = english ? 'Refresh page' : 'Обновить страницу';
  refresh.onclick = () => document.defaultView?.location.reload();
  panel.append(message, refresh);
  host.replaceChildren(panel);
  return { destroy: () => panel.remove() };
 }
 return new LuelonGameRouter(host, gameId, body => new StudioSlotUI(body, gameId), body => new CosmicEscapeUI(body));
};

import '../../src/ui/active-game-viewport.css';
