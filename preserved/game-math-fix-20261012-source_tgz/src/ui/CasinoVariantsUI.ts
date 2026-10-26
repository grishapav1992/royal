import {
  VARIANT_NAMES, VARIANT_RULES, VARIANT_DEFAULTS, VARIANT_GEMS, VARIANT_GEM_NAMES,
  diceMultiplier, plinkoTable, sicBoMultiplier, gemMultiplier, gemWinChance, vaultMultiplier,
  type BaseVariantGameId, type VariantSettings, type VariantView, type VariantRisk, type VariantGem,
} from '../shared/casinoVariants';
import { DEMO_BETS } from '../shared/demoWallet';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import './casino-variants.css';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number = (value: number, digits = 2) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const amount = (units: string | number) => `${number(Number(units) / 100)} монет`;
const multi = (value: number) => `${number(value, 4)}×`;
const colors = ['#edcf69','#5acf9b','#65b7f0','#b096ee','#f3a574','#c7f4fc'];
const baseNames: Record<BaseVariantGameId, string> = {
  'variant-dice':'Вариант Dice','variant-plinko':'Вариант Плинко','variant-limbo':'Вариант Лимбо',
  'variant-mines':'Вариант Mines','variant-sic-bo':'Вариант Сик Бо','variant-diamonds':'Вариант Diamonds',
};
const introductions: Record<BaseVariantGameId, string> = {
  'variant-dice':'Выбирай ширину коридора. Узкая цель даёт больше за точное попадание.',
  'variant-plinko':'Два независимых пути. Половина ставки отправляется с каждым шариком.',
  'variant-limbo':'Один результат для двух половин ставки. Первый рубеж близко, второй выбираешь ты.',
  'variant-mines':'Вскрывай ячейки хранилища и забирай находки, пока не сработала ловушка.',
  'variant-sic-bo':'Три кости, одна точная сумма. Редкие сочетания дают большую выплату.',
  'variant-diamonds':'Выбери самоцвет. Найди хотя бы два таких среди пяти находок.',
};

function gem(index: number, label = '', muted = false): string {
  return `<svg class="variant-gem" viewBox="0 0 64 64" ${label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"'} style="--gem-color:${muted ? '#506b77' : colors[index] ?? colors[5]}"><path class="gem-outline" d="M14 10h36l11 18-29 29L3 28z"/><path class="gem-facet-light" d="M14 10h18L21 28H3zM32 10h18L43 28H21z"/><path class="gem-facet-dark" d="M3 28h18l11 29zM43 28h18L32 57z"/><path class="gem-highlight" d="M14 10 21 28 32 57 43 28 50 10M3 28h58M32 10 21 28M32 10 43 28"/></svg>`;
}

function die(value: number): string {
  const positions: Record<number, number[]> = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  return value ? `<span class="variant-ceramic-die" role="img" aria-label="Кость: ${value}">${Array.from({length:9}, (_, i) => `<i class="${positions[value]?.includes(i) ? '' : 'empty'}" aria-hidden="true"></i>`).join('')}</span>` : '<span class="variant-ceramic-die unknown" aria-label="Кость ещё не брошена">?</span>';
}

export class CasinoVariantsUI {
  private stake = '1000';
  private settings: VariantSettings;
  private error = '';
  private sessionId = '';
  private preview = false;
  private destroyed = false;
  private change = () => this.render();

  constructor(private host: HTMLElement, private game: BaseVariantGameId) {
    this.settings = structuredClone(VARIANT_DEFAULTS[game]);
    client.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
    this.render();
    void client.refresh();
  }

  private async run(operation: () => Promise<unknown>, resetPreview = false) {
    const focused = document.activeElement;
    const key = focused instanceof HTMLElement && this.host.contains(focused) ? focused.dataset.focus : undefined;
    this.error = '';
    if (resetPreview) this.preview = false;
    try { await operation(); } catch (e) { this.error = (e as Error).message; }
    this.render();
    if (!this.destroyed) this.restoreFocus(key);
  }

  private act(op: NewExpansionAction) { return this.run(() => client.act(op), true); }

  private choices(values: readonly (string | number)[], current: string | number, names: readonly string[], disabled: boolean): string {
    return `<div class="variant-choices" role="group" aria-label="Параметры игры">${values.map((value, i) => `<button type="button" data-setting="${value}" data-focus="setting-${value}" aria-pressed="${value === current}" ${disabled ? 'disabled' : ''}>${names[i]}</button>`).join('')}</div>`;
  }

  private metrics(firstLabel: string, firstValue: string, secondLabel: string, secondValue: string): string {
    return `<div class="variant-metrics"><div class="variant-metric"><span>${firstLabel}</span><strong>${firstValue}</strong></div><div class="variant-metric"><span>${secondLabel}</span><strong>${secondValue}</strong></div></div>`;
  }

  private board(view: VariantView | undefined, playing: boolean, disabled: boolean, turnBlocked: boolean): string {
    switch (this.game) {
      case 'variant-dice': {
        const result = view?.kind === 'dice' ? view : undefined;
        const width = result?.width ?? (this.settings.variant as {width:30|50|70}).width;
        const low = result?.low ?? 50 - width / 2, high = result?.high ?? 50 + width / 2;
        return `<div class="variant-stage"><span class="variant-board-label">Результат от 0 до 99,99</span><div class="variant-big-number">${result ? number(result.roll) : '00,00'}</div><div class="variant-corridor" role="img" aria-label="Коридор от ${low} до ${high}${result ? `, результат ${result.roll}` : ''}" style="--corridor-low:${low}%;--corridor-width:${width}%;${result ? `--corridor-roll:${result.roll}%;` : ''}"><span class="variant-corridor-zone"></span>${result ? '<span class="variant-corridor-ball"></span>' : ''}</div><div class="variant-ruler"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div><p class="variant-interval">${number(low)} ≤ результат &lt; ${number(high)}</p>${this.choices([30,50,70], width, ['Узкий · 30%','Средний · 50%','Широкий · 70%'], disabled)}${this.metrics('Вероятность попадания', `${width}%`, 'Выплата за попадание', multi(result?.multiplier ?? diceMultiplier(width)))}</div>`;
      }
      case 'variant-plinko': {
        const result = view?.kind === 'plinko' ? view : undefined;
        const risk = result?.risk ?? (this.settings.variant as {risk:VariantRisk}).risk, table = result?.table ?? plinkoTable(risk);
        const pegs = Array.from({length:12}, (_, row) => Array.from({length:row + 1}, (_, column) => `<circle class="peg" cx="${200 + (column - row / 2) * 22}" cy="${36 + row * 21}" r="2.6"/>`).join('')).join('');
        const balls = result?.balls ?? [];
        const paths = balls.map((ball, i) => {
          let x = 200;
          const points = ['200,15', ...ball.path.map((direction, row) => { x += direction ? 11 : -11; return `${x},${36 + row * 21}`; }), `${200 + (ball.bucket - 6) * 22},299`];
          return `<polyline class="variant-plinko-path ${i ? 'blue' : ''}" points="${points.join(' ')}"/><circle class="variant-plinko-ball ${i ? 'blue' : ''}" cx="${200 + (ball.bucket - 6) * 22}" cy="299" r="5"/>`;
        }).join('');
        const buckets = table.map((value, i) => {
          const hits = balls.map((ball, index) => ball.bucket === i ? index : -1).filter(index => index >= 0);
          return `<rect class="bucket ${hits.length ? `bucket-hit ${hits[0] ? 'blue' : ''}` : ''}" x="${200 + (i - 6) * 22 - 10}" y="283" width="20" height="33" rx="4"/><text class="bucket-number" x="${200 + (i - 6) * 22}" y="325">${number(value, 1)}×</text>`;
        }).join('');
        return `<div class="variant-stage">${this.choices(['low','medium','high'], risk, ['Спокойный','Средний','Высокий риск'], disabled)}<div class="variant-plinko-key"><span>Золотой поток · ½ ставки</span><span>Голубой поток · ½ ставки</span></div><svg class="variant-plinko-board" viewBox="30 0 340 340" role="img" aria-label="Плинко: 12 рядов, два независимых шарика"><title>Множители корзин: ${table.map(multi).join(', ')}</title>${buckets}${pegs}${paths}${!result ? '<circle class="variant-plinko-ball" cx="193" cy="15" r="5"/><circle class="variant-plinko-ball blue" cx="207" cy="15" r="5"/>' : ''}</svg>${this.metrics('Золотой шарик', balls[0] ? multi(balls[0].multiplier) : 'Ждёт броска', 'Голубой шарик', balls[1] ? multi(balls[1].multiplier) : 'Ждёт броска')}</div>`;
      }
      case 'variant-limbo': {
        const result = view?.kind === 'limbo' ? view : undefined;
        const target = result?.target ?? (this.settings.variant as {target:3|5|10}).target;
        const tickets = [1.5,target].map((value, i) => {
          const ticket = result?.tickets[i];
          return `<div class="variant-limbo-ticket ${ticket?.won ? 'won' : ''}"><small>${i ? 'Дальний рубеж' : 'Ближний рубеж'} · ½ ставки</small><strong>${multi(value)}</strong><span>${ticket ? ticket.won ? `Выплата ${amount(ticket.returnedUnits)}` : 'Рубеж не достигнут' : `При достижении: ${amount(Number(this.stake) / 2 * value)}`}</span><div class="variant-limbo-progress" style="--limbo-progress:${result ? Math.min(100, result.rolled / value * 100) : 0}%"><i></i></div></div>`;
        }).join('');
        return `<div class="variant-stage"><div class="variant-limbo-orbit"><div><span class="variant-big-number">${result ? multi(result.rolled) : '1,00×'}</span><small>${result ? 'РЕЗУЛЬТАТ РАУНДА' : 'ДВА РУБЕЖА ВПЕРЕДИ'}</small></div></div><div class="variant-limbo-tickets">${tickets}</div>${this.choices([3,5,10], target, ['Дальний · 3×','Дальний · 5×','Дальний · 10×'], disabled)}</div>`;
      }
      case 'variant-mines': {
        const result = view?.kind === 'mines' ? view : undefined;
        const cells = result?.cells ?? Array.from({length:16}, () => 'hidden' as const), opened = result?.opened.length ?? 0;
        const grid = cells.map((cell, index) => {
          const revealed = cell === 'safe' && !result?.opened.includes(index);
          const description = cell === 'safe' ? revealed ? 'безопасная, не открывалась' : 'безопасная, открыта' : cell === 'mine' ? 'ловушка' : 'закрыта, открыть';
          return `<button type="button" class="variant-vault-cell ${cell} ${revealed ? 'revealed' : ''}" data-cell="${index}" data-focus="cell-${index}" aria-label="Ячейка ${index + 1}: ${description}" ${!playing || turnBlocked || cell !== 'hidden' ? 'disabled' : ''}>${cell === 'safe' ? gem(0) : cell === 'mine' ? '<span aria-hidden="true">✹</span>' : '<span aria-hidden="true">⊞</span>'}</button>`;
        }).join('');
        return `<div class="variant-stage"><div class="variant-vault-header"><span class="variant-vault-lock">16 ячеек · 3 ловушки</span><span>${result && !playing ? 'Расположение раскрыто' : 'Забрать после первой'}</span></div><div class="variant-vault-grid" role="group" aria-label="Ячейки хранилища">${grid}</div><div class="variant-vault-count"><span>Находки: ${opened} из 6</span><span class="variant-vault-steps" aria-hidden="true">${Array.from({length:6}, (_, i) => `<i class="${i < opened ? 'done' : ''}"></i>`).join('')}</span></div>${this.metrics(result && !playing ? 'Итоговая выплата' : 'Можно забрать', amount(result?.cashoutUnits ?? '0'), result && !playing ? 'Итоговый множитель' : 'Следующая безопасная ячейка', multi(result && !playing ? result.multiplier : vaultMultiplier(Math.min(6, opened + 1))))}</div>`;
      }
      case 'variant-sic-bo': {
        const result = view?.kind === 'sic-bo' ? view : undefined;
        const sum = result?.sum ?? (this.settings.variant as {sum:number}).sum;
        return `<div class="variant-stage"><span class="variant-board-label">Выбери точную сумму</span><div class="variant-targets" role="group" aria-label="Сумма костей">${Array.from({length:16}, (_, i) => i + 3).map(value => `<button type="button" data-setting="${value}" data-focus="setting-${value}" aria-pressed="${value === sum}" ${disabled ? 'disabled' : ''}><strong>${value}</strong><small>${multi(sicBoMultiplier(value))}</small></button>`).join('')}</div><div class="variant-dice-tray">${(result?.dice ?? [0,0,0]).map(die).join('')}</div><p class="variant-dice-total">${result ? 'Сумма броска' : 'Три кости ждут броска'}<strong>${result?.total ?? '?'}</strong></p>${this.metrics('Твоя цель', String(sum), 'Выплата за совпадение', multi(result?.multiplier ?? sicBoMultiplier(sum)))}</div>`;
      }
      case 'variant-diamonds': {
        const result = view?.kind === 'diamonds' ? view : undefined;
        const target = result?.gem ?? (this.settings.variant as {gem:VariantGem}).gem;
        return `<div class="variant-stage"><span class="variant-board-label">Выбери самоцвет для охоты</span><div class="variant-gem-choices" role="group" aria-label="Самоцвет для охоты">${VARIANT_GEM_NAMES.map((name, index) => `<button type="button" class="variant-gem-choice" data-setting="${index}" data-focus="setting-${index}" aria-pressed="${target === index}" ${disabled ? 'disabled' : ''}>${gem(index)}<span>${name}</span></button>`).join('')}</div><div class="variant-gem-hand">${(result?.hand ?? ['','','','','']).map(symbol => {
          const index = VARIANT_GEMS.indexOf(symbol as typeof VARIANT_GEMS[number]), match = index === target;
          return `<div class="variant-gem-slot ${match ? 'match' : ''}">${gem(index < 0 ? 0 : index, index < 0 ? 'Самоцвет ещё не раскрыт' : VARIANT_GEM_NAMES[index], index < 0)}</div>`;
        }).join('')}</div><p class="variant-gem-match-count">${result ? 'Выбранных самоцветов найдено' : 'Нужно хотя бы два выбранных самоцвета'}<strong>${result ? `${result.matches} из 5` : '2+'}</strong></p>${this.metrics('Шанс найти хотя бы два', `${number(gemWinChance(target) * 100)}%`, 'Выплата за успех', multi(result?.multiplier ?? gemMultiplier(target)))}</div>`;
      }
    }
  }

  private restoreFocus(key: string | undefined) {
    if (!key) return;
    const previous = Array.from(this.host.querySelectorAll<HTMLElement>('[data-focus]')).find(element => element.dataset.focus === key && !(element instanceof HTMLButtonElement && element.disabled));
    const fallback = this.host.querySelector<HTMLElement>('[data-cell]:not(:disabled),.variant-primary:not(:disabled),[data-refresh]:not(:disabled)');
    (previous ?? fallback)?.focus({preventScroll:true});
  }

  private render() {
    if (this.destroyed) return;
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && this.host.contains(active) ? active.dataset.focus : undefined;
    const session = client.sessions.find(s => s.gameId === this.game);
    if (session?.id !== this.sessionId) {
      this.sessionId = session?.id ?? '';
      this.preview = false;
      if (session) {
        this.stake = session.stakeUnits;
        const v = session.view.variant;
        if (v?.kind === 'dice') this.settings = {variant:{width:v.width}};
        else if (v?.kind === 'plinko') this.settings = {variant:{risk:v.risk}};
        else if (v?.kind === 'limbo') this.settings = {variant:{target:v.target}};
        else if (v?.kind === 'sic-bo') this.settings = {variant:{sum:v.sum}};
        else if (v?.kind === 'diamonds') this.settings = {variant:{gem:v.gem}};
      }
    }
    const playing = session?.state === 'active', blocked = client.busy || !!client.pending;
    const balance = demoWallet.wallet?.balance ?? client.wallet?.balance, ready = !!client.accountId && balance !== undefined;
    const disabled = playing || blocked || client.loading;
    if (playing) this.stake = session.stakeUnits;
    const shown = this.preview ? undefined : session, view = shown?.view.variant;
    const status = !client.accountId ? 'Войди в аккаунт, чтобы играть на общий тестовый баланс.' : !ready ? 'Загружаем баланс…' : client.pending ? 'Подтверждаем ход. После обрыва связи нажми «Проверить ход».' : playing ? 'Партия сохранена. Открой ячейку или забери найденное.' : this.preview ? 'Новые условия выбраны. Начни следующий раунд.' : shown ? 'Раунд завершён. Выбери условия и сыграй ещё раз.' : 'Выбери условия и ставку, затем начни раунд.';
    const returned = shown?.returnedUnits ?? '0';
    const result = shown ? `<div class="variant-result"><div><strong>${escape(shown.view.message)}</strong><p>${playing ? 'Ставка в игре' : 'Ставка'}: ${amount(shown.spentUnits)}</p></div>${!playing ? `<div class="variant-return">${amount(returned)}<p>Выплачено</p></div>` : ''}</div>` : '';
    const title = playing ? 'Забрать находки' : session ? 'Играть ещё раз' : 'Начать игру';
    const cashout = session?.view.actions.find(action => action.move === 'cashout');
    const actions = playing ? `${cashout ? `<button type="button" class="variant-primary" data-cashout data-focus="cashout" ${blocked || !ready ? 'disabled' : ''}>${title} · ${amount(view?.kind === 'mines' ? view.cashoutUnits : '0')}</button>` : '<p class="variant-stake-note">Открой первую ячейку, чтобы забрать выплату.</p>'}` : `<button type="button" class="variant-primary" data-start data-focus="start" ${blocked || !ready || client.loading || Number(this.stake) > (balance ?? 0) * 100 ? 'disabled' : ''}>${title} · ${amount(this.stake)}</button>`;
    this.host.innerHTML = `<section class="casino-variants ${this.game}" aria-label="${escape(VARIANT_NAMES[this.game])}"><div class="variant-heading"><div><span class="variant-kicker">${baseNames[this.game]}</span><h3>${escape(VARIANT_NAMES[this.game])}</h3><p>${introductions[this.game]}</p></div><div class="variant-wallet"><small>Тестовый баланс</small><strong data-variant-balance>${balance === undefined ? '…' : number(balance)}</strong></div></div><div class="variant-controls"><label>Ставка<select data-stake data-focus="stake" ${disabled ? 'disabled' : ''}>${DEMO_BETS.map(value => `<option value="${value * 100}" ${String(value * 100) === this.stake ? 'selected' : ''}>${value} монет</option>`).join('')}</select></label><span class="variant-stake-note">${['variant-plinko','variant-limbo'].includes(this.game) ? `Две половины по ${amount(Number(this.stake) / 2)}` : 'Общий кошелёк клуба'}</span></div>${this.board(view, playing, disabled, blocked || !ready || client.loading)}${result}<div class="variant-actions">${actions}${client.pending ? `<button type="button" data-retry data-focus="retry" ${client.busy ? 'disabled' : ''}>Проверить ход</button>` : ''}<button type="button" data-refresh data-focus="refresh" ${client.busy || client.loading ? 'disabled' : ''}>Обновить</button></div><p class="variant-status" role="status">${status}</p><p class="variant-error" role="alert">${escape(this.error || client.error)}</p><details><summary>Правила и выплаты</summary><p>${escape(VARIANT_RULES[this.game])}</p><p class="variant-gross-note">Все множители показывают полную выплату вместе со ставкой. Выплаты округляются вниз до 0,01 монеты.</p><p>Ставки и выплаты проходят через общий тестовый кошелёк и видны в истории. Открытая партия хранилища сохраняется после закрытия окна и перезагрузки.</p></details></section>`;
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange = event => { this.stake = (event.target as HTMLSelectElement).value; this.preview = true; this.render(); };
    this.host.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach(button => button.onclick = () => {
      if (disabled) return;
      const value = button.dataset.setting!;
      switch (this.game) {
        case 'variant-dice': this.settings = {variant:{width:Number(value) as 30|50|70}}; break;
        case 'variant-plinko': this.settings = {variant:{risk:value as VariantRisk}}; break;
        case 'variant-limbo': this.settings = {variant:{target:Number(value) as 3|5|10}}; break;
        case 'variant-sic-bo': this.settings = {variant:{sum:Number(value)}}; break;
        case 'variant-diamonds': this.settings = {variant:{gem:Number(value) as VariantGem}}; break;
      }
      this.preview = true;
      this.render();
    });
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click', () => void this.act({gameId:this.game,action:'start',stakeUnits:this.stake,settings:this.settings}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => button.onclick = () => {
      if (!playing || blocked) return;
      void this.act({gameId:this.game,action:'move',sessionId:session.id,move:'reveal',picks:[Number(button.dataset.cell)]});
    });
    this.host.querySelector<HTMLButtonElement>('[data-cashout]')?.addEventListener('click', () => void this.act({gameId:this.game,action:'move',sessionId:session!.id,move:'cashout'}));
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click', () => void this.run(() => client.retry()));
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick = () => void this.run(() => client.refresh());
    this.restoreFocus(focusKey);
  }

  destroy() {
    this.destroyed = true;
    client.removeEventListener('change', this.change);
    demoWallet.removeEventListener('change', this.change);
    this.host.replaceChildren();
  }
}
