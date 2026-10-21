import { t } from '../i18n/index';
import type { RoomScene } from '../game/RoomScene';
import { IndependentGameUI } from './IndependentGameUI';

/** The hall owns navigation while the provider client is loaded independently. */
export class ProviderGameUI {
 private module?: IndependentGameUI;
 private loading?: HTMLDialogElement;
 private mounted = false;
 private requestOpen = () => this.scene.approach('casinoapipro');
 constructor(private scene: Pick<RoomScene, 'setLocked' | 'approach'>, private onPlaying: (playing: boolean) => void) {
  window.addEventListener('royal-open-casinoapipro', this.requestOpen);
 }
 open(atCabinet = false) {
  if (this.module) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'provider-module-loading'; dialog.className = 'capro-dialog';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = t('Вернуться в зал');
  close.onclick = () => dialog.close();
  const host = document.createElement('div');
  dialog.append(close, host); document.body.append(dialog);
  this.loading = dialog; this.mounted = false; this.scene.setLocked(true); dialog.showModal();
  dialog.addEventListener('close', () => {
   if (!this.mounted) { this.finish(); if (atCabinet) this.onPlaying(false); }
  });
  this.module = new IndependentGameUI(host, 'casinoapipro', {
   scene: this.scene, onPlaying: this.onPlaying,
   onMounted: () => { this.mounted = true; dialog.close(); },
   onClosed: () => this.finish(),
  });
 }
 private finish() {
  const module = this.module; this.module = undefined;
  this.mounted = true;
  module?.destroy(); this.loading?.close(); this.loading?.remove(); this.loading = undefined;
  this.scene.setLocked(!!document.querySelector('dialog[open]'));
  document.getElementById('game')?.focus({ preventScroll: true });
 }
 destroy() { this.finish(); window.removeEventListener('royal-open-casinoapipro', this.requestOpen); }
}
