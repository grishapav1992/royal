import type { RoomScene } from '../game/RoomScene';

// A confirmed capture locks the player while the guard carries them to the street.
export class SecurityUI {
  constructor(private scene: Pick<RoomScene, 'setSecurity'>) {}
  capture() {
    for (const dialog of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))) dialog.close();
    this.scene.setSecurity(true);
    document.querySelector<HTMLInputElement>('#chat-input')?.blur();
  }
}
