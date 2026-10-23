import { t as translateText, tr, locale } from '../i18n/index';
import { resetGameOutcomes } from './gameReactions';
import {CasinoConfirmedMotion} from './CasinoConfirmedMotion';
import {
  BATCH_VARIANT_NAMES, BATCH_VARIANT_RULES, BATCH_VARIANT_DEFAULTS,
  plinkoTargetWinningCount, plinkoTargetMultiplier, POKER_TARGET_COUNTS, pokerTargetMultiplier,
  BLACKJACK_TARGET_COUNTS, blackjackTargetMultiplier, collectionWinningCount, collectionMultiplier,
  doubleMinesMultiplier, streakMultiplier,
  type PlinkoTarget, type PokerTarget, type BlackjackTarget,
  type BatchVariantGameId, type BatchVariantSettings, type BatchVariantView,
} from '../shared/casinoBatchVariants';
import { DEMO_BETS } from '../shared/demoWallet';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import { emitExpansionDealer } from './CardDealerStage';
import { demoWallet } from '../wallet/WalletClient';
import './casino-batch-variants.css';

const escape = (value: string) => translateText(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const number = (value: number, digits = 2) => value.toLocaleString(locale, { maximumFractionDigits: digits });
const amount = (units: string | number) => tr`${number(Number(units) / 100)} USDT`;
const multi = (value: number) => `${number(value, 4)}×`;
const percent = (value: number) => `${number(value * 100)}%`;
const gemNames = [translateText('Цитрин'), translateText('Изумруд'), translateText('Сапфир'), translateText('Аметист'), translateText('Янтарь'), translateText('Алмаз')];
const gemColors = ['#ffc95d', '#73d9b3', '#6aa9ff', '#bd9aff', '#ff9375', '#e2f7ff'];
const intros: Record<BatchVariantGameId, string> = {
  'variant-target-plinko': translateText('Один шарик, три зоны. Выбери мишень до спуска и следи за его маршрутом.'),
  'variant-triple-poker': translateText('Три карты открываются вместе. Выбери комбинацию, на которую ставишь.'),
  'variant-blackjack-target': translateText('Три карты, одна цель. Выбери диапазон счёта до открытия расклада.'),
  'variant-gem-collection': translateText('Собери коллекцию из трёх разных самоцветов в пяти выпавших символах.'),
  'variant-double-mines': translateText('Открывай ячейки парами. Обе должны оказаться безопасными.'),
  'variant-dice-streak': translateText('Пять шагов на одной ставке. Меняй риск перед броском или забирай выплату.'),
};
const kickers: Record<BatchVariantGameId, string> = {
  'variant-target-plinko': translateText('ПЛИНКО / ВЫБОР ЗОНЫ'), 'variant-triple-poker': translateText('ПОКЕР / ТРИ КАРТЫ'),
  'variant-blackjack-target': translateText('21 / ВЫБОР СЧЁТА'), 'variant-gem-collection': translateText('САМОЦВЕТЫ / КОЛЛЕКЦИЯ'),
  'variant-double-mines': translateText('ХРАНИЛИЩЕ / ПАРНЫЙ ПОИСК'), 'variant-dice-streak': translateText('КОСТИ / СЕРИЯ УСПЕХОВ'),
};
const startLabels: Record<BatchVariantGameId, string> = {
  'variant-target-plinko': translateText('Запустить шарик'), 'variant-triple-poker': translateText('Открыть три карты'),
  'variant-blackjack-target': translateText('Открыть расклад'), 'variant-gem-collection': translateText('Искать коллекцию'),
  'variant-double-mines': translateText('Начать поиск'), 'variant-dice-streak': translateText('Начать серию'),
};

function card(value?: string, index = 0): string {
  if (!value) return tr`<div class="batch-card back" role="img" aria-label="Карта ${index + 1} ещё не раскрыта"><span aria-hidden="true">✦</span></div>`;
  const suit = value.slice(-1), rank = value.slice(0, -1);
  return tr`<div class="batch-card ${['♥', '♦'].includes(suit) ? 'red' : ''}" role="img" aria-label="Карта ${index + 1}: ${escape(value)}"><b>${escape(rank)}</b><span aria-hidden="true">${escape(suit)}</span><i aria-hidden="true">${escape(rank)}${escape(suit)}</i></div>`;
}

function gem(index: number, className = ''): string {
  return `<span class="batch-gem ${className}" style="--gem-color:${gemColors[index]}" role="img" aria-label="${gemNames[index]}"><i aria-hidden="true"></i></span>`;
}

function die(value?: number): string {
  const pips: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return `<div class="batch-die ${value ? '' : 'waiting'}" role="img" aria-label="${value ? tr`Кость: ${value}` : translateText('Кость ещё не брошена')}">${value ? Array.from({ length: 9 }, (_, i) => `<i class="${pips[value].includes(i) ? 'pip' : ''}" aria-hidden="true"></i>`).join('') : '<span aria-hidden="true">?</span>'}</div>`;
}

/** Results and cashout amounts always come from the saved server session. */
export class CasinoBatchVariantView {
  private motion?: CasinoConfirmedMotion;
  private stake = '1000';
  private settings: BatchVariantSettings;
  private selected = new Set<number>();
  private threshold: 2 | 3 | 4 = 3;
  private sessionId = '';
  private phase = -1;
  private preview = false;
  private error = '';
  private destroyed = false;
  private focusKey?: string;
  private change = () => this.render();

  constructor(private host: HTMLElement, private game: BatchVariantGameId) {
    resetGameOutcomes(host);
    this.settings = structuredClone(BATCH_VARIANT_DEFAULTS[game]);
    this.motion = CasinoConfirmedMotion.forGame(host, game, () => this.render());
    client.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
    this.render();
    void client.refresh();
  }

  private async run(operation: () => Promise<unknown>, action = false) {
    this.rememberFocus();
    this.error = '';
    if (action) this.preview = false;
    try {
      await operation();
      if (this.destroyed) return;
      if (action) this.selected.clear();
    } catch (error) {
      if (this.destroyed) return;
      this.error = (error as Error).message;
    }
    this.render();
  }

  private act(operation: NewExpansionAction) { if (this.motion?.active) return Promise.resolve(); return this.run(() => this.motion ? this.motion.run(operation, () => client.act(operation)) : client.act(operation), true); }

  private rememberFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.host.contains(active) && active.dataset.focus) this.focusKey = active.dataset.focus;
  }

  private restoreFocus() {
    if (!this.focusKey || this.destroyed || client.busy) return;
    const matching = Array.from(this.host.querySelectorAll<HTMLElement>('[data-focus]')).find(element => element.dataset.focus === this.focusKey && !(element instanceof HTMLButtonElement && element.disabled) && !(element instanceof HTMLSelectElement && element.disabled));
    const fallback = this.host.querySelector<HTMLElement>('[data-mine-cell]:not(:disabled),[data-threshold]:not(:disabled),[data-move]:not(:disabled),[data-start]:not(:disabled),[data-refresh]:not(:disabled)');
    (matching ?? fallback)?.focus({ preventScroll: true });
  }

  private choices(values: readonly string[], current: string, labels: readonly string[], captions: readonly string[], disabled: boolean, name: string): string {
    return `<div class="batch-choices" role="group" aria-label="${escape(name)}">${values.map((value, i) => `<button type="button" data-setting="${value}" data-focus="setting-${value}" aria-pressed="${current === value}" ${disabled ? 'disabled' : ''}><strong>${labels[i]}</strong><small>${captions[i]}</small></button>`).join('')}</div>`;
  }

  private metrics(firstLabel: string, firstValue: string, secondLabel: string, secondValue: string): string {
    return `<div class="batch-metrics"><div><span>${firstLabel}</span><strong>${firstValue}</strong></div><div><span>${secondLabel}</span><strong>${secondValue}</strong></div></div>`;
  }

  private board(view: BatchVariantView | undefined, playing: boolean, disabled: boolean, turnBlocked: boolean): string {
    switch (this.game) {
      case 'variant-target-plinko': {
        const result = view?.kind === 'target-plinko' ? view : undefined;
        const target = result?.target ?? (this.settings.variant as { target: PlinkoTarget }).target;
        const inTarget = (bucket: number) => target === 'center' ? bucket === 6 : target === 'corridor' ? bucket >= 4 && bucket <= 8 : bucket <= 2 || bucket >= 10;
        const pegs = Array.from({ length: 12 }, (_, row) => Array.from({ length: row + 1 }, (_, column) => `<circle cx="${195 + (column * 2 - row) * 13}" cy="${30 + row * 19}" r="2.7"/>`).join('')).join('');
        let x = 195;
        const path = ['195,11', ...(result?.path ?? []).map((direction, row) => { x += direction ? 13 : -13; return `${x},${30 + row * 19}`; }), ...(result ? [`${x},264`] : [])].join(' ');
        return tr`<div class="batch-stage batch-target-machine"><div class="batch-target-sign"><span>ОДИН ШАРИК</span><strong>ПОПАДИ В ЗОНУ</strong><span>12 РЯДОВ</span></div>${this.choices(['center', 'corridor', 'edges'], target, [translateText('Центр'), translateText('Коридор'), translateText('Края')], [translateText('Ячейка 6'), translateText('Ячейки 4-8'), translateText('0-2 или 10-12')], disabled, translateText('Мишень шарика'))}<div class="batch-plinko-board"><svg viewBox="0 0 390 275" role="img" aria-label="${result ? tr`Путь шарика, итоговая ячейка ${result.bucket}` : translateText('Шарик ждёт спуска через двенадцать рядов')}"><g class="batch-pegs">${pegs}</g>${result ? `<polyline class="batch-ball-path" points="${path}"/><circle class="batch-ball" cx="${x}" cy="264" r="6"/>` : '<circle class="batch-ball" cx="195" cy="11" r="6"/>'}</svg><div class="batch-target-buckets" role="group" aria-label="Ячейки мишени">${Array.from({ length: 13 }, (_, bucket) => tr`<span class="${inTarget(bucket) ? 'target' : ''} ${result?.bucket === bucket ? 'landed' : ''}" aria-label="Ячейка ${bucket}${inTarget(bucket) ? translateText(', в выбранной зоне') : ''}${result?.bucket === bucket ? translateText(', шарик здесь') : ''}">${bucket}</span>`).join('')}</div></div>${this.metrics(translateText('Вероятность попадания'), percent(Number(plinkoTargetWinningCount(target)) / 4096), translateText('Выплата за попадание'), multi(result?.multiplier ?? plinkoTargetMultiplier(target)))}<p class="batch-note">Шарик должен попасть в подсвеченную ячейку. На каждом ряду два равновероятных направления.</p></div>`;
      }
      case 'variant-triple-poker': {
        const result = view?.kind === 'triple-poker' ? view : undefined;
        const target = result?.target ?? (this.settings.variant as { target: PokerTarget }).target;
        return tr`<div class="batch-stage batch-poker-table"><div class="batch-table-trim"><span>THREE CARD CLUB</span><i aria-hidden="true">♠ ♥ ♣ ♦</i></div><div class="batch-three-cards" role="group" aria-label="Три карты расклада">${Array.from({ length: 3 }, (_, i) => card(result?.cards[i], i)).join('')}</div>${this.choices(['pair', 'flush', 'straight'], target, [translateText('Пара'), translateText('Флеш'), translateText('Стрит')], [translateText('Пара или тройка'), translateText('Три одной масти'), translateText('Три ранга подряд')], disabled, translateText('Комбинация трёх карт'))}${this.metrics(translateText('Вероятность комбинации'), percent(POKER_TARGET_COUNTS[target] / 22100), translateText('Выплата при совпадении'), multi(result?.multiplier ?? pokerTargetMultiplier(target)))}<p class="batch-note">Три разные карты из одной колоды. Туз участвует в А-2-3 и Д-К-А. Стрит-флеш подходит обеим целям.</p></div>`;
      }
      case 'variant-blackjack-target': {
        const result = view?.kind === 'blackjack-target' ? view : undefined;
        const target = result?.target ?? (this.settings.variant as { target: BlackjackTarget }).target;
        return tr`<div class="batch-stage batch-twentyone-table"><div class="batch-score-dial" role="img" aria-label="${result ? tr`Счёт трёх карт: ${result.total}` : translateText('Расклад ещё не открыт')}"><span>${result ? translateText('СЧЁТ РАСКЛАДА') : translateText('ТРОЙНОЙ РАСКЛАД')}</span><strong>${result ? result.total : target}</strong><small>${result ? result.total > 21 ? translateText('Перебор') : translateText('Три карты открыты') : translateText('Туз: 11 или 1')}</small></div><div class="batch-three-cards" role="group" aria-label="Карты тройного расклада">${Array.from({ length: 3 }, (_, i) => card(result?.cards[i], i)).join('')}</div>${this.choices(['17-18', '19-20', '21'], target, ['17-18', '19-20', translateText('Ровно 21')], [translateText('Первый диапазон'), translateText('Второй диапазон'), translateText('Точная сумма')], disabled, translateText('Целевой счёт трёх карт'))}${this.metrics(translateText('Вероятность цели'), percent(BLACKJACK_TARGET_COUNTS[target] / 22100), translateText('Выплата за цель'), multi(result?.multiplier ?? blackjackTargetMultiplier(target)))}<p class="batch-note">Ровно три карты, картинки стоят 10. Туз уменьшается с 11 до 1, когда это помогает избежать перебора.</p></div>`;
      }
      case 'variant-gem-collection': {
        const result = view?.kind === 'gem-collection' ? view : undefined;
        const selected = result?.gems ?? (this.settings.variant as { gems: number[] }).gems;
        const matches = result?.matches ?? [];
        return tr`<div class="batch-stage batch-collection-case"><div class="batch-collection-heading"><span>ВИТРИНА КОЛЛЕКЦИОНЕРА</span><strong>${result ? tr`${matches.filter(count => count > 0).length} из 3 найдены` : tr`${selected.length} из 3 выбраны`}</strong></div><div class="batch-collection-slots" role="group" aria-label="Выбранная коллекция">${Array.from({ length: 3 }, (_, i) => {
          const value = selected[i], hit = (matches[i] ?? 0) > 0;
          return `<div class="${hit ? 'found' : ''}">${value === undefined ? '<span class="batch-empty-gem" aria-hidden="true">◇</span>' : gem(value)}<strong>${value === undefined ? translateText('Выбери самоцвет') : gemNames[value]}</strong><small>${result ? hit ? translateText('Найден ✓') : translateText('Не найден') : tr`Предмет ${i + 1}`}</small></div>`;
        }).join('')}</div><div class="batch-gem-picker" role="group" aria-label="Самоцветы для коллекции">${gemNames.map((name, i) => `<button type="button" data-gem="${i}" data-focus="gem-${i}" aria-pressed="${selected.includes(i)}" aria-label="${name}${selected.includes(i) ? translateText(', в коллекции') : ''}" ${disabled ? 'disabled' : ''}>${gem(i)}<span>${name}</span></button>`).join('')}</div><div class="batch-collection-hand" role="group" aria-label="Пять выпавших самоцветов">${Array.from({ length: 5 }, (_, i) => `<div>${result ? gem(result.hand[i], selected.includes(result.hand[i]) ? 'selected' : '') : '<span class="batch-empty-gem" aria-hidden="true">◇</span>'}<small>${i + 1}</small></div>`).join('')}</div>${selected.length === 3 ? this.metrics(translateText('Вероятность коллекции'), percent(Number(collectionWinningCount(selected)) / 100 ** 5), translateText('Выплата за коллекцию'), multi(result?.multiplier ?? collectionMultiplier(selected))) : this.metrics(translateText('Для выигрыша'), translateText('Все 3 вида'), translateText('Выбери ещё'), String(3 - selected.length))}<p class="batch-note">Самоцветы имеют разную частоту. Один выбранный вид достаточно встретить хотя бы раз.</p></div>`;
      }
      case 'variant-double-mines': {
        const result = view?.kind === 'double-mines' ? view : undefined;
        const cells = result?.cells ?? Array.from({ length: 16 }, () => 'hidden' as const);
        const steps = result?.steps ?? 0;
        return tr`<div class="batch-stage batch-pair-vault"><div class="batch-vault-heading"><span>ПАРНЫЙ ПОИСК</span><strong>${playing ? translateText('Две ячейки за один ход') : translateText('16 ячеек, 4 ловушки')}</strong><small>${playing ? tr`${this.selected.size} из 2 выбраны` : translateText('До пяти безопасных пар')}</small></div><div class="batch-mines-grid" role="group" aria-label="Ячейки парного хранилища">${cells.map((cell, index) => {
          const selected = this.selected.has(index), opened = result?.picks.flat().includes(index) ?? false;
          const enabled = playing && cell === 'hidden' && !turnBlocked;
          const label = cell === 'mine' ? translateText('ловушка') : cell === 'safe' ? opened ? translateText('открыта безопасно') : translateText('безопасная') : selected ? translateText('выбрана') : translateText('закрыта');
          return tr`<button type="button" class="${cell} ${selected ? 'selected' : ''} ${opened ? 'opened' : ''}" data-cell="${index}" data-mine-cell="${index}" data-focus="mine-${index}" aria-pressed="${selected}" aria-label="Ячейка ${index + 1}: ${label}" ${enabled ? '' : 'disabled'}><span aria-hidden="true">${cell === 'mine' ? '✹' : cell === 'safe' ? opened ? '✓' : '◇' : selected ? '⌖' : '○'}</span><small>${index + 1}</small></button>`;
        }).join('')}</div><div class="batch-pair-progress" role="group" aria-label="Безопасные пары">${Array.from({ length: 5 }, (_, i) => tr`<span class="${i < steps ? 'complete' : playing && i === steps ? 'current' : ''}"><b>${i < steps ? '✓' : i + 1}</b><small>Пара</small></span>`).join('')}</div>${this.metrics(translateText('Безопасные пары'), tr`${steps} из 5`, playing ? translateText('Можно забрать') : translateText('Множитель партии'), playing ? amount(result?.cashoutUnits ?? '0') : multi(result?.multiplier ?? 0))}<p class="batch-next-payout">${playing ? translateText('Следующая безопасная пара') : translateText('Первая безопасная пара')}: <strong>${multi(doubleMinesMultiplier(playing ? Math.min(5, steps + 1) : 1))}</strong></p><p class="batch-note">Одна ловушка в выбранной паре завершает игру. Выплату можно забрать после первого успешного хода.</p></div>`;
      }
      case 'variant-dice-streak': {
        const result = view?.kind === 'dice-streak' ? view : undefined;
        const history = result?.history ?? [], steps = result?.steps ?? 0;
        return tr`<div class="batch-stage batch-dice-track"><div class="batch-dice-sign"><span>СТРОЙ СВОЮ СЕРИЮ</span><strong>${playing ? tr`Бросок ${Math.min(5, history.length + 1)} из 5` : translateText('Пять шагов к выплате')}</strong><small>Меняй риск перед каждым броском</small></div><div class="batch-dice-ladder" role="group" aria-label="История бросков">${Array.from({ length: 5 }, (_, i) => {
          const item = history[i];
          return `<div class="batch-dice-step ${item ? item.won ? 'safe' : 'lost' : playing && history.length === i ? 'current' : ''}"><span class="batch-step-number">${i + 1}</span>${die(item?.die)}<strong>${item ? `${item.threshold}+` : '·'}</strong><small>${item ? item.won ? translateText('Успех') : translateText('Провал') : translateText('Ждёт')}</small></div>`;
        }).join('')}</div><div class="batch-thresholds" role="group" aria-label="Условие следующего броска">${([2, 3, 4] as const).map(value => tr`<button type="button" data-threshold="${value}" data-focus="threshold-${value}" aria-pressed="${value === this.threshold}" ${turnBlocked ? 'disabled' : ''}><strong>${value}+</strong><span>${value === 2 ? translateText('Спокойно') : value === 3 ? translateText('Смелее') : translateText('Рискованно')}</span><small>Успех ${6 - value + 1} из 6</small></button>`).join('')}</div>${this.metrics(translateText('Успешные броски'), tr`${steps} из 5`, playing ? translateText('Можно забрать') : translateText('Множитель серии'), playing ? amount(result?.cashoutUnits ?? '0') : multi(result?.multiplier ?? 0))}<p class="batch-next-payout">${playing ? translateText('Следующий успешный бросок') : translateText('Первый успешный бросок')}: <strong>${multi(streakMultiplier([...(playing ? history : []), { die: this.threshold, threshold: this.threshold, won: true }]))}</strong></p><p class="batch-note">На кости должно выпасть выбранное число или больше. После успеха решай: новый бросок или выплата.</p></div>`;
      }
    }
  }

  private syncSettings(view: BatchVariantView) {
    if (view.kind === 'target-plinko' || view.kind === 'triple-poker' || view.kind === 'blackjack-target') this.settings = { variant: { target: view.target } };
    else if (view.kind === 'gem-collection') this.settings = { variant: { gems: [...view.gems] } };
    else if (view.kind === 'dice-streak' && view.history.length) this.threshold = view.history.at(-1)!.threshold;
  }

  private render() {
    if (this.destroyed || this.motion?.guardRender()) return;
    this.rememberFocus();
    const current = client.sessions.find(value => value.gameId === this.game);
    const session = this.motion ? this.motion.session(current) : current;
    if (session?.id !== this.sessionId) {
      this.sessionId = session?.id ?? '';
      this.preview = false;
      if (session) {
        this.stake = session.stakeUnits;
        if (session.view.variant) this.syncSettings(session.view.variant as BatchVariantView);
      }
    }
    if (session?.view.phase !== this.phase) {
      this.phase = session?.view.phase ?? -1;
      this.selected.clear();
    }
    const playing = session?.state === 'active', blocked = client.busy || !!client.pending || !!this.motion?.active;
    const balance = this.motion ? this.motion.balance(demoWallet.wallet?.balance ?? client.wallet?.balance) : demoWallet.wallet?.balance ?? client.wallet?.balance;
    const ready = !!client.accountId && balance !== undefined;
    const disabled = playing || blocked || client.loading;
    if (playing) this.stake = session.stakeUnits;
    const shown = this.preview ? undefined : session, view = shown?.view.variant as BatchVariantView | undefined;
    const selectionReady = this.game !== 'variant-gem-collection' || (this.settings.variant as { gems: number[] }).gems.length === 3;
    const actions = playing ? session.view.actions.map(action => {
      const selectionInvalid = action.move === 'reveal' && this.selected.size !== 2;
      const cashout = action.move === 'cashout' && (view?.kind === 'double-mines' || view?.kind === 'dice-streak') ? ` · ${amount(view.cashoutUnits)}` : '';
      return `<button type="button" class="${action.move === 'cashout' ? 'batch-cashout' : 'batch-primary'}" data-move="${escape(action.move)}" data-focus="move-${escape(action.move)}" ${blocked || !ready || client.loading || selectionInvalid || action.cost > (balance ?? 0) * 100 ? 'disabled' : ''}>${escape(action.label)}${action.move === 'roll' ? ` · ${this.threshold}+` : ''}${cashout}</button>`;
    }).join('') : `<button type="button" class="batch-primary" data-start data-focus="start" ${blocked || !ready || client.loading || !selectionReady || Number(this.stake) > (balance ?? 0) * 100 ? 'disabled' : ''}>${startLabels[this.game]} · ${amount(this.stake)}</button>`;
    let status = translateText('Выбери условия и ставку, затем начни игру.');
    if (!client.accountId) status = translateText('Войди в аккаунт, чтобы играть на общий тестовый баланс.');
    else if (!ready) status = translateText('Загружаем баланс…');
    else if (client.pending) status = translateText('Ход ожидает подтверждения. После обрыва связи нажми «Проверить ход».');
    else if (playing) status = this.game === 'variant-double-mines' ? tr`Партия сохранена. Выбери две закрытые ячейки${session.view.actions.some(action => action.move === 'cashout') ? translateText(' или забери выплату') : ''}.` : tr`Серия сохранена. Выбери риск броска${session.view.actions.some(action => action.move === 'cashout') ? translateText(' или забери выплату') : ''}.`;
    else if (!selectionReady) status = translateText('Для коллекции нужно выбрать ровно три разных самоцвета.');
    else if (this.preview) status = translateText('Условия изменены. Начни следующий раунд.');
    else if (shown) status = translateText('Раунд завершён. Выбери условия и сыграй ещё раз.');
    const result = shown ? tr`<div class="batch-result"><div><strong>${escape(shown.view.message)}</strong><p>Ставка партии: ${amount(shown.spentUnits)}</p></div>${!playing ? tr`<div class="batch-return">${amount(shown.returnedUnits)}<small>Выплачено</small></div>` : ''}</div>` : '';
    this.host.innerHTML = tr`<section class="casino-batch-variants ${this.game}" data-game="${this.game}" aria-label="${escape(BATCH_VARIANT_NAMES[this.game])}"><div class="batch-heading"><div><span class="batch-kicker">${kickers[this.game]}</span><h3>${escape(BATCH_VARIANT_NAMES[this.game])}</h3><p>${intros[this.game]}</p></div><div class="batch-wallet"><small>USDT · Nile</small><strong data-batch-balance>${balance === undefined ? '…' : number(balance)}</strong></div></div><div class="batch-controls"><label>Ставка<select data-stake data-focus="stake" ${disabled ? 'disabled' : ''}>${DEMO_BETS.map(value => tr`<option value="${value * 100}" ${String(value * 100) === this.stake ? 'selected' : ''}>${value} USDT</option>`).join('')}</select></label><span>Общий кошелёк клуба</span></div>${this.board(view, playing, disabled, blocked || !ready || client.loading)}${result}<div class="batch-actions">${actions}${client.pending ? tr`<button type="button" data-retry data-focus="retry" ${client.busy ? 'disabled' : ''}>Проверить ход</button>` : ''}<button type="button" data-refresh data-focus="refresh" ${client.busy || client.loading ? 'disabled' : ''}>Обновить</button></div><p class="batch-status" role="status">${status}</p><p class="batch-error" role="alert">${escape(this.error || client.error)}</p><details><summary data-focus="rules">Правила и выплаты</summary><p>${escape(BATCH_VARIANT_RULES[this.game])}</p><p>Множитель обозначает полную выплату со ставкой. Выплаты округляются вниз до 0,01 USDT.</p><p>Ставки и выплаты отражаются в общем тестовом кошельке. Парный поиск и серия костей сохраняются после закрытия окна и перезагрузки.</p></details></section>`;
    if (this.motion) this.motion.observeOutcome(current);
    else emitExpansionDealer(this.host,this.game,session,client.accountId,client.busy,!!client.pending);
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange = event => {
      this.stake = (event.target as HTMLSelectElement).value;
      this.preview = true;
      this.render();
    };
    this.host.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach(button => button.onclick = () => {
      if (disabled) return;
      this.settings = { variant: { target: button.dataset.setting! } } as BatchVariantSettings;
      this.preview = true;
      this.render();
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-gem]').forEach(button => button.onclick = () => {
      if (disabled || this.game !== 'variant-gem-collection') return;
      const value = Number(button.dataset.gem), gems = [...(this.settings.variant as { gems: number[] }).gems];
      if (gems.includes(value)) gems.splice(gems.indexOf(value), 1);
      else if (gems.length < 3) gems.push(value);
      else return;
      this.settings = { variant: { gems: gems.sort((a, b) => a - b) } };
      this.preview = true;
      this.render();
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-mine-cell]').forEach(button => button.onclick = () => {
      if (button.disabled || !playing || blocked) return;
      const value = Number(button.dataset.mineCell);
      if (this.selected.has(value)) this.selected.delete(value);
      else if (this.selected.size < 2) this.selected.add(value);
      else return;
      this.render();
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-threshold]').forEach(button => button.onclick = () => {
      if (button.disabled || blocked) return;
      this.threshold = Number(button.dataset.threshold) as 2 | 3 | 4;
      if (!playing) this.preview = true;
      this.render();
    });
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click', () => void this.act({ gameId: this.game, action: 'start', stakeUnits: this.stake, settings: this.settings }));
    this.host.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => button.onclick = () => {
      const move = button.dataset.move!;
      void this.act({ gameId: this.game, action: 'move', sessionId: session!.id, move, ...(move === 'reveal' ? { picks: [...this.selected].sort((a, b) => a - b) } : move === 'roll' ? { picks: [this.threshold] } : {}) });
    });
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click', () => void this.run(() => client.retry(), true));
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick = () => void this.run(() => client.refresh());
    this.motion?.paint();
    this.restoreFocus();
  }

  destroy() {
    this.motion?.destroy();
    this.destroyed = true;
    client.removeEventListener('change', this.change);
    demoWallet.removeEventListener('change', this.change);
    this.host.replaceChildren();
  }
}
