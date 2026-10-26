import { VARIANT_NAMES, VARIANT_RULES, VARIANT_DEFAULTS } from '../shared/casinoVariants';
import {
  kenoWinChance, kenoMultiplier, keysMultiplier, duelMultiplier, duelWinChance, warMultiplier, splitStakeUnits,
  type NextVariantGameId, type NextVariantSettings, type NextVariantView,
} from '../shared/casinoNextVariants';
import { FRUITS_PAYTABLE } from '../shared/gameCore';
import { DEMO_BETS } from '../shared/demoWallet';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import './casino-next-variants.css';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const number = (value: number, digits = 2) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const amount = (units: string | number) => `${number(Number(units) / 100)} монет`;
const multi = (value: number) => `${number(value, 4)}×`;
const percent = (value: number) => `${number(value * 100)}%`;
const fruitSymbols = ['🍒', '🍋', '🍇', '7'];
type DuelBand = 'tie' | 'near' | 'middle' | 'far';
type WarMode = 'shield' | 'attack';
const introductions: Record<NextVariantGameId, string> = {
  'variant-keno': 'Пять чисел в маленьком билете. Выбери цель и поймай совпадения.',
  'variant-color': 'Читай колоду, угадывай цвет и решай, когда забрать выплату.',
  'variant-keys': 'Два ключа на каждом этаже. Один из четырёх замков скрывает ловушку.',
  'variant-fruits': 'Выбери две или три линии. Каждая играет на свою часть одной ставки.',
  'variant-duel': 'Поставь на расстояние между рангами двух карт, прежде чем они откроются.',
  'variant-war': 'Два независимых фронта. Выбери защиту при ничьей или сильнее атакуй.',
};
const kickers: Record<NextVariantGameId, string> = {
  'variant-keno': 'Кено / маленький билет', 'variant-color': 'Hi-Lo / новая колода',
  'variant-keys': 'Dragon Tower / механика ключей', 'variant-fruits': 'Royal Fruits / больше линий',
  'variant-duel': 'Дракон и тигр / разница рангов', 'variant-war': 'Карточная война / два фронта',
};
const startLabels: Record<NextVariantGameId, string> = {
  'variant-keno': 'Разыграть билет', 'variant-color': 'Открыть колоду', 'variant-keys': 'Начать подъём',
  'variant-fruits': 'Крутить', 'variant-duel': 'Открыть карты', 'variant-war': 'Открыть оба фронта',
};

function card(value?: string, caption = ''): string {
  if (!value) return `<div class="next-playing-card back" role="img" aria-label="Карта ещё не раскрыта"><span aria-hidden="true">✧</span></div>`;
  const suit = value.slice(-1), rank = value.slice(0, -1), red = ['♥', '♦'].includes(suit);
  return `<div class="next-playing-card ${red ? 'red' : ''}" role="img" aria-label="${escape(caption ? `${caption}: ${value}` : value)}"><b>${escape(rank)}</b><span aria-hidden="true">${escape(suit)}</span><i aria-hidden="true">${escape(rank)}${escape(suit)}</i></div>`;
}

/** Server views supply all results and payouts; controls only choose the next request. */
export class CasinoNextVariantsUI {
  private stake = '1000';
  private settings: NextVariantSettings;
  private selected = new Set<number>();
  private error = '';
  private sessionId = '';
  private phase = -1;
  private preview = false;
  private destroyed = false;
  private focusKey?: string;
  private change = () => this.render();

  constructor(private host: HTMLElement, private game: NextVariantGameId) {
    this.settings = structuredClone(VARIANT_DEFAULTS[game]) as NextVariantSettings;
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
      if (action) this.selected.clear();
    } catch (e) { this.error = (e as Error).message; }
    this.render();
  }

  private act(operation: NewExpansionAction) { return this.run(() => client.act(operation), true); }

  private rememberFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.host.contains(active) && active.dataset.focus) this.focusKey = active.dataset.focus;
  }

  private restoreFocus() {
    if (!this.focusKey || this.destroyed || client.busy) return;
    const matching = Array.from(this.host.querySelectorAll<HTMLElement>('[data-focus]')).find(element => element.dataset.focus === this.focusKey && !(element instanceof HTMLButtonElement && element.disabled));
    const fallback = this.host.querySelector<HTMLElement>('[data-key-cell]:not(:disabled),[data-move]:not(:disabled),[data-start]:not(:disabled),[data-refresh]:not(:disabled)');
    (matching ?? fallback)?.focus({ preventScroll: true });
  }

  private choices(values: readonly (string | number)[], current: string | number, labels: readonly string[], disabled: boolean, name: string): string {
    return `<div class="next-choices" role="group" aria-label="${escape(name)}">${values.map((value, i) => `<button type="button" data-setting="${value}" data-focus="setting-${value}" aria-pressed="${value === current}" ${disabled ? 'disabled' : ''}>${labels[i]}</button>`).join('')}</div>`;
  }

  private metrics(firstLabel: string, firstValue: string, secondLabel: string, secondValue: string): string {
    return `<div class="next-metrics"><div><span>${firstLabel}</span><strong>${firstValue}</strong></div><div><span>${secondLabel}</span><strong>${secondValue}</strong></div></div>`;
  }

  private board(view: NextVariantView | undefined, playing: boolean, disabled: boolean, turnBlocked: boolean): string {
    switch (this.game) {
      case 'variant-keno': {
        const result = view?.kind === 'keno' ? view : undefined;
        const settings = this.settings.variant as { numbers: number[]; target: 2 | 3 };
        const numbers = result?.numbers ?? settings.numbers, target = result?.target ?? settings.target;
        const drawn = result?.drawn ?? [];
        return `<div class="next-stage next-ticket"><div class="next-ticket-stub"><span>БИЛЕТ НА ПЯТЬ ЧИСЕЛ</span><strong>${result ? `${result.hits} совпадений` : `${numbers.length} из 5 выбрано`}</strong><small>5 чисел выпадают из 20</small></div><div class="next-keno-grid" role="group" aria-label="Числа билета">${Array.from({ length: 20 }, (_, i) => i + 1).map(n => {
          const picked = numbers.includes(n), hit = picked && drawn.includes(n), isDrawn = drawn.includes(n);
          return `<button type="button" class="${picked ? 'picked' : ''} ${isDrawn ? 'drawn' : ''} ${hit ? 'hit' : ''}" data-number="${n}" data-focus="number-${n}" aria-pressed="${picked}" aria-label="Число ${n}${picked ? ', выбрано' : ''}${isDrawn ? ', выпало' : ''}${hit ? ', совпадение' : ''}" ${disabled ? 'disabled' : ''}>${n}${hit ? '<i aria-hidden="true">✦</i>' : ''}</button>`;
        }).join('')}</div><div class="next-ticket-legend"><span><i class="picked"></i>В билете</span><span><i class="drawn"></i>Выпало</span><span><i class="hit"></i>Совпало</span></div>${this.choices([2, 3], target, ['Хотя бы 2 совпадения', 'Хотя бы 3 совпадения'], disabled, 'Цель билета')}${this.metrics('Вероятность успеха', percent(kenoWinChance(target)), 'Выплата при успехе', multi(result?.multiplier ?? kenoMultiplier(target)))}</div>`;
      }
      case 'variant-color': {
        const result = view?.kind === 'color' ? view : undefined;
        const red = result?.redRemaining ?? 26, black = result?.blackRemaining ?? 26, total = red + black;
        const history = result?.history ?? [], steps = result?.steps ?? 0;
        return `<div class="next-stage next-color-table"><div class="next-deco-heading"><span>КОЛОДА ИЗ 52 КАРТ</span><i aria-hidden="true">♠ ♡</i><span>БЕЗ ВОЗВРАТА КАРТ</span></div><div class="next-color-counts"><div class="red"><span>Красных осталось</span><strong>${red}<small> / ${total}</small></strong><p>Следующая: ${percent(red / total)}</p></div><div><span>Чёрных осталось</span><strong>${black}<small> / ${total}</small></strong><p>Следующая: ${percent(black / total)}</p></div></div><div class="next-color-history" role="group" aria-label="Открытые карты и будущие закрытые шаги">${Array.from({ length: 6 }, (_, i) => {
          const step = history[i];
          return `<div class="next-color-step ${step ? step.won ? 'success' : 'failure' : ''}">${card(step?.card, `Шаг ${i + 1}`)}<span>${step ? `${step.prediction === 'red' ? 'Красное' : 'Чёрное'}${step.won ? ' ✓' : ' ✕'}` : `Шаг ${i + 1}`}</span></div>`;
        }).join('')}</div><p class="next-board-note">${playing ? steps ? 'Выбери цвет следующей карты или забери текущую выплату.' : 'Выбери цвет первой карты. Забрать выплату можно после первого успеха.' : result ? 'Открытые карты остаются в истории этой партии.' : 'Ставка сохраняется перед первым выбором цвета.'}</p>${this.metrics('Успешные шаги', `${steps} из 6`, playing ? steps ? 'Можно забрать' : 'Забрать после первого успеха' : 'Множитель партии', playing ? amount(result?.cashoutUnits ?? '0') : multi(result?.multiplier ?? 0))}</div>`;
      }
      case 'variant-keys': {
        const result = view?.kind === 'keys' ? view : undefined;
        const rows = result?.rows ?? Array.from({ length: 6 }, () => Array.from({ length: 4 }, () => 'hidden' as const));
        const step = result?.steps ?? 0;
        const floors = Array.from({ length: 6 }, (_, i) => 5 - i).map(row => `<div class="next-key-floor ${playing && row === step ? 'current' : ''}"><span class="next-floor-number">${row + 1}<small>этаж</small></span><div role="group" aria-label="Замки этажа ${row + 1}">${rows[row].map((cell, column) => {
          const selected = playing && row === step && this.selected.has(column), chosen = result?.picks[row]?.includes(column) ?? false;
          const enabled = playing && row === step && cell === 'hidden' && !turnBlocked;
          const label = cell === 'trap' ? 'ловушка' : cell === 'safe' ? chosen ? 'открыт безопасно' : 'безопасный' : selected ? 'ключ выбран' : 'закрытый замок';
          return `<button type="button" class="next-key-cell ${cell} ${selected ? 'selected' : ''} ${chosen ? 'used' : ''}" data-key-cell="${column}" data-row="${row}" data-focus="key-${row}-${column}" aria-pressed="${selected}" aria-label="Этаж ${row + 1}, замок ${column + 1}: ${label}" ${enabled ? '' : 'disabled'}><span class="next-lock-art" aria-hidden="true">${cell === 'trap' ? '✹' : cell === 'safe' && chosen ? '✓' : selected ? '⚿' : '○'}</span><small>${column + 1}</small></button>`;
        }).join('')}</div><i class="next-floor-link" aria-hidden="true"></i></div>`).join('');
        return `<div class="next-stage next-key-tower"><div class="next-key-heading"><span>МЕХАНИЧЕСКАЯ ЛЕСТНИЦА</span><strong>${playing ? `Два ключа на этаж ${step + 1}` : 'Шесть этажей вверх'}</strong><small>${playing ? `${this.selected.size} из 2 ключей выбрано` : 'Один опасный замок на каждом этаже'}</small></div><div class="next-key-floors">${floors}</div>${this.metrics(playing ? 'Можно забрать' : 'Множитель партии', playing ? amount(result?.cashoutUnits ?? '0') : multi(result?.multiplier ?? 0), result && !playing ? 'Максимум за шесть этажей' : 'Следующий безопасный этаж', multi(keysMultiplier(result && !playing ? 6 : Math.min(6, step + 1))))}</div>`;
      }
      case 'variant-fruits': {
        const result = view?.kind === 'fruits' ? view : undefined;
        const lines = result?.lines ?? (this.settings.variant as { lines: 2 | 3 }).lines;
        const portions = splitStakeUnits(this.stake, lines);
        const rows = Array.from({ length: 3 }, (_, i) => {
          const row = result?.rows[i], paid = i < lines;
          return `<div class="next-fruit-line ${paid ? 'paid' : 'off'} ${row && row.multiplier > 0 ? 'won' : ''}"><span class="next-line-number">${i + 1}<i aria-hidden="true">▶</i></span><div class="next-fruit-reels" role="img" aria-label="Линия ${i + 1}: ${!paid ? 'выключена' : row ? row.symbols.map(symbol => FRUITS_PAYTABLE[symbol].label).join(', ') : 'ещё не сыграна'}">${(row?.symbols ?? [0, 1, 2]).map(symbol => `<span class="${symbol === 3 ? 'seven' : ''}" aria-hidden="true">${paid ? fruitSymbols[symbol] : '·'}</span>`).join('')}</div><div class="next-line-stake"><strong>${paid ? amount(row?.stakeUnits ?? portions[i]) : 'Выключена'}</strong><small>${row ? `${multi(row.multiplier)} · ${amount(row.returnedUnits)}` : paid ? 'Часть общей ставки' : 'Не участвует'}</small></div></div>`;
        }).join('');
        return `<div class="next-stage next-fruit-machine"><div class="next-fruit-marquee"><i aria-hidden="true">✦</i><strong>FRUIT CLUB</strong><i aria-hidden="true">✦</i><span>ТРИ ЛИНИИ УДАЧИ</span></div>${this.choices([2, 3], lines, ['Две линии', 'Три линии'], disabled, 'Число оплаченных линий')}<div class="next-fruit-window">${rows}</div><div class="next-fruit-paytable">${FRUITS_PAYTABLE.map(row => `<span><b aria-hidden="true">${fruitSymbols[row.symbol]}</b><small>Три одинаковых</small><strong>${multi(row.multiplier)}</strong></span>`).join('')}</div><p class="next-board-note">Каждая линия независима. Множитель применяется к её части ставки.</p></div>`;
      }
      case 'variant-duel': {
        const result = view?.kind === 'duel' ? view : undefined;
        const band = result?.band ?? (this.settings.variant as { band: DuelBand }).band;
        const bands: { id: DuelBand; label: string; range: string }[] = [
          { id: 'tie', label: 'Равные', range: 'Разрыв 0' }, { id: 'near', label: 'Рядом', range: 'Разрыв 1-3' },
          { id: 'middle', label: 'Средний', range: 'Разрыв 4-7' }, { id: 'far', label: 'Далеко', range: 'Разрыв 8-12' },
        ];
        return `<div class="next-stage next-duel-arena"><div class="next-duel-cards"><div><span>ДРАКОН</span>${card(result?.dragon, 'Карта дракона')}</div><div class="next-duel-seal"><span aria-hidden="true">龍</span><small>${result ? `Разрыв ${result.gap}` : 'Туз младший'}</small></div><div><span>ТИГР</span>${card(result?.tiger, 'Карта тигра')}</div></div><div class="next-duel-scale" role="img" aria-label="Разница рангов от 0 до 12${result ? `, выпало ${result.gap}` : ''}">${Array.from({ length: 13 }, (_, gap) => `<span class="${result?.gap === gap ? 'actual' : ''}"><i aria-hidden="true"></i><b>${gap}</b></span>`).join('')}</div><div class="next-duel-bands" role="group" aria-label="Диапазон разницы рангов">${bands.map(option => `<button type="button" data-setting="${option.id}" data-focus="setting-${option.id}" aria-pressed="${option.id === band}" ${disabled ? 'disabled' : ''}><strong>${option.label}</strong><span>${option.range}</span><b>${multi(duelMultiplier(option.id))}</b><small>${percent(duelWinChance(option.id))}</small></button>`).join('')}</div>${this.metrics('Вероятность выбранного разрыва', percent(duelWinChance(band)), 'Выплата за попадание', multi(result?.multiplier ?? duelMultiplier(band)))}</div>`;
      }
      case 'variant-war': {
        const result = view?.kind === 'war' ? view : undefined;
        const mode = result?.mode ?? (this.settings.variant as { mode: WarMode }).mode;
        const portions = splitStakeUnits(this.stake, 2);
        return `<div class="next-stage next-war-map">${this.choices(['shield', 'attack'], mode, ['Щит: защита при ничьей', 'Атака: больше за победу'], disabled, 'Тактика двух фронтов')}<div class="next-war-fronts">${Array.from({ length: 2 }, (_, i) => {
          const front = result?.fronts[i], label = front ? ({ win: 'Победа', tie: 'Ничья', loss: 'Поражение' }[front.result]) : 'Ждёт открытия';
          return `<article class="next-war-front ${front?.result ?? ''}"><header><span class="next-war-flag" aria-hidden="true">⚑</span><strong>Фронт ${i + 1}</strong><small>${amount(front?.stakeUnits ?? portions[i])}</small></header><div class="next-war-pair"><div><span>Твоя карта</span>${card(front?.player)}</div><i aria-hidden="true">VS</i><div><span>Дилер</span>${card(front?.dealer)}</div></div><div class="next-front-result"><strong>${label}</strong><span>${front ? `${multi(front.multiplier)} · ${amount(front.returnedUnits)}` : `Победа ${multi(warMultiplier(mode, 'win'))}`}</span></div></article>`;
        }).join('')}</div>${this.metrics('Победа на одном фронте', multi(warMultiplier(mode, 'win')), 'Ничья на одном фронте', multi(warMultiplier(mode, 'tie')))}<p class="next-board-note">Каждый фронт получает половину ставки и отдельную колоду. Туз старший.</p></div>`;
      }
    }
  }

  private syncSettings(view: NextVariantView) {
    if (view.kind === 'keno') this.settings = { variant: { numbers: [...view.numbers], target: view.target } };
    else if (view.kind === 'fruits') this.settings = { variant: { lines: view.lines } };
    else if (view.kind === 'duel') this.settings = { variant: { band: view.band } };
    else if (view.kind === 'war') this.settings = { variant: { mode: view.mode } };
  }

  private render() {
    if (this.destroyed) return;
    this.rememberFocus();
    const session = client.sessions.find(s => s.gameId === this.game);
    if (session?.id !== this.sessionId) {
      this.sessionId = session?.id ?? '';
      this.preview = false;
      if (session) {
        this.stake = session.stakeUnits;
        if (session.view.variant) this.syncSettings(session.view.variant as NextVariantView);
      }
    }
    if (session?.view.phase !== this.phase) {
      this.phase = session?.view.phase ?? -1;
      this.selected.clear();
    }
    const playing = session?.state === 'active', blocked = client.busy || !!client.pending;
    const balance = demoWallet.wallet?.balance ?? client.wallet?.balance;
    const ready = !!client.accountId && balance !== undefined;
    const disabled = playing || blocked || client.loading;
    if (playing) this.stake = session.stakeUnits;
    const shown = this.preview ? undefined : session, view = shown?.view.variant as NextVariantView | undefined;
    const kenoReady = this.game !== 'variant-keno' || (this.settings.variant as { numbers: number[] }).numbers.length === 5;
    const actions = playing ? session.view.actions.map(action => {
      const selectionInvalid = action.maxPicks !== undefined && (this.selected.size < (action.minPicks ?? 0) || this.selected.size > action.maxPicks);
      const cashout = action.move === 'cashout' && (view?.kind === 'color' || view?.kind === 'keys') ? ` · ${amount(view.cashoutUnits)}` : '';
      return `<button type="button" class="${action.move === 'cashout' ? 'next-cashout' : 'next-primary'} ${action.move === 'red' ? 'red-choice' : action.move === 'black' ? 'black-choice' : ''}" data-move="${escape(action.move)}" data-focus="move-${escape(action.move)}" ${blocked || !ready || client.loading || selectionInvalid || action.cost > (balance ?? 0) * 100 ? 'disabled' : ''}>${escape(action.label)}${cashout}</button>`;
    }).join('') : `<button type="button" class="next-primary" data-start data-focus="start" ${blocked || !ready || client.loading || !kenoReady || Number(this.stake) > (balance ?? 0) * 100 ? 'disabled' : ''}>${startLabels[this.game]} · ${amount(this.stake)}</button>`;
    let status = 'Выбери условия и ставку, затем начни игру.';
    if (!client.accountId) status = 'Войди в аккаунт, чтобы играть на общий тестовый баланс.';
    else if (!ready) status = 'Загружаем баланс…';
    else if (client.pending) status = 'Подтверждаем ход. После обрыва связи нажми «Проверить ход».';
    else if (playing) {
      const canCashout = session.view.actions.some(action => action.move === 'cashout');
      status = this.game === 'variant-keys' ? `Партия сохранена. ${canCashout ? 'Выбери два ключа или забери выплату.' : 'Выбери два ключа и открой первую ступень.'}` : `Партия сохранена. ${canCashout ? 'Выбери следующий цвет или забери выплату.' : 'Выбери цвет первой карты.'}`;
    }
    else if (!kenoReady) status = 'В билете должно быть ровно пять чисел.';
    else if (this.preview) status = 'Условия изменены. Начни следующий раунд.';
    else if (shown) status = 'Раунд завершён. Выбери условия и сыграй ещё раз.';
    const result = shown ? `<div class="next-result"><div><strong>${escape(shown.view.message)}</strong><p>Общая ставка: ${amount(shown.spentUnits)}</p></div>${!playing ? `<div class="next-return">${amount(shown.returnedUnits)}<small>Выплачено</small></div>` : ''}</div>` : '';
    this.host.innerHTML = `<section class="casino-next-variants ${this.game}" data-game="${this.game}" aria-label="${escape(VARIANT_NAMES[this.game])}"><div class="next-heading"><div><span class="next-kicker">${kickers[this.game]}</span><h3>${escape(VARIANT_NAMES[this.game])}</h3><p>${introductions[this.game]}</p></div><div class="next-wallet"><small>Тестовый баланс</small><strong data-variant-balance>${balance === undefined ? '…' : number(balance)}</strong></div></div><div class="next-controls"><label>Общая ставка<select data-stake data-focus="stake" ${disabled ? 'disabled' : ''}>${DEMO_BETS.map(value => `<option value="${value * 100}" ${String(value * 100) === this.stake ? 'selected' : ''}>${value} монет</option>`).join('')}</select></label><span>Общий кошелёк клуба</span></div>${this.board(view, playing, disabled, blocked || !ready || client.loading)}${result}<div class="next-actions">${actions}${client.pending ? `<button type="button" data-retry data-focus="retry" ${client.busy ? 'disabled' : ''}>Проверить ход</button>` : ''}<button type="button" data-refresh data-focus="refresh" ${client.busy || client.loading ? 'disabled' : ''}>Обновить</button></div><p class="next-status" role="status">${status}</p><p class="next-error" role="alert">${escape(this.error || client.error)}</p><details><summary data-focus="rules">Правила и выплаты</summary><p>${escape(VARIANT_RULES[this.game])}</p><p>Все множители показывают полную выплату вместе со ставкой. Выплаты округляются вниз до 0,01 монеты.</p><p>Ставки и выплаты видны в общем тестовом кошельке. Партии «Красное / чёрное» и «Лестница: два ключа» сохраняются после закрытия окна и перезагрузки.</p></details></section>`;
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange = event => {
      this.stake = (event.target as HTMLSelectElement).value;
      this.preview = true;
      this.render();
    };
    this.host.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach(button => button.onclick = () => {
      if (disabled) return;
      const value = button.dataset.setting!;
      if (this.game === 'variant-keno') this.settings = { variant: { ...(this.settings.variant as { numbers: number[]; target: 2 | 3 }), target: Number(value) as 2 | 3 } };
      else if (this.game === 'variant-fruits') this.settings = { variant: { lines: Number(value) as 2 | 3 } };
      else if (this.game === 'variant-duel') this.settings = { variant: { band: value as DuelBand } };
      else if (this.game === 'variant-war') this.settings = { variant: { mode: value as WarMode } };
      this.preview = true;
      this.render();
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-number]').forEach(button => button.onclick = () => {
      if (disabled || this.game !== 'variant-keno') return;
      const value = Number(button.dataset.number), settings = this.settings.variant as { numbers: number[]; target: 2 | 3 };
      const numbers = [...settings.numbers];
      if (numbers.includes(value)) numbers.splice(numbers.indexOf(value), 1);
      else if (numbers.length < 5) numbers.push(value);
      else return;
      this.settings = { variant: { numbers: numbers.sort((a, b) => a - b), target: settings.target } };
      this.preview = true;
      this.render();
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-key-cell]').forEach(button => button.onclick = () => {
      if (button.disabled || !playing || blocked) return;
      const value = Number(button.dataset.keyCell);
      if (this.selected.has(value)) this.selected.delete(value);
      else if (this.selected.size < 2) this.selected.add(value);
      else return;
      this.render();
    });
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click', () => void this.act({ gameId: this.game, action: 'start', stakeUnits: this.stake, settings: this.settings }));
    this.host.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => button.onclick = () => {
      const move = button.dataset.move!;
      void this.act({ gameId: this.game, action: 'move', sessionId: session!.id, move, ...(move === 'unlock' ? { picks: [...this.selected].sort((a, b) => a - b) } : {}) });
    });
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click', () => void this.run(() => client.retry(), true));
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick = () => void this.run(() => client.refresh());
    this.restoreFocus();
  }

  destroy() {
    this.destroyed = true;
    client.removeEventListener('change', this.change);
    demoWallet.removeEventListener('change', this.change);
    this.host.replaceChildren();
  }
}
