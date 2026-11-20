import { formatCents, validFreePicks, type SlotServicesV1, type SlotStatus } from './index.ts';
import type { SlotActionsV1, SlotFeedback, SlotPresentationActions } from './actions.ts';

export type ReelFrame = Readonly<{
  symbols: readonly number[];
  symbolsAfter?: readonly number[];
  highlights?: readonly number[];
  removed?: readonly number[];
  drops?: readonly Readonly<{ from: number; to: number; symbol: number }>[];
  refills?: readonly Readonly<{ position: number; symbol: number }>[];
}>;

export type ReelView = ReelFrame & Readonly<{
  columns: number;
  heights?: readonly number[];
  paylines?: readonly (readonly number[])[];
  held?: readonly number[];
  stages?: readonly ReelFrame[];
  features?: readonly string[];
}>;

const statusText: Record<SlotStatus, string> = {
  spin: 'Готово к новому спину.',
  continue: 'Раунд сохранён. Следующий ход бесплатный.',
  recover: 'Ответ не получен. Проверьте тот же ход.',
  busy: 'Проверяем ход…',
  blocked: 'Сначала завершите действие в другой игре или кошельке.',
  'signed-out': 'Войдите в Royal, чтобы начать игру.',
  'sync-required': 'Обновите состояние, чтобы проверить сохранённый раунд.',
  'unsupported-round': 'Сохранённый раунд нужно открыть в совместимой версии игры.',
};

const feedbackText: Record<SlotFeedback<ReelView>['type'], string> = {
  bet: 'Ставка подтверждена.',
  free: 'Бесплатный ход подтверждён.',
  loss: 'Раунд завершён без выплаты.',
  partial: 'Выплата меньше стоимости раунда.',
  return: 'Полная стоимость раунда возвращена.',
  win: 'Выигрыш больше стоимости раунда.',
  bigwin: 'Крупный выигрыш.',
};

export function mountSlot(
  root: HTMLElement,
  state: Pick<SlotServicesV1<ReelView>, 'apiVersion' | 'stakes' | 'read' | 'subscribe'>,
  commands: SlotActionsV1<ReelView>,
  effects: SlotPresentationActions<ReelView> = {},
): { destroy(): void; pause(): void; resume(): void } {
  if (state.apiVersion !== 1) throw Error('Unsupported slot services version');
  root.innerHTML = `<section class="slot-primitive" aria-label="Слот">
    <p data-slot-status role="status"></p>
    <p data-slot-feedback role="status" hidden></p>
    <label data-slot-stages-wrap hidden>Кадр результата<select data-slot-stages></select></label>
    <div data-slot-grid role="group" aria-label="Подтверждённые символы"></div>
    <p data-slot-features></p>
    <p data-slot-round></p>
    <p data-slot-balance></p>
    <form data-slot-form>
      <label>Ставка за раунд<input data-slot-stake type="text" inputmode="decimal" autocomplete="off" size="8"></label>
      <label>Готовые ставки<select data-slot-presets></select></label>
      <fieldset data-slot-free hidden><legend>Бесплатный ход</legend>
        <label>Действие<select data-slot-actions></select></label>
        <div data-slot-picks></div>
      </fieldset>
      <button type="submit" data-slot-action>Вращать</button>
      <button type="button" data-slot-refresh hidden>Обновить состояние</button>
    </form>
    <p data-slot-error role="alert"></p>
  </section>`;
  const find = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-slot-${name}]`)!;
  const draft = find<HTMLInputElement>('stake');
  const presets = find<HTMLSelectElement>('presets');
  const form = find<HTMLFormElement>('form');
  const primary = find<HTMLButtonElement>('action');
  const refresh = find<HTMLButtonElement>('refresh');
  const grid = find('grid');
  const stages = find<HTMLSelectElement>('stages');
  const actions = find<HTMLSelectElement>('actions');
  const choices = find('picks');
  const readPicks = () => Array.from(choices.querySelectorAll<HTMLInputElement>('input:checked:not([data-no-pick])'),
    input => Number(input.value));
  draft.value = formatCents(state.stakes.defaultCents);
  presets.append(new Option('Выбрать…', ''), ...state.stakes.presetsCents.map(cents => {
    const amount = formatCents(cents);
    return new Option(amount, amount);
  }));
  let destroyed = false;
  let paused = false;
  let running = false;
  let freeKey = '';
  let stageKey = '';
  let gridKey = '';
  let actionFailed = false;
  let playing: { event: SlotFeedback<ReelView>; controller: AbortController } | undefined;
  let unsubscribeFeedback: (() => void) | undefined;
  const feedback = find('feedback');
  const page = root.ownerDocument;

  function clearFeedback() {
    playing?.controller.abort();
    playing = undefined;
    feedback.hidden = true;
    feedback.textContent = '';
    delete feedback.dataset.kind;
  }

  function watchFeedback() {
    if (paused || page.hidden || destroyed) {
      unsubscribeFeedback?.();
      unsubscribeFeedback = undefined;
      clearFeedback();
    } else {
      unsubscribeFeedback ??= commands.subscribeFeedback(event => {
        if (paused || page.hidden || destroyed) return;
        const { status, round } = state.read();
        if (status === 'signed-out' || round?.id !== event.round.id || round.revision !== event.round.revision) return;
        render();
        playing ??= { event, controller: new AbortController() };
        const { signal } = playing.controller;
        feedback.hidden = false;
        feedback.dataset.kind = event.type;
        feedback.textContent = feedbackText[event.type];
        const effect = effects[event.type]?.(event, signal);
        void effect?.catch(error => { if (!signal.aborted) console.error('Slot presentation effect failed', error); });
      });
    }
  }

  function renderChoices() {
    const action = state.read().freeActions.find(option => option.id === actions.value);
    const options = action?.maxPicks === 1 && action.minPicks === 0
      ? [{ value: null, label: 'Без выбора' }, ...action.choices]
      : action?.choices ?? [];
    choices.replaceChildren(...options.map(choice => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = action?.maxPicks === 1 ? 'radio' : 'checkbox';
      input.name = 'slot-choice';
      if (choice.value === null) {
        input.dataset.noPick = '';
        input.checked = true;
      } else input.value = String(choice.value);
      label.append(input, choice.label);
      return label;
    }));
  }

  function render() {
    if (destroyed) return;
    const { status, round, freeActions, balanceLabel, error } = state.read();
    if (playing && (status === 'signed-out' || status === 'sync-required' || round?.id !== playing.event.round.id
      || round?.revision !== playing.event.round.revision)) clearFeedback();
    const invalid = status === 'spin' && state.stakes.parse(draft.value) === undefined;
    draft.disabled = paused || running || status !== 'spin';
    draft.setAttribute('aria-invalid', String(invalid));
    presets.disabled = draft.disabled;
    presets.value = draft.value;
    const nextFreeKey = JSON.stringify([round?.id, round?.revision, freeActions]);
    if (freeKey !== nextFreeKey) {
      freeKey = nextFreeKey;
      actions.replaceChildren(...freeActions.map(action => new Option(action.label, action.id)));
      renderChoices();
    }
    const action = freeActions.find(option => option.id === actions.value);
    find<HTMLFieldSetElement>('free').hidden = status !== 'continue';
    find<HTMLFieldSetElement>('free').disabled = paused || running;
    primary.textContent = status === 'recover' ? 'Проверить ход' : action?.label ?? 'Вращать';
    primary.disabled = paused || running || (status !== 'recover' && !(status === 'spin' && !invalid)
      && !(status === 'continue' && action && validFreePicks(action, readPicks())));
    refresh.hidden = status !== 'sync-required';
    refresh.disabled = paused || running;
    find('status').textContent = running ? statusText.busy : statusText[status];
    if (status === 'signed-out') actionFailed = false;
    find('error').textContent = invalid ? 'Введите разрешённую ставку из диапазона игры.'
      : error ?? (actionFailed ? 'Ход не подтверждён. Проверьте состояние перед следующим действием.' : '');
    find('balance').textContent = balanceLabel === null ? '' : `Баланс: ${balanceLabel}`;
    find('round').textContent = round ? `Ход ${round.revision}. Ставка: ${formatCents(round.stakeCents)}. `
      + `Списано: ${formatCents(round.spentCents)}. Начислено: ${formatCents(round.returnedCents)}.` : '';
    const view = round?.view;
    const frames = view?.stages ?? [];
    const nextStageKey = JSON.stringify([round?.id, round?.revision, frames.length]);
    if (stageKey !== nextStageKey) {
      stageKey = nextStageKey;
      stages.replaceChildren(new Option('Итоговое поле', '-1'), ...frames.map((_, i) => new Option(`Кадр ${i + 1}`, String(i))));
    }
    find('stages-wrap').hidden = frames.length === 0;
    const frame = frames[Number(stages.value)] ?? view;
    const columns = view?.columns ?? 1;
    find('features').textContent = view?.features?.join(' · ') ?? '';
    const nextGridKey = JSON.stringify([round?.id, round?.revision, stages.value, columns, frame?.symbols,
      view?.heights, frame?.highlights, frame?.removed, view?.held]);
    if (gridKey === nextGridKey) return;
    gridKey = nextGridKey;
    grid.style.setProperty('--slot-columns', String(columns));
    grid.replaceChildren(...(frame?.symbols.length ? frame.symbols.map((symbol, position) => {
      const tile = document.createElement('span');
      tile.textContent = String(symbol);
      const height = view?.heights?.[position % columns];
      if (height !== undefined && Math.floor(position / columns) >= height) {
        tile.dataset.void = '';
        tile.setAttribute('aria-hidden', 'true');
      }
      if (frame.highlights?.includes(position)) tile.dataset.highlighted = '';
      if (frame.removed?.includes(position)) tile.dataset.removed = '';
      if (view?.held?.includes(position)) tile.dataset.held = '';
      return tile;
    }) : ['Нет подтверждённых символов']));
  }

  async function run(action: () => Promise<void>) {
    if (destroyed || paused || running || page.hidden) return;
    clearFeedback();
    running = true;
    actionFailed = false;
    render();
    try { await action(); }
    catch { actionFailed = true; }
    finally { running = false; render(); }
  }

  form.onsubmit = event => {
    event.preventDefault();
    const { status, round, freeActions } = state.read();
    const action = freeActions.find(option => option.id === actions.value);
    const picks = readPicks();
    if (status === 'spin' && state.stakes.parse(draft.value) !== undefined) void run(() => commands.bet(draft.value));
    if (status === 'continue' && round && action && validFreePicks(action, picks)) void run(() => commands.playFree(round, action.id, picks));
    if (status === 'recover') void run(() => commands.recover());
  };
  draft.oninput = render;
  presets.onchange = () => { if (presets.value) draft.value = presets.value; render(); };
  actions.onchange = () => { renderChoices(); render(); };
  choices.onchange = render;
  stages.onchange = () => { clearFeedback(); render(); };
  refresh.onclick = () => void run(() => commands.refresh());
  const unsubscribe = state.subscribe(render);
  const onVisibility = () => { watchFeedback(); render(); };
  const setPaused = (value: boolean) => {
    if (destroyed) return;
    paused = value;
    onVisibility();
  };
  page.addEventListener('visibilitychange', onVisibility);
  onVisibility();
  const initial = state.read().status;
  if (initial === 'spin' || initial === 'continue' || initial === 'sync-required' || initial === 'unsupported-round') {
    void run(() => commands.refresh());
  }
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      page.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
      watchFeedback();
      root.replaceChildren();
    },
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  };
}
