import { MAX_REPLAY_FILE_BYTES, prepareViewerReplay } from './replay-viewer-model';
import type { ReplayEvent, ReplayPoolEvent, ReplayState } from '../../server/audit/replay-package';

import { decodeCardReplayAction, decodeCardReplayPosition, isCardTurnReplayGame } from '../../server/audit/replay-pvp-cards';
import { cardLabel } from '../shared/pvp';
import { POOL_POCKETS } from '../shared/pool';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const file = element<HTMLInputElement>('package-file');
const status = element('status'), metadata = element('metadata'), playback = element('playback');
const timeline = element<HTMLInputElement>('timeline'), jumpSequence = element<HTMLInputElement>('jump-sequence');
const play = element<HTMLButtonElement>('play'), pause = element<HTMLButtonElement>('pause');
const previous = element<HTMLButtonElement>('previous'), next = element<HTMLButtonElement>('next');
const position = element('position'), seekNote = element('seek-note');
const stateView = element('state'), eventView = element('event'), links = element('links');

let replay: Extract<ReturnType<typeof prepareViewerReplay>, { status: 'ready' }> | null = null;
let frame = 0, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;

function add(parent: HTMLElement, text: string, tag: 'p' | 'li' | 'h3' | 'span' | 'div' = 'p', className?: string) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

const phases = { open: 'Открыто', settled: 'Завершено', cancelled: 'Отменено' };
const outcomes = { settled: 'Расчёт завершён', cancelled: 'Отмена', 'timed-out': 'Истекло время', forfeited: 'Поражение по правилу',
  draw: 'Ничья' };
const gaps: Record<string, string> = {
  'initial-state-unavailable': 'нет начального состояния', 'event-gap': 'пропущены события',
  'terminal-unavailable': 'нет подтверждённого итога', 'source-unavailable': 'часть источников недоступна',
  'unsupported-source': 'есть неподдерживаемый источник', 'admission-time-unavailable': 'нет точного времени части билетов',
  'capture-interrupted': 'запись прервалась',
};
const movements: Record<string, string> = { stake: 'Ставка', 'paid-option': 'Платная опция', payout: 'Выплата', refund: 'Возврат',
  reserve: 'Удержание', release: 'Освобождение', reversal: 'Сторно' };
const pieces = ['', '♙', '♘', '♗', '♖', '♕', '♔', '♟', '♞', '♝', '♜', '♛', '♚'];
const square = (index: number) => String.fromCharCode(97 + index % 8) + (Math.floor(index / 8) + 1);

function chips(label: string, values: readonly number[]) {
  add(stateView, label + (values.length ? '' : ' · пусто'));
  if (!values.length) return;
  const row = add(stateView, '', 'div', 'tokens');
  for (const value of values) add(row, String(value), 'span');
}

const signs = ['', 'Камень', 'Ножницы', 'Бумага'];
const cardMoves: Record<string, string> = { play: 'Карта сыграна', attack: 'Атака', defend: 'Защита', transfer: 'Перевод',
  take: 'Взял карты со стола', done: 'Завершил атаку', draw: 'Взял карту из колоды', pass: 'Пропуск', resign: 'Сдача' };

function showSport(state: Extract<ReplayState, { profile: 'pvp-sport' }>) {
  const hockey = state.game === 'hockey';
  const table = add(stateView, '', 'div', 'replay-table ' + state.game);
  table.setAttribute('role', 'img');
  table.setAttribute('aria-label', hockey ? 'Положение шайбы и бит' : 'Положение шаров на столе');
  const dot = (text: string, x: number, y: number, css: string) => {
    const marker = add(table, text, 'span', 'table-dot ' + css);
    marker.style.left = x / 7200 + '%';
    marker.style.top = y / 4000 + '%';
  };
  if (hockey) state.paddles.forEach(({ x, y }, index) => dot(String(index + 1), x, y, 'table-paddle'));
  else for (const [x, y] of POOL_POCKETS) dot('', x * 1000, y * 1000, 'table-pocket');
  for (const ball of state.balls) if (ball.active) dot(hockey || !ball.id ? '' : String(ball.id), ball.x, ball.y, 'table-ball');
  add(stateView, 'Такт ' + state.tick + (hockey ? ' · счёт ' + state.score.join(' : ') : ' · ход игрока ' + state.turn));
}

function showState(state: ReplayState | null, stateSequence: number | null, sequence: number) {
  stateView.replaceChildren();
  if (!state) { add(stateView, 'Нет подтверждённого состояния на этом шаге.'); return; }
  add(stateView, phases[state.phase] + (stateSequence !== sequence ? ' · подтверждённое состояние #' + stateSequence : ''), 'p', 'muted');
  switch (state.profile) {
    case 'pvp-turn-based': {
      const game = replay?.package.manifest.game;
      const gameId = game?.gameId;
      if (gameId === 'tsu-e-fa' && game?.engineId === 'royal-tsu-duel' && state.board.length === 9) {
        const [round, a, b, stage, mask, last, signA, signB] = state.board;
        add(stateView, 'Раунд ' + round + ' · счёт ' + a + ' : ' + b);
        add(stateView, ['Выбор', 'Отсчёт', 'Раскрытие'][stage] + (mask ? ' · выбор зафиксирован у ' + (mask === 3 ? 'обоих' : 'игрока ' + mask) : ''));
        if (last) add(stateView, 'Раскрытие раунда ' + last + ' · ' + signs[signA] + ' / ' + signs[signB]);
        break;
      }
      if (isCardTurnReplayGame(gameId) && game?.engineId === 'royal-cards') {
        const cards = decodeCardReplayPosition(gameId, state.board);
        if (!cards) break;
        add(stateView, 'Карт на руках ' + cards.handCounts.join(' / ') + ' · в колоде ' + cards.stockCount);
        if (cards.trump !== null) add(stateView, 'Козырь ' + cardLabel(cards.trump));
        if (gameId === 'crazy-eights') add(stateView, 'Текущая масть ' + ['♠', '♥', '♦', '♣'][cards.suit]);
        if (cards.table.length) add(stateView, 'На столе ' + cards.table.map(({ attack, defense }) =>
          cardLabel(attack) + (defense === undefined ? '' : ' → ' + cardLabel(defense))).join(' · '));
        if (state.seatToMove) add(stateView, 'Ход игрока ' + state.seatToMove);
        break;
      }
      if (gameId !== 'chess' || state.board.length !== 64) {
        chips('Позиции', state.board);
        break;
      }
      const board = add(stateView, '', 'div', 'chess');
      board.setAttribute('role', 'img');
      board.setAttribute('aria-label', 'Шахматная позиция');
      for (let rank = 7; rank >= 0; rank--) {
        for (let column = 0; column < 8; column++) {
          const index = rank * 8 + column, code = state.board[index];
          const cell = add(board, pieces[code] ?? '', 'span', 'square' + ((rank + column) % 2 === 0 ? ' dark' : ''));
          cell.dataset.square = square(index);
          cell.dataset.piece = String(code);
        }
      }
      add(stateView, 'Ход ' + state.turn + (state.seatToMove === null ? '' : ' · очередь игрока ' + state.seatToMove));
      break;
    }
    case 'pvp-sport': showSport(state); break;
    case 'pvp-realtime': {
      const isCombat = replay?.package.manifest.game.engineId === 'royal-combat-60hz';
      const ring = isCombat ? add(stateView, '', 'div', 'ring') : null;
      state.fighters.forEach((fighter, index) => {
        const label = 'Игрок ' + (index + 1) + ' · здоровье ' + fighter.health;
        if (ring) {
          const figure = add(ring, 'Игрок ' + (index + 1), 'span', 'fighter');
          figure.style.left = Math.max(8, Math.min(92, fighter.x / 720_000 * 100)) + '%';
          figure.style.bottom = Math.min(128, Math.max(0, fighter.y / 1000 * .35)) + 'px';
        }
        add(stateView, label + ' · позиция ' + fighter.x + ', ' + fighter.y);
      });
      add(stateView, 'Подтверждённый такт ' + state.tick);
      break;
    }
    case 'casino-steps':
      add(stateView, 'Ревизия ' + state.revision);
      chips('Открытые значения', state.visible);
      break;
    case 'pool-steps':
      add(stateView, 'Этап ' + state.stage);
      chips('В пуле', state.remaining);
      chips('Выбыли', state.eliminated);
      break;
  }
}

const utc = (ms: number) => new Date(ms).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC';

function poolDetail(event: ReplayPoolEvent) {
  switch (event.kind) {
    case 'window': return 'Открытие ' + event.poolId + ' · ' + utc(event.openedAtMs) + ' · приём до ' + utc(event.closesAtMs)
      + ' · плановый итог ' + utc(event.finishesAtMs);
    case 'ticket': return 'Билет ' + event.ordinal + ' · ' + event.country + ' · место ' + event.accountSlot + ' · '
      + event.stakeUnits + ' мин. ед. · ' + (event.admittedAtMs === null ? 'время приёма неизвестно' : utc(event.admittedAtMs))
      + (event.opening ? ' · открыт до начала аудита' : '');
    case 'cutoff': return 'Приём закрыт · ' + utc(event.closesAtMs);
    case 'award': return 'Место ' + event.place + ' · ' + event.country + ' · ' + event.units + ' мин. ед.';
    case 'allocation': return 'Билет ' + event.ordinal + ' · место ' + event.accountSlot + ' · ' + event.units + ' мин. ед.';
    case 'aggregate': return 'Итоговое зачисление · место ' + event.accountSlot;
    case 'result': return 'Банк ' + event.bankUnits + ' · комиссия ' + event.feeUnits
      + (event.reason === 'countries' ? ' · мало исходов' : event.reason === 'accounts' ? ' · мало участников' : '');
  }
}

function showEvent(event: ReplayEvent | null) {
  eventView.replaceChildren();
  links.replaceChildren();
  if (!event) { add(eventView, 'Начало записи.'); return; }
  const { data } = event;
  if (data.kind === 'terminal') {
    add(eventView, outcomes[data.outcome] + (data.winnerSeat ? ' · победитель ' + data.winnerSeat : ''));
    if (event.pool) add(eventView, poolDetail(event.pool));
  } else if (event.pool) add(eventView, poolDetail(event.pool));
  else if (data.kind === 'checkpoint') add(eventView, 'Контрольное состояние сервера');
  else if (data.kind === 'presence') add(eventView, 'Игрок ' + data.seat + (data.event === 'disconnected' ? ' отключился' : ' подключился'));
  else {
    const action = data.action;
    switch (action.profile) {
      case 'pvp-turn-based': {
        const game = replay?.package.manifest.game;
        const gameId = game?.gameId;
        let description = action.code === 'resign' ? 'сдача' : action.code + ' · ' + action.positions.join(', ');
        if (action.code === 'move' && gameId === 'chess' && action.positions.length >= 2) {
          description = square(action.positions[0]) + ' → ' + square(action.positions[1]);
        } else if (action.code === 'move' && gameId === 'tsu-e-fa' && game?.engineId === 'royal-tsu-duel') {
          description = 'выбор зафиксирован · раунд ' + action.positions[0];
        } else if (isCardTurnReplayGame(gameId) && game?.engineId === 'royal-cards') {
          const move = decodeCardReplayAction(gameId, action);
          if (move) description = cardMoves[move.kind] + ('card' in move && move.card !== undefined ? ' · ' + cardLabel(move.card) : '');
        }
        add(eventView, 'Игрок ' + action.seat + ' · ' + description);
        break;
      }
      case 'pvp-sport': {
        add(eventView, action.code === 'advance' ? 'Шагов физики ' + action.durations.length :
          'Игрок ' + action.seat + ' · ' + ({ paddle: 'движение биты', place: 'позиция битка', shot: 'удар', resign: 'сдача' })[action.code]);
        break;
      }
      case 'pvp-realtime': add(eventView, 'Управление игрока ' + action.seat + ' · такт ' + action.tick + ' · кнопки ' + action.buttons); break;
      case 'casino-steps': add(eventView, ({ start: 'Начало', move: 'Действие', cashout: 'Выход' })[action.code]
        + (action.selection.length ? ' · ' + action.selection.join(', ') : '')); break;
      case 'pool-steps': add(eventView, action.code + (action.entrants.length ? ' · ' + action.entrants.join(', ') : '')); break;
    }
  }
  if (event.calculation) {
    const { numerator, denominator, baseUnits, creditedUnits } = event.calculation;
    add(eventView, 'Расчёт ' + numerator + ' / ' + denominator + ' · базовая сумма ' + baseUnits + ' · начислено ' + creditedUnits);
  }
  if (!event.postings.length) return;
  add(links, 'Связанные проводки', 'h3');
  const list = document.createElement('ul');
  links.append(list);
  for (const posting of event.postings) {
    const leg = event.money?.find(item => item.posting.namespace === posting.namespace && item.posting.rowId === posting.rowId);
    const row = add(list, leg ? movements[leg.movement] + ' ' + leg.units + ' мин. ед. · ' : '', 'li');
    const code = document.createElement('code');
    code.textContent = posting.namespace + ' #' + posting.rowId;
    row.append(code);
  }
}

function render() {
  if (!replay) return;
  const current = replay.frames[frame];
  timeline.value = String(frame);
  jumpSequence.value = String(current.sequence);
  position.textContent = 'Событие #' + current.sequence + (current.event && !replay.package.manifest.timing
    ? ' · ' + (current.event.atMs / 1000).toFixed(3) + ' с от начала' : '');
  previous.disabled = frame === 0;
  next.disabled = frame === replay.frames.length - 1;
  play.disabled = timer !== undefined || next.disabled;
  pause.disabled = timer === undefined;
  showState(current.state, current.stateSequence, current.sequence);
  showEvent(current.event);
}

function stop() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function go(index: number) {
  if (!replay || index < 0 || index >= replay.frames.length) return;
  stop();
  frame = index;
  seekNote.textContent = '';
  render();
}

function schedule() {
  if (!replay || frame >= replay.frames.length - 1) { stop(); render(); return; }
  const before = replay.frames[frame].event?.atMs ?? 0;
  const after = replay.frames[frame + 1].event?.atMs ?? before;
  const wait = replay.package.manifest.timing ? 500 : Math.min(2000, Math.max(80, after - before));
  timer = setTimeout(() => { frame++; schedule(); }, wait);
  render();
}

function message(text: string, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

file.addEventListener('change', async () => {
  const selected = file.files?.[0], current = ++generation;
  stop();
  replay = null;
  playback.hidden = true;
  metadata.hidden = true;
  if (!selected) { message('Выберите файл пакета.'); return; }
  if (selected.size > MAX_REPLAY_FILE_BYTES) { message('Файл превышает лимит размера.', true); return; }
  message('Проверяю пакет…');
  try {
    const input = JSON.parse(await selected.text()) as unknown;
    if (current !== generation) return;
    const checked = prepareViewerReplay(input);
    if (checked.status !== 'ready') {
      const failure = checked.status === 'incomplete' ? 'Не хватает фрагментов ' + checked.missingFragments.join(', ') + '.'
        : ({ unsupported: 'Версия формата или движка не поддерживается.', corrupt: 'Контрольная сумма или структура записи повреждена.',
          'too-large': 'Пакет превышает лимиты формата.', mismatch: 'Сохранённое состояние расходится с повторным расчётом.' })[checked.status];
      message(failure, true);
      return;
    }
    replay = checked;
    const manifest = replay.package.manifest;
    frame = 0;
    const coverage = manifest.coverage === 'partial' ? 'Частичная запись · ' + manifest.gaps.map(gap => gaps[gap]).join(', ')
      : 'Полная запись';
    message(coverage + (replay.engineVerified
      ? manifest.game.engineId === 'royal-tsu-duel' ? ' · раскрытие и счёт проверены' : ' · состояния сверены движком'
      : ' · целостность пакета проверена'));
    metadata.textContent = manifest.game.gameId + ' / ' + manifest.game.modeId + ' · формат ' + manifest.formatVersion
      + ' · правила ' + manifest.game.rulesVersion + ' · ' + (manifest.scope.environment === 'test' ? 'ТЕСТ' : 'РАБОЧИЙ')
      + (manifest.timing ? ' · только порядок событий, точное время неизвестно' : '');
    metadata.hidden = false;
    playback.hidden = false;
    timeline.max = String(replay.frames.length - 1);
    seekNote.textContent = '';
    render();
  } catch {
    if (current === generation) message('Файл не удалось прочитать как пакет JSON.', true);
  }
});

play.addEventListener('click', () => { stop(); schedule(); });
pause.addEventListener('click', () => { stop(); render(); });
previous.addEventListener('click', () => go(frame - 1));
next.addEventListener('click', () => go(frame + 1));
timeline.addEventListener('input', () => go(Number(timeline.value)));
const seek = () => {
  const index = jumpSequence.value === '' ? -1 : replay?.frames.findIndex(item => item.sequence === jumpSequence.valueAsNumber) ?? -1;
  if (index < 0) { stop(); render(); seekNote.textContent = 'Событие отсутствует в записи.'; return; }
  go(index);
};
element('jump').addEventListener('click', seek);
jumpSequence.addEventListener('keydown', event => { if (event.key === 'Enter') seek(); });
