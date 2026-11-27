import Phaser from 'phaser';
import { t, language } from '../i18n';
import './street-play.css';

const COOLDOWN_MS = 4000;

/**
 * Tourist Lyonya's postcard: a snapshot of the real street render around the player,
 * without name labels, framed as a card the player can save. Nothing leaves the device.
 */
export class StreetPhoto {
  private dialog = document.createElement('aside');
  private image = document.createElement('img');
  private save = document.createElement('button');
  private again = document.createElement('button');
  private close = document.createElement('button');
  private flash = document.createElement('div');
  private url = '';
  private takenAt = 0;
  private open = false;
  private escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.open) { this.hide(); event.preventDefault(); } };
  constructor(private scene: Phaser.Scene, private retake: () => void) {
    this.dialog.className = 'street-postcard'; this.dialog.hidden = true; this.dialog.id = 'street-postcard';
    this.dialog.setAttribute('role', 'dialog'); this.dialog.setAttribute('aria-label', t('Открытка с улицы «Рояля»'));
    const card = document.createElement('div'); card.className = 'street-postcard-card';
    this.image.alt = t('Открытка: ты у входа в казино «Рояль»');
    const actions = document.createElement('div'); actions.className = 'street-postcard-actions';
    for (const button of [this.save, this.again, this.close]) { button.type = 'button'; actions.append(button); }
    this.save.textContent = t('Сохранить открытку'); this.again.textContent = t('Переснять'); this.close.textContent = t('Закрыть');
    this.save.onclick = () => this.download();
    this.again.onclick = () => { this.hide(); this.retake(); };
    this.close.onclick = () => this.hide();
    card.append(this.image, actions);
    this.dialog.append(card);
    this.flash.className = 'street-photo-flash'; this.flash.hidden = true;
    document.querySelector('.room-panel')?.append(this.dialog, this.flash);
    document.addEventListener('keydown', this.escape);
    scene.events.once('shutdown', () => { document.removeEventListener('keydown', this.escape); this.dialog.remove(); this.flash.remove(); if (this.url) URL.revokeObjectURL(this.url); });
  }
  get isOpen() { return this.open; }
  /** Captures the area around a screen point on the next rendered frame. */
  take(center: { x: number; y: number }, playerName: string, reducedMotion: boolean) {
    const now = performance.now();
    if (now < this.takenAt + COOLDOWN_MS) return false;
    this.takenAt = now;
    const scene = this.scene, renderer = scene.game.renderer, canvas = scene.game.canvas;
    const width = Math.min(canvas.width, Math.round(canvas.width * .9), 560), height = Math.min(canvas.height, Math.round(width * .72));
    const x = Math.round(Phaser.Math.Clamp(center.x - width / 2, 0, canvas.width - width)), y = Math.round(Phaser.Math.Clamp(center.y - height * .62, 0, canvas.height - height));
    // Labels are re-shown during each update, so they are hidden after the updates, right before this frame renders.
    scene.game.events.once(Phaser.Core.Events.PRE_RENDER, () => {
      const hidden = scene.children.list.filter((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text && o.visible);
      for (const text of hidden) text.setVisible(false);
      renderer.snapshotArea(x, y, width, height, shot => {
        for (const text of hidden) text.setVisible(true);
        if (!(shot instanceof HTMLImageElement)) return;
        const done = () => this.compose(shot, playerName);
        if (shot.complete && shot.naturalWidth) done(); else shot.onload = done;
      });
    });
    if (!reducedMotion) { this.flash.hidden = false; this.flash.classList.remove('street-photo-flash-run'); void this.flash.offsetWidth; this.flash.classList.add('street-photo-flash-run'); setTimeout(() => { this.flash.hidden = true; }, 450); }
    return true;
  }
  private compose(shot: HTMLImageElement, playerName: string) {
    const pad = 18, caption = 64, card = document.createElement('canvas');
    card.width = shot.width + pad * 2; card.height = shot.height + pad + caption;
    const c = card.getContext('2d')!;
    c.fillStyle = '#fffaf0'; c.fillRect(0, 0, card.width, card.height);
    c.drawImage(shot, pad, pad);
    c.strokeStyle = '#c39b58'; c.lineWidth = 2; c.strokeRect(pad - 1, pad - 1, shot.width + 2, shot.height + 2);
    c.fillStyle = '#7a1f3a'; c.font = 'bold 22px Georgia, serif'; c.textBaseline = 'middle';
    c.fillText(t('Привет с улицы «Рояля»!'), pad + 4, pad + shot.height + caption / 2 - 8);
    c.fillStyle = '#7d6a5c'; c.font = '13px Arial, sans-serif';
    const date = new Date().toLocaleDateString(language === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long' });
    c.fillText(`${playerName} · ${t('снимал турист Лёня')} · ${date}`, pad + 4, pad + shot.height + caption / 2 + 16);
    card.toBlob(blob => {
      if (!blob) return;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(blob); this.image.src = this.url;
      this.open = true; this.dialog.hidden = false; this.save.focus({ preventScroll: true });
    }, 'image/png');
  }
  private download() {
    if (!this.url) return;
    const link = document.createElement('a'); link.href = this.url; link.download = 'royal-postcard.png';
    document.body.append(link); link.click(); link.remove();
  }
  hide() { if (!this.open) return; this.open = false; this.dialog.hidden = true; this.scene.game.canvas.focus({ preventScroll: true }); }
  getState() { return { open: this.open, hasImage: Boolean(this.url) }; }
}
