import type Phaser from 'phaser';
import { t } from '../i18n';
import type { LeapKind } from '../shared/leap';
import './leap-controls.css';

/** Touch buttons for the keyboard leaps: Space jumps, Shift + C slides. Hidden on precise pointers. */
export class LeapControls {
  private root = document.createElement('div');
  constructor(scene: Phaser.Scene, leap: (kind: LeapKind) => boolean) {
    this.root.className = 'leap-controls'; this.root.id = 'leap-controls';
    for (const [kind, label, hint] of [['jump', t('Прыжок'), t('Пробел')], ['slide', t('Подкат'), 'Shift + C']] as const) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.leap = kind; button.textContent = label;
      button.setAttribute('aria-label', `${label}, ${hint}`);
      // Pointer down responds without the click delay, which matters during a chase.
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        button.classList.toggle('refused', !leap(kind));
        setTimeout(() => button.classList.remove('refused'), 260);
      });
      this.root.append(button);
    }
    document.querySelector('.room-panel')?.append(this.root);
    scene.events.once('shutdown', () => this.root.remove());
  }
}
