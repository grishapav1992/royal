import { formatCents, type SlotRound, type SlotServicesV1 } from '../index.ts';
import type { SlotActionsV1, SlotFeedback } from '../actions.ts';
import { cosmicGlyph, cosmicSymbolNames, racerArtwork } from './artwork.ts';
import { COSMIC_COLUMNS, COSMIC_LINES, COSMIC_ROWS, type CosmicFrame, type CosmicView } from './view-model.ts';

type ReadState = Pick<SlotServicesV1<CosmicView>, 'apiVersion' | 'read' | 'subscribe' | 'stakes'>;
type ConfirmedRound = SlotRound<CosmicView>;
const counts = [10, 25, 50, 100];
const placeholder = Array.from({ length: COSMIC_COLUMNS * COSMIC_ROWS }, (_, index) => index % 7);
const amount = (cents: string) => formatCents(cents).replace('.', ',');

export function mountCosmic(host: HTMLElement, state: ReadState, commands: SlotActionsV1<CosmicView>) {
  if (state.apiVersion !== 1) throw Error('Нужен совместимый интерфейс слота.');
  const document = host.ownerDocument;
  const window = document.defaultView!;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.createElement('section');
  root.className = 'cosmic-cabinet';
  root.setAttribute('aria-label', 'Cosmic Escape');
  root.innerHTML = `
    <header class="cosmic-title"><div><h2>Cosmic Escape</h2><p data-cosmic="mode">Основная игра · ${COSMIC_LINES} линий</p></div>
      <button type="button" data-cosmic="info">Об игре</button></header>
    <div class="cosmic-racer">${racerArtwork}<span>Гонщица звёздной трассы</span></div>
    <div class="cosmic-stage">
      <div class="cosmic-frame"><div class="cosmic-grid" data-cosmic="board" role="group" aria-label="Пять барабанов, три ряда"></div></div>
      <p data-cosmic="cue" class="cosmic-cue" hidden></p>
    </div>
    <aside class="cosmic-instruments" aria-label="Порталы и энергия">
      <section class="cosmic-portals"><h3>Порталы <output data-cosmic="portals">0 / 5</output></h3>
        <div class="cosmic-dots" aria-hidden="true">${Array.from({ length: 5 }, () => `<i>${cosmicGlyph(8)}</i>`).join('')}</div>
        <p>3 дают 10 · 4 дают 12 · 5 дают 15</p></section>
      <section class="cosmic-energy"><h3>Энергия <output data-cosmic="energy">×1</output></h3><p>Множитель линии</p></section>
      <span class="cosmic-missions" title="Платные миссии не входят в пилот">Миссии · вне пилота</span>
    </aside>
    <div class="cosmic-response"><p data-cosmic="status" role="status" aria-live="polite"></p></div>
    <form class="cosmic-controls" data-cosmic="form">
      <div class="cosmic-balance"><span>Баланс</span><output data-cosmic="balance">0,00</output></div>
      <div class="cosmic-return"><span data-cosmic="return-label">Возврат</span><output data-cosmic="return">0,00</output></div>
      <div class="cosmic-stake"><label>Ставка на ${COSMIC_LINES} линий<input data-cosmic="stake" inputmode="decimal" autocomplete="off"></label>
        <select data-cosmic="presets" aria-label="Пресеты ставки"></select></div>
      <button type="button" class="cosmic-auto" data-cosmic="auto">Авто</button>
      <button type="submit" class="cosmic-primary" data-cosmic="primary">Вращать</button>
      <button type="button" class="cosmic-speed" data-cosmic="speed" aria-pressed="false">Обычно</button>
    </form>
    <dialog data-cosmic="auto-dialog" aria-label="Автоигра"><h3>Автоигра</h3>
      <label>Количество платных вращений<select data-cosmic="count">${counts.map(count => `<option>${count}</option>`).join('')}</select></label>
      <div class="cosmic-dialog-actions"><form method="dialog"><button>Отмена</button></form>
      <button type="button" data-cosmic="auto-start">Запустить</button></div></dialog>
    <dialog data-cosmic="info-dialog" aria-label="Об игре"><h3>Об игре</h3>
      <p>Одна ставка за полный раунд на ${COSMIC_LINES} линиях. Порталы открывают бесплатную серию, энергия меняет подтверждённый множитель. В этом стенде все исходы фиксированы.</p>
      <form method="dialog"><button>Закрыть</button></form></dialog>`;
  host.append(root);
  const find = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-cosmic="${name}"]`)!;
  const board = find('board');
  const stake = find<HTMLInputElement>('stake');
  const presets = find<HTMLSelectElement>('presets');
  const primary = find<HTMLButtonElement>('primary');
  const auto = find<HTMLButtonElement>('auto');
  const speed = find<HTMLButtonElement>('speed');
  const autoDialog = find<HTMLDialogElement>('auto-dialog');
  const infoDialog = find<HTMLDialogElement>('info-dialog');
  const cells = placeholder.map(() => document.createElement('span'));
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(line.namespaceURI!, 'polyline');
  line.setAttribute('viewBox', `0 0 ${COSMIC_COLUMNS} ${COSMIC_ROWS}`);
  line.setAttribute('preserveAspectRatio', 'none');
  line.setAttribute('aria-hidden', 'true');
  line.classList.add('cosmic-line');
  line.append(path);
  board.append(...cells, line);
  stake.value = amount(state.stakes.defaultCents);
  presets.append(new Option('Пресеты', ''), ...state.stakes.presetsCents.map(value => new Option(amount(value), value)));

  const listeners = new AbortController();
  let disposed = false;
  let paused = false;
  let working = false;
  let fast = false;
  let autoActive = false;
  let autoLeft = 0;
  let autoDraft = '';
  let next = 0;
  let presentation: AbortController | undefined;
  let presentationEpoch = 0;
  let showing: CosmicFrame | undefined;
  let previousFrame: CosmicFrame | undefined;
  let notice = '';
  const history = state.read().round;
  let acknowledgement = history?.state === 'settled' && !!history.view.series;
  let fresh: ConfirmedRound | undefined;

  function resize() {
    const { width, height } = root.getBoundingClientRect();
    root.dataset.layout = width >= 900 && height >= 600 ? 'wide' : width > height && height < 600 ? 'short' : 'portrait';
    root.toggleAttribute('data-compact', height < 500);
  }
  const sizes = new ResizeObserver(resize);
  sizes.observe(root);
  resize();

  function paint(frame: CosmicFrame | undefined) {
    if (previousFrame === frame && cells[0].firstChild) return;
    previousFrame = frame;
    cells.forEach((cell, index) => {
      const id = (frame?.symbols ?? placeholder)[index];
      cell.className = `cosmic-symbol cosmic-symbol-${id}`;
      cell.setAttribute('role', 'img');
      cell.setAttribute('aria-label', cosmicSymbolNames[id] ?? 'Пустая ячейка');
      cell.toggleAttribute('data-highlight', frame?.highlights.includes(index) ?? false);
      cell.innerHTML = cosmicGlyph(id);
    });
    path.setAttribute('points', (frame?.line ?? []).map(pos => `${pos % COSMIC_COLUMNS + .5},${Math.floor(pos / COSMIC_COLUMNS) + .5}`).join(' '));
  }

  function render() {
    if (disposed) return;
    const { status, round, freeActions, balanceLabel, error } = state.read();
    const view = round?.view;
    const series = view?.series;
    const active = status === 'continue';
    const awaiting = working && !showing;
    const invalid = !state.stakes.parse(stake.value);
    const locked = paused || working || status !== 'spin' || autoActive || acknowledgement;
    const pending = status === 'busy' || status === 'recover';
    paint(showing ?? view?.frames.at(-1));
    root.dataset.awaiting = String(awaiting && !paused);
    root.dataset.bonus = String(!!series && round?.state === 'active');
    const dots = find('portals').parentElement!.parentElement!.querySelectorAll('.cosmic-dots i');
    dots.forEach((dot, index) => dot.toggleAttribute('data-lit', index < (view?.portals ?? 0)));
    find('portals').textContent = `${view?.portals ?? 0} / 5`;
    find('energy').textContent = `×${view?.energy ?? 1}`;
    find('mode').textContent = series && round?.state === 'active' ? `Бонус · осталось ${series.remaining} из ${series.awarded}` : `Основная игра · ${COSMIC_LINES} линий`;
    find('balance').textContent = balanceLabel ?? 'Нет данных';
    find('return-label').textContent = round?.state === 'active' ? 'Накоплено' : 'Возврат';
    find('return').textContent = amount(round?.state === 'active' ? view!.accumulatedCents : round?.returnedCents ?? '0');
    const cue = find('cue');
    const currentCue = (showing ?? (!working ? view?.frames.at(-1) : undefined))?.cue;
    cue.textContent = currentCue === 'echo' ? 'Эхо' : currentCue === 'expand' ? 'Расширение WILD' : '';
    cue.hidden = !cue.textContent;
    stake.setAttribute('aria-invalid', String(invalid));
    stake.disabled = presets.disabled = locked;
    if (round?.state === 'active') stake.value = amount(round.stakeCents);
    const stop = autoActive;
    primary.textContent = acknowledgement ? 'Подтвердить итог' : status === 'recover' ? 'Проверить прежний ход' :
      status === 'sync-required' ? 'Обновить состояние' : working || status === 'busy' ? 'Ожидание' :
      active ? series?.played ? 'Фриспин' : 'Начать бонус' : 'Вращать';
    primary.disabled = paused || working || status === 'busy' || (!acknowledgement && status !== 'recover' && status !== 'sync-required' &&
      (active ? freeActions.length !== 1 || stop : status !== 'spin' || invalid || stop));
    auto.textContent = stop ? `Стоп · ${autoLeft}` : 'Авто';
    auto.disabled = (paused || working || pending || active || !!acknowledgement || invalid || status !== 'spin') && !stop;
    speed.disabled = paused || working;
    find('status').textContent = notice || error || (awaiting ? 'Ждём подтверждения хода' : showing?.cue ? cue.textContent :
      invalid && !locked ? 'Ставка: от 0,10 до 100,00, шаг 0,01' : acknowledgement ? 'Бесплатная серия завершена. Подтвердите итог.' :
      active ? series?.played ? 'Следующий ход бесплатный' : 'Портал открыт. Доплаты нет.' :
      round ? round.returnedCents === '0' ? 'Раунд без выплаты' : 'Возврат подтверждён' : 'Выберите ставку и вращайте');
  }

  function stopAuto() {
    window.clearTimeout(next);
    next = 0;
    autoActive = false;
    autoLeft = 0;
  }
  function scheduleAuto() {
    window.clearTimeout(next);
    if (!autoActive || paused || disposed || working || acknowledgement) return;
    const { status } = state.read();
    if ((status !== 'spin' && status !== 'continue') || (status === 'spin' && !autoLeft)) { stopAuto(); return; }
    next = window.setTimeout(() => void act(true), fast || motion.matches ? 240 : 460);
  }
  function waitFrame(signal: AbortSignal) {
    return new Promise<void>(resolve => {
      const id = window.setTimeout(done, fast ? 140 : 300);
      function done() { window.clearTimeout(id); signal.removeEventListener('abort', done); resolve(); }
      signal.addEventListener('abort', done, { once: true });
    });
  }
  async function present(round: ConfirmedRound) {
    if (paused || disposed || motion.matches || document.hidden) return;
    const controller = new AbortController();
    presentation = controller;
    for (const frame of round.view.frames) {
      if (controller.signal.aborted) break;
      showing = frame;
      render();
      await waitFrame(controller.signal);
    }
    presentation = undefined;
    showing = undefined;
  }
  function feedback(event: SlotFeedback<CosmicView>) {
    if (event.type !== 'bet' && event.type !== 'free') return;
    fresh = event.round;
    if (event.type === 'bet' && autoLeft > 0) autoLeft--;
  }
  const unsubscribe = state.subscribe(render);
  const unlisten = commands.subscribeFeedback(feedback);

  async function act(fromAuto = false) {
    if (disposed || paused || document.hidden || working || (fromAuto && !autoActive)) return;
    if (acknowledgement) {
      acknowledgement = false;
      scheduleAuto(); render();
      return;
    }
    const { status, round, freeActions } = state.read();
    const action = status === 'continue' ? freeActions[0] : undefined;
    const draft = fromAuto ? autoDraft : stake.value;
    if (status !== 'recover' && status !== 'sync-required' && !(status === 'spin' && state.stakes.parse(draft)) && !action) return;
    const epoch = presentationEpoch;
    working = true; notice = ''; fresh = undefined;
    render();
    try {
      if (status === 'recover') {
        stopAuto(); await commands.recover();
        const recovered = state.read().round;
        acknowledgement = recovered?.state === 'settled' && !!recovered.view.series;
      }
      else if (status === 'sync-required') await commands.refresh();
      else if (action && round) await commands.playFree(round, action.id);
      else await commands.bet(draft);
      const confirmed = fresh as ConfirmedRound | undefined;
      if (confirmed) {
        if (epoch === presentationEpoch) await present(confirmed);
        if (confirmed.state === 'settled' && confirmed.view.series) acknowledgement = true;
      } else if (fromAuto) stopAuto();
    } catch (error) {
      stopAuto();
      notice = error instanceof Error ? error.message : 'Не удалось подтвердить ход.';
    } finally {
      working = false;
      scheduleAuto(); render();
    }
  }

  const options = { signal: listeners.signal };
  function suspend() { presentationEpoch++; stopAuto(); presentation?.abort(); render(); }
  find('form').addEventListener('submit', event => { event.preventDefault(); if (!primary.disabled) void act(); }, options);
  stake.addEventListener('input', () => { presets.value = ''; notice = ''; render(); }, options);
  presets.addEventListener('change', () => { if (presets.value) stake.value = amount(presets.value); notice = ''; render(); }, options);
  auto.addEventListener('click', () => {
    if (autoActive) { stopAuto(); render(); return; }
    autoDialog.showModal();
  }, options);
  find('auto-start').addEventListener('click', () => {
    if (paused || !state.stakes.parse(stake.value) || state.read().status !== 'spin') return;
    autoDraft = stake.value;
    autoActive = true;
    autoLeft = Number(find<HTMLSelectElement>('count').value);
    autoDialog.close();
    void act(true);
  }, options);
  speed.addEventListener('click', () => { fast = !fast; speed.textContent = fast ? 'Быстро' : 'Обычно'; speed.setAttribute('aria-pressed', String(fast)); }, options);
  find('info').addEventListener('click', () => { stopAuto(); render(); infoDialog.showModal(); }, options);
  autoDialog.addEventListener('close', () => { if (!auto.disabled) auto.focus(); }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); }, options);
  motion.addEventListener('change', () => { if (motion.matches) presentation?.abort(); }, options);
  render();
  return {
    pause() { paused = true; suspend(); },
    resume() { paused = false; render(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      suspend(); sizes.disconnect(); listeners.abort(); unsubscribe(); unlisten(); root.remove();
    },
  };
}
