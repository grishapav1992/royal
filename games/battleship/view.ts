import type { GameModuleContextV1 } from '../../src/modules/GameHostContract';
import { BATTLESHIP_SIZE, FLEET_LENGTHS, placeShip, type ShipPlacement, type Shot } from '../../src/shared/battleship';
import './battleship.css';

const letters = 'АБВГДЕЖЗИК';
const shotLabels = { miss: 'Мимо', hit: 'Ранен', sunk: 'Потоплен' };
const cellCount = BATTLESHIP_SIZE ** 2;

export class BattleshipView {
  private readonly unsubscribe: () => void;
  private draft: number[][] = [];
  private placements: ShipPlacement[] = [];
  private vertical = false;
  private renderKey = '';

  constructor(private root: HTMLElement, private context: NonNullable<GameModuleContextV1['pvp']>) {
    this.unsubscribe = context.subscribe(() => this.render());
    this.render();
  }

  private autoPlace() {
    const draft: number[][] = [];
    const placements: ShipPlacement[] = [];
    for (const length of FLEET_LENGTHS) {
      const candidates = [];
      for (let cell = 0; cell < cellCount; cell++) {
        for (const vertical of [false, true]) {
          const placement = { cell, vertical };
          const ship = placeShip(draft, placement, length);
          if (ship) candidates.push({ placement, ship });
        }
      }
      if (!candidates.length) return;
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      placements.push(next.placement);
      draft.push(next.ship);
    }
    this.placements = placements;
    this.draft = draft;
  }

  private grid(label: string, fleet: number[][], shots: Partial<Record<number, Shot>>, action: 'place' | 'fire' | null) {
    const occupied = new Set(fleet.flat());
    const length = FLEET_LENGTHS[this.draft.length];
    let markup = '<span></span>' + Array.from(letters, letter => `<span>${letter}</span>`).join('');
    for (let cell = 0; cell < cellCount; cell++) {
      if (cell % BATTLESHIP_SIZE === 0) markup += `<span>${cell / BATTLESHIP_SIZE + 1}</span>`;
      const shot = shots[cell];
      const status = shot ? shotLabels[shot] : occupied.has(cell) ? 'Корабль' : 'Вода';
      const name = `${letters[cell % BATTLESHIP_SIZE]}${Math.floor(cell / BATTLESHIP_SIZE) + 1}, ${status}`;
      const style = shot ?? (occupied.has(cell) ? 'ship' : 'water');
      const icon = shot === 'miss' ? '·' : shot === 'hit' ? '×' : shot === 'sunk' ? '■' : '';
      const valid = action === 'fire' ? !shot : action === 'place' && length && placeShip(fleet, { cell, vertical: this.vertical }, length);
      markup += action
        ? `<button type="button" data-${action}="${cell}" data-sea="${style}" aria-label="${name}" ${valid ? '' : 'disabled'}>${icon}</button>`
        : `<span data-sea="${style}" aria-label="${name}">${icon}</span>`;
    }
    return `<section class="battleship-board"><h3>${label}</h3><div class="battleship-grid">${markup}</div></section>`;
  }

  private render(force = false) {
    const snapshot = this.context.get(), view = snapshot?.battleship, match = snapshot?.active;
    if (!view || match?.gameId !== 'battleship') return;
    const paused = match.disconnected.length > 0, busy = this.context.busy();
    const key = [match.id, match.revision, view.revision, busy, paused].join(':');
    if (!force && this.renderKey === key) return;
    this.renderKey = key;
    const placing = view.phase === 'deploying' && !view.ownFleet.length;
    const myTurn = view.actor === view.self && !paused;
    const finished = view.phase === 'finished';
    const fleet = placing ? this.draft : view.ownFleet;
    const length = FLEET_LENGTHS[this.draft.length];
    const status = finished ? (match.winnerId ? (match.winnerId === (view.self === 0 ? match.creatorId : match.opponentId) ? 'Ты победил' : 'Соперник победил') : 'Партия завершена')
      : paused ? 'Связь прервалась. Ждём возвращения игрока'
      : view.phase === 'deploying' ? (placing ? 'Расставь свой флот' : 'Соперник расставляет флот')
      : myTurn ? 'Твой выстрел' : 'Выстрел соперника';
    this.root.innerHTML = `<section class="battleship" aria-label="Морской бой">
      <p class="battleship-turn" role="status">${status}</p>
      <div class="battleship-boards">${this.grid('Твой флот', fleet, view.incoming, placing && !busy ? 'place' : null)}
      ${view.phase !== 'deploying' ? this.grid(`Соперник · кораблей ${view.enemyShips}`, [], view.outgoing, view.phase === 'playing' && myTurn && !busy ? 'fire' : null) : ''}</div>
      ${placing ? `<p>${length ? `Следующий корабль на ${length} кл.` : myTurn ? 'Флот готов к выходу' : 'Флот готов. Ждём подтверждения соперника.'}</p>
      <div class="battleship-controls"><button type="button" data-rotate aria-pressed="${this.vertical}" ${busy ? 'disabled' : ''}>${this.vertical ? 'Вертикально' : 'Горизонтально'}</button>
      <button type="button" data-auto ${busy ? 'disabled' : ''}>Авторасстановка</button>
      <button type="button" data-undo ${!this.draft.length || busy ? 'disabled' : ''}>Убрать последний</button>
      <button type="button" class="primary-button" data-deploy ${length || !myTurn || busy ? 'disabled' : ''}>Подтвердить флот</button></div>` : ''}
      <details><summary>Правила</summary><p>Расставь 10 кораблей так, чтобы они не касались друг друга даже углами. После попадания стреляй снова, после промаха ход переходит сопернику. Побеждает тот, кто первым потопит весь чужой флот.</p>
      <p>На подтверждение флота 2 минуты, на выстрел 60 секунд. Пропуск срока завершает матч в пользу соперника.</p></details>
    </section>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-place]').forEach(button => button.onclick = () => {
      const placement = { cell: Number(button.dataset.place), vertical: this.vertical };
      const ship = length && placeShip(this.draft, placement, length);
      if (!ship) return;
      this.draft.push(ship);
      this.placements.push(placement);
      this.render(true);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-fire]').forEach(button => button.onclick =
      () => this.context.move({ kind: 'fire', cell: Number(button.dataset.fire) }));
    const bind = (selector: string, action: () => void) => {
      const button = this.root.querySelector<HTMLButtonElement>(selector);
      if (button) button.onclick = action;
    };
    bind('[data-rotate]', () => { this.vertical = !this.vertical; this.render(true); });
    bind('[data-auto]', () => { this.autoPlace(); this.render(true); });
    bind('[data-undo]', () => { this.draft.pop(); this.placements.pop(); this.render(true); });
    bind('[data-deploy]', () => this.context.move({ kind: 'deploy', fleet: [...this.placements] }));
  }

  destroy() {
    this.unsubscribe();
    this.root.replaceChildren();
  }
}
