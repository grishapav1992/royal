import type { Cabinet } from '../shared/cabinets';
import { watchCabinetDemoGame, type DemoGame } from '../game/demoGames';

export class DemoPreview {
  private game?: DemoGame;
  private near: Cabinet | null = null;
  private image = document.createElement('img');
  private version = 0;

  constructor() {
    this.image.className = 'interaction-cover';
    this.image.hidden = true;
    document.querySelector('#interaction')!.prepend(this.image);
    watchCabinetDemoGame(game => {
      this.game = game;
      const version = ++this.version;
      const card = document.querySelector<HTMLButtonElement>('[data-cabinet="luelon"]')!;
      card.querySelector('strong')!.textContent = game.name;
      card.querySelector('.card-kicker')!.textContent = 'LUELON PLAY · ДЕМОИГРЫ';
      card.setAttribute('aria-label', `Подойти к автомату ${game.name} (Luelon Play)`);
      const art = card.querySelector<HTMLElement>('.cabinet-art')!;
      const img = document.createElement('img');
      img.alt = `Обложка ${game.name}`; img.referrerPolicy = 'no-referrer';
      art.replaceChildren(); art.classList.remove('game-cover');
      img.onload = () => {
        if (version !== this.version) return;
        art.replaceChildren(img); art.classList.add('game-cover');
      };
      if (game.artworkUrl) img.src = game.artworkUrl;
      this.image.alt = `Обложка ${game.name}`;
      this.image.onload = () => this.updateNear(this.near);
      this.image.onerror = () => { this.image.hidden = true; };
      if (game.artworkUrl) this.image.src = game.artworkUrl;
      else this.image.removeAttribute('src');
      this.updateNear(this.near);
    });
  }

  updateNear(cabinet: Cabinet | null) {
    this.near = cabinet;
    const demo = !!cabinet?.demo;
    this.image.hidden = !demo || !this.game?.artworkUrl || !this.image.complete || !this.image.naturalWidth;
    if (demo && this.game) document.querySelector('#machine-name')!.textContent = this.game.name;
  }
}
