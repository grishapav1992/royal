import type { GameModuleContextV1 } from '../../src/modules/GameHostContract';
import { language } from '../../src/i18n/index';
import { TSU_E_FA_CHOICES, type TsuEFaChoice } from '../../src/shared/tsuEFa';
import './tsu-e-fa.css';

type Context = NonNullable<GameModuleContextV1['pvp']>;
const copy = (ru: string, en: string) => language === 'en' ? en : ru;
const label = (choice: TsuEFaChoice) => ({ rock: copy('Камень', 'Rock'), scissors: copy('Ножницы', 'Scissors'), paper: copy('Бумага', 'Paper') })[choice];
const beats = (choice: TsuEFaChoice) => ({ rock: copy('Бьёт ножницы', 'Beats scissors'), scissors: copy('Режут бумагу', 'Cuts paper'), paper: copy('Накрывает камень', 'Covers rock') })[choice];
function icon(choice: TsuEFaChoice | null) {
  const shapes = choice === 'rock'
    ? '<path d="m24 60-7-16 4-12 13-7 25-2 16 10 5 22-12 18-26 3Z"/><path d="m21 32 22 15 16-24M43 47l-1 29m1-29 37 8M17 44l26 3"/>'
    : choice === 'paper'
      ? '<path d="M28 15h34l14 14v53H28Z"/><path d="M62 15v16h14M38 44h28M38 55h28M38 66h20"/>'
      : choice === 'scissors'
        ? '<circle cx="29" cy="69" r="12"/><circle cx="70" cy="69" r="12"/><path d="m36 59 36-43M62 59 26 16M44 48l11-1"/><circle cx="49" cy="45" r="3"/>'
        : '<rect x="27" y="40" width="46" height="40" rx="9"/><path d="M36 40V29a14 14 0 0 1 28 0v11"/><circle cx="50" cy="57" r="3"/><path d="M50 60v7"/>';
  return `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}
export class TsuEFaUI {
  private root = document.createElement('section');
  private unsubscribe: () => void;
  private key = '';
  private lastSeen = 0;
  constructor(host: HTMLElement, private context: Context) {
    this.root.className = 'tsu-game';
    this.root.setAttribute('aria-label', copy('Цу-е-фа: камень, ножницы, бумага', 'Rock Paper Scissors'));
    host.replaceChildren(this.root);
    this.unsubscribe = context.subscribe(() => this.render());
    this.render();
  }
  private render() {
    const snapshot = this.context.get(), state = snapshot?.tsuEFa, match = snapshot?.active;
    if (!state || !match || match.gameId !== 'tsu-e-fa') { this.root.textContent = copy('Восстанавливаем поединок…', 'Restoring duel…'); return; }
    const busy = this.context.busy(), key = JSON.stringify([state, match.status, match.reason, busy]);
    if (key === this.key) return;
    const fresh = !!this.key && !!state.last && state.last.round > this.lastSeen && document.visibilityState === 'visible';
    this.key = key; this.lastSeen = state.last?.round ?? 0;
    const self = state.self, other = self === 0 ? 1 : 0;
    const playing = match.status === 'playing' && state.phase === 'playing';
    const disabled = busy || !playing || state.locked[self];
    const status = !playing ? match.status === 'cancelled' ? copy('Поединок отменён. Ставки возвращены.', 'Duel cancelled. Stakes refunded.')
      : state.winner === null ? copy('Ничья. Ставки возвращены.', 'Draw. Stakes refunded.')
        : state.winner === self ? copy('Поединок твой!', 'You win the duel!') : copy('Соперник выиграл поединок', 'Opponent wins the duel')
      : busy ? copy('Подтверждаем выбор…', 'Confirming your choice…')
        : state.locked[self] ? copy('Твой выбор закрыт. Ждём соперника.', 'Your choice is locked. Waiting for your opponent.')
          : copy('Выбери знак. Соперник увидит его после своего выбора.', 'Choose a sign. Your opponent sees it after locking theirs.');
    const priorFocus = this.root.querySelector<HTMLButtonElement>(':focus')?.dataset.choice;
    const rulesOpen = this.root.querySelector('details')?.open;
    this.root.innerHTML = `<header class="tsu-heading"><div><span class="tsu-eyebrow">ROYAL · ${copy('ДУЭЛЬ', 'DUEL')}</span><h2>${copy('Цу-е-фа', 'Rock Paper Scissors')}</h2><p>${copy('Камень, ножницы, бумага', 'Make your move. Read your rival.')}</p></div><span class="tsu-round">${copy('РАУНД', 'ROUND')}<b>${String(state.round).padStart(2, '0')}</b></span></header>
      <div class="tsu-score"><span>${copy('ТЫ', 'YOU')}</span><strong aria-label="${copy('Счёт', 'Score')}">${state.score[self]} <i>:</i> ${state.score[other]}</strong><span>${copy('СОПЕРНИК', 'OPPONENT')}</span><small>${copy('ДО ДВУХ ПОБЕД', 'FIRST TO TWO WINS')}</small></div>
      <p class="tsu-status" role="status" aria-live="polite">${status}${!playing && ['timeout', 'disconnect', 'resign'].includes(match.reason) ? `<br><small>${match.reason === 'timeout' ? copy('Решил лимит времени на выбор.', 'Decided by the choice deadline.') : match.reason === 'disconnect' ? copy('Истекло время возвращения в игру.', 'The reconnect deadline expired.') : copy('Один из игроков сдался.', 'A player resigned.')}</small>` : ''}</p>
      ${playing ? `<div class="tsu-sealed"><span>${icon(state.choice)}<small>${state.choice ? label(state.choice) + ' · ' + copy('закрыт', 'locked') : copy('Твой знак', 'Your sign')}</small></span><b>VS</b><span>${icon(null)}<small>${state.locked[other] ? copy('Соперник готов', 'Opponent ready') : copy('Соперник выбирает', 'Opponent choosing')}</small></span></div>` : ''}
      ${state.last ? `<section class="tsu-result ${fresh ? 'tsu-reveal' : ''}" aria-label="${copy('Результат раунда', 'Round result')}"><small>${copy('РАУНД', 'ROUND')} ${state.last.round}</small><div><span>${icon(state.last.choices[self])}<b>${label(state.last.choices[self])}</b></span><strong>${state.last.winner === null ? copy('Ничья', 'Draw') : state.last.winner === self ? copy('Твоё очко', 'Your point') : copy('Очко соперника', 'Opponent point')}</strong><span>${icon(state.last.choices[other])}<b>${label(state.last.choices[other])}</b></span></div></section>` : ''}
      ${playing ? `<div class="tsu-choices" role="group" aria-label="${copy('Выбери знак', 'Choose your sign')}">${TSU_E_FA_CHOICES.map(choice => `<button type="button" data-choice="${choice}" aria-pressed="${state.choice === choice}" ${disabled ? 'disabled' : ''}>${icon(choice)}<strong>${label(choice)}</strong><small>${beats(choice)}</small></button>`).join('')}</div>` : ''}
      <details class="tsu-rules" ${rulesOpen ? 'open' : ''}><summary>${copy('Правила дуэли', 'Duel rules')}</summary><p>${copy('Камень бьёт ножницы, ножницы режут бумагу, бумага накрывает камень. До двух побед. Ничьи не меняют счёт и не требуют новой ставки. Выбор нельзя изменить, знаки раскрываются только после ответа обоих.', 'Rock beats scissors, scissors cut paper, paper covers rock. First to two wins. Ties do not change the score or require another stake. Choices are final and revealed only after both players lock theirs.')}</p><p>${copy('На выбор обоих 60 секунд. Выбрал один: он выигрывает поединок по времени. Не выбрал никто: ставки возвращаются. Комиссия 5% с общего банка при победе.', 'Both players have 60 seconds. If only one chooses, they win the duel on time. If neither chooses, stakes are refunded. A win pays the pot less a 5% fee.')}</p></details>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach(button => button.onclick = () => {
      if (!disabled) this.context.move({ kind: 'choose', round: state.round, choice: button.dataset.choice as TsuEFaChoice });
    });
    if (priorFocus) this.root.querySelector<HTMLButtonElement>(`[data-choice="${priorFocus}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }
  destroy() { this.unsubscribe(); this.root.remove(); }
}
