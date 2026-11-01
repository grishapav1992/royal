import { GamePriorityPanel } from './GamePriorityPanel';
import './action-game-priorities.css';

/** Keep the real host and its chat in charge of the available game rectangle. */
export class ActionGameLayout {
  private panel: GamePriorityPanel;
  private lifetime = new AbortController();
  constructor(private host: HTMLElement, private root: HTMLElement, trigger: HTMLButtonElement,
    nodes: HTMLElement[], title: string, closeLabel: string) {
    host.classList.add('action-game-host');
    this.panel = new GamePriorityPanel(root, trigger, title, closeLabel, nodes);
    root.addEventListener('click', event => {
      if ((event.target as Element).closest('[data-rules],[data-wardrobe],[data-gallery]')) this.panel.close();
    }, { capture: true, signal: this.lifetime.signal });
    root.addEventListener('close', event => {
      if (event.target instanceof HTMLDialogElement && !event.target.classList.contains('game-options-panel')
        && root.dataset.priorityLayout !== 'full') trigger.focus({ preventScroll: true });
    }, { capture: true, signal: this.lifetime.signal });
  }
  destroy() { this.lifetime.abort(); this.panel.destroy(); this.host.classList.remove('action-game-host'); }
}
