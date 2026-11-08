import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';
import { chromium } from 'playwright';
import { Chess } from 'chess.js';
import { neutralCombatInput } from '../src/shared/combat';
import { CombatGame } from '../server/combatGame';
import { createReplayPackage, type ReplayEvent } from '../server/audit/replay-package';
import { combatReplayDefinition, combatReplayFrame, combatReplayTickDuration } from '../server/audit/replay-pvp-realtime-engine';
import { chessTurnReplayDefinition } from '../server/audit/replay-pvp-turn';

import { sportReplayDefinitions, sportReplayFrame } from '../server/audit/replay-pvp-sport-engine';
import { tsuTurnReplayDefinition } from '../server/audit/replay-pvp-tsu';
import { TableGame } from '../server/tableGames';

const scope = { datasetId: randomUUID(), environment: 'test' } as const;
const amount = '9007199254740993';
const root = fileURLToPath(new URL('..', import.meta.url));

function chessPackage(late = false) {
  const { formatVersion: _, ...game } = chessTurnReplayDefinition;
  const chess = new Chess();
  const square = (value: string) => (Number(value[1]) - 1) * 8 + value.charCodeAt(0) - 97;
  const state = (turn: number, phase: 'open' | 'settled') => {
    const board = Array<number>(64).fill(0);
    for (const row of chess.board()) {
      for (const piece of row) {
        if (piece) board[square(piece.square)] = 'pnbrqk'.indexOf(piece.type) + 1 + (piece.color === 'b' ? 6 : 0);
      }
    }
    return { profile: 'pvp-turn-based' as const, phase, turn, board,
      seatToMove: phase === 'settled' ? null : chess.turn() === 'w' ? 1 as const : 2 as const };
  };
  const initial = state(0, 'open');
  const moves = [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']];
  let firstObserved: ReturnType<typeof state> | undefined;
  const events: ReplayEvent[] = moves.map(([from, to], index) => {
    chess.move({ from, to });
    if (late && index === 2) firstObserved = state(3, 'open');
    return { sequence: index + 1, atMs: 1000 * (index + 1), postings: [], data: { kind: 'action',
      action: { profile: 'pvp-turn-based', code: 'move', seat: index % 2 === 0 ? 1 : 2, positions: [square(from), square(to)] } } };
  });
  const posting = { namespace: 'royal_game.demo_ledger', rowId: '701' };
  events.push({ sequence: 5, atMs: 4000, postings: [posting], money: [{ posting, movement: 'payout', units: amount }],
    data: { kind: 'terminal', outcome: 'settled', winnerSeat: 2, state: state(4, 'settled') } });
  const replayId = randomUUID();
  if (firstObserved) return createReplayPackage({ formatVersion: 2, game, initial: null, scope, replayId,
    entityId: replayId, coverage: 'partial', gaps: ['initial-state-unavailable', 'event-gap', 'terminal-unavailable'] }, [
    { ...events[2], sequence: 1, atMs: 0 },
    { sequence: 2, atMs: 0, postings: [], data: { kind: 'checkpoint', state: firstObserved } },
  ]);
  return createReplayPackage({ formatVersion: 2, game, initial, scope, replayId, entityId: replayId, coverage: 'complete', gaps: [] }, events);
}

function poolPackage() {
  return createReplayPackage({
    formatVersion: 3, scope, replayId: randomUUID(), entityId: 'ft1-420', coverage: 'partial',
    gaps: ['admission-time-unavailable', 'terminal-unavailable'], timing: 'source-order',
    game: { gameId: 'flag-tote', modeId: 'pool', category: 'totalizator', replayProfile: 'pool-steps',
      gameVersion: '1', rulesVersion: '1', engineId: 'royal-flag-tote', engineVersion: '1' },
    initial: { profile: 'pool-steps', phase: 'open', stage: 0, remaining: [0, 1], eliminated: [] },
  }, [{
    sequence: 1, atMs: 0, postings: [], data: { kind: 'action', action: { profile: 'pool-steps', code: 'advance', entrants: [0, 1] } },
    pool: { kind: 'window', poolId: 'ft1-420', openedAtMs: 1000, closesAtMs: 5000, finishesAtMs: 7000 },
  }, {
    sequence: 2, atMs: 0, postings: [], data: { kind: 'action', action: { profile: 'pool-steps', code: 'ticket', entrants: [0] } },
    pool: { kind: 'ticket', ticketId: randomUUID(), ordinal: 1, accountSlot: 1, country: 'US', stakeUnits: '1000',
      admittedAtMs: null, opening: true },
  }]);
}

function combatPackage(changeCheckpoint: boolean) {
  const { formatVersion, ...game } = combatReplayDefinition;
  const replayId = randomUUID();
  const combat = new CombatGame(replayId);
  combat.state.players = ['1', '2'];
  combat.start();
  combat.state.phase = 'playing';
  const initial = combatReplayFrame(combat.state, 0);
  combat.input('1', { ...neutralCombatInput(), right: true }, 1);
  for (let tick = 1; tick <= 30; tick++) combat.tick(combatReplayTickDuration, tick);
  const checkpoint = combatReplayFrame(combat.state, 30);
  if (changeCheckpoint) checkpoint.fighters[0].x++;
  return createReplayPackage({
    formatVersion, game, initial, scope, replayId, entityId: replayId, coverage: 'partial', gaps: ['terminal-unavailable'],
  }, [{
    sequence: 1, atMs: 10, postings: [], data: { kind: 'action', action: { profile: 'pvp-realtime', code: 'input', seat: 1, tick: 1, buttons: 2 } },
  }, {
    sequence: 2, atMs: 500, postings: [], data: { kind: 'checkpoint', state: checkpoint },
  }]);
}

function hockeyPackage() {
  const { formatVersion, ...game } = sportReplayDefinitions.find(mode => mode.gameId === 'hockey')!;
  assert(formatVersion === 4);
  const table = new TableGame('hockey');
  table.join('1'); table.join('2');
  const initial = sportReplayFrame(table.state, 0), replayId = randomUUID();
  const dt = 1 / 60;
  table.move('1', 240, 120);
  table.tick(dt);
  return createReplayPackage({ formatVersion, game, initial, scope, replayId, entityId: replayId,
    coverage: 'partial', gaps: ['terminal-unavailable'] }, [
    { sequence: 1, atMs: 0, postings: [], data: { kind: 'action', action: { profile: 'pvp-sport', code: 'paddle', seat: 1, x: 240, y: 120 } } },
    { sequence: 2, atMs: 17, postings: [], data: { kind: 'action', action: { profile: 'pvp-sport', code: 'advance', durations: [dt] } } },
    { sequence: 3, atMs: 17, postings: [], data: { kind: 'checkpoint', state: sportReplayFrame(table.state, 1) } },
  ]);
}

function tsuPackage() {
  const { formatVersion, ...game } = tsuTurnReplayDefinition, replayId = randomUUID();
  assert(formatVersion === 2);
  const state = (round: number, board: number[]) => ({ profile: 'pvp-turn-based' as const, phase: 'open' as const,
    turn: round, seatToMove: null, board });
  const initial = state(1, [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  const checkpoint = (board: number[], round = 1): ReplayEvent['data'] => ({ kind: 'checkpoint', state: state(round, board) });
  const move = (seat: 1 | 2): ReplayEvent['data'] => ({ kind: 'action',
    action: { profile: 'pvp-turn-based', code: 'move', seat, positions: [1] } });
  const steps = [
    { atMs: 0, data: { kind: 'checkpoint', state: initial } as const },
    { atMs: 100, data: move(1) },
    { atMs: 100, data: checkpoint([1, 0, 0, 0, 1, 0, 0, 0, 0]) },
    { atMs: 200, data: move(2) },
    { atMs: 200, data: checkpoint([1, 0, 0, 1, 3, 0, 0, 0, 0]) },
    { atMs: 2000, data: checkpoint([2, 1, 0, 2, 0, 1, 1, 2, 1], 2) },
  ];
  return createReplayPackage({ formatVersion, game, initial, scope, replayId, entityId: replayId,
    coverage: 'partial', gaps: ['terminal-unavailable'] }, steps.map((event, i) => ({ ...event, sequence: i + 1, postings: [] })));
}

function legacyCasinoPackage() {
  return createReplayPackage({
    scope, replayId: randomUUID(), entityId: randomUUID(), coverage: 'partial', gaps: ['event-gap', 'terminal-unavailable'],
    game: { gameId: 'royal-roulette', modeId: 'normal', category: 'casino', replayProfile: 'casino-steps',
      gameVersion: '1', rulesVersion: '1', engineId: 'royal-core', engineVersion: '1' },
    initial: { profile: 'casino-steps', phase: 'open', revision: 0, visible: [] },
  }, [{
    sequence: 3, atMs: 1000, postings: [], data: { kind: 'action', action: { profile: 'casino-steps', code: 'move', selection: [3] } },
  }, {
    sequence: 4, atMs: 1000, postings: [],
    data: { kind: 'checkpoint', state: { profile: 'casino-steps', phase: 'open', revision: 2, visible: [3] } },
  }]);
}

test('serves the full investigation flow from a local HTML file with networking disabled', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-viewer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const html = join(directory, 'viewer.html');
  execFileSync(process.execPath, ['scripts/build-audit-viewer.mjs', '--output', html], { cwd: root });
  const browser = await chromium.launch({ executablePath: process.env.ROYAL_AUDIT_VIEWER_BROWSER });
  t.after(() => browser.close());
  const context = await browser.newContext({ offline: true, viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  const network: string[] = [], errors: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('file:')) network.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(html).href);
  const upload = (value: unknown) => page.locator('#package-file').setInputFiles({
    name: 'package.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
  const state = page.locator('#state'), status = page.locator('#status'), position = page.locator('#position');
  const jump = async (sequence: number) => {
    await page.locator('#jump-sequence').fill(String(sequence));
    await page.locator('#jump').click();
  };
  const chess = chessPackage();
  await upload(chess);
  await expect(status).toHaveText(/Полная запись.*состояния сверены движком/);
  await expect(page.locator('#metadata')).toHaveText(/ТЕСТ/);
  await expect(state.locator('[data-square=f2]')).toHaveAttribute('data-piece', '1');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  await page.locator('#play').click();
  await expect(position).toHaveText(/Событие #1/);
  await page.locator('#pause').click();
  await expect(position).toHaveText(/Событие #1/);
  await expect(state.locator('[data-square=f3]')).toHaveAttribute('data-piece', '1');
  await page.locator('#next').click();
  await expect(position).toHaveText(/Событие #2/);
  await expect(state.locator('[data-square=e5]')).toHaveAttribute('data-piece', '7');
  await jump(999);
  await expect(page.locator('#seek-note')).toHaveText(/Событие отсутствует/);
  await jump(5);
  await expect(page.locator('#event')).toHaveText(/победитель 2/);
  await expect(page.locator('#links')).toHaveText(new RegExp(amount + '.*royal_game.demo_ledger #701'));
  await expect(state.locator('[data-square=h4]')).toHaveAttribute('data-piece', '11');
  await page.locator('#previous').click();
  await expect(page.locator('#links')).toBeEmpty();

  await upload(chessPackage(true));
  await expect(status).toHaveText(/Частичная запись.*с позиции после полухода 3.*целостность пакета проверена/);
  await expect(state.locator('[data-square=g4]')).toHaveCount(0);
  await jump(2);
  await expect(state.locator('[data-square=g4]')).toHaveAttribute('data-piece', '1');

  const invalid = structuredClone(chess);
  invalid.fragments[0].events[0].atMs++;
  await upload(invalid);
  await expect(status).toHaveText(/повреждена/);
  await expect(page.locator('#playback')).toBeHidden();
  await upload({ ...chess, fragments: [] });
  await expect(status).toHaveText(/Не хватает фрагментов 0/);
  await upload({ ...chess, manifest: { ...chess.manifest, formatVersion: 99 } });
  await expect(status).toHaveText(/не поддерживается/);

  const tsu = tsuPackage(), combat = combatPackage(false);
  for (const [pack, game] of [
    [tsu, { ...tsu.manifest.game, engineId: 'unreleased-tsu-engine' }],
    [chess, { ...chess.manifest.game, gameId: 'hockey' }],
    [chess, { ...chess.manifest.game, gameId: 'durak', engineId: 'unreleased-card-engine' }],
    [combat, { ...combat.manifest.game, gameId: 'chess' }],
  ] as const) {
    const { formatVersion, initial, replayId, entityId, coverage, gaps } = pack.manifest;
    const incompatible = createReplayPackage({ scope, formatVersion, game, initial, replayId, entityId, coverage, gaps },
      pack.fragments.flatMap(fragment => fragment.events));
    await upload(incompatible);
    await expect(status).toHaveText(/не поддерживается/);
    await expect(page.locator('#playback')).toBeHidden();
  }

  await upload(combat);
  await expect(status).toHaveText(/Частичная запись.*состояния сверены движком/);
  await jump(1);
  await expect(state).toHaveText(/240000, 0.*Подтверждённый такт 0/);
  await jump(2);
  await expect(state).toHaveText(/345000, 0.*Подтверждённый такт 30/);
  await upload(combatPackage(true));
  await expect(status).toHaveText(/расходится с повторным расчётом/);

  await upload(hockeyPackage());
  await expect(state.getByRole('img', { name: 'Положение шайбы и бит' })).toBeVisible();
  await expect(state.locator('.table-paddle')).toHaveCount(2);
  const startingPaddle = await state.locator('.table-paddle').first().getAttribute('style');
  await jump(2);
  await expect(state).toHaveText(/Такт 1/);
  assert.notEqual(await state.locator('.table-paddle').first().getAttribute('style'), startingPaddle);

  await upload(tsu);
  await jump(5);
  await expect(state).toHaveText(/Отсчёт.*выбор зафиксирован у обоих/);
  await expect(state).not.toHaveText(/Камень|Ножницы/);
  await jump(6);
  await expect(state).toHaveText(/Раскрытие раунда 1.*Камень \/ Ножницы/);

  await upload(legacyCasinoPackage());
  await expect(page.locator('#metadata')).toHaveText(/формат 1/);
  await jump(3);
  await expect(state).toHaveText(/Нет подтверждённого состояния/);
  await jump(4);
  await expect(state).toHaveText(/Ревизия 2.*Открытые значения/);

  await upload(poolPackage());
  await expect(status).toHaveText(/Частичная запись.*нет точного времени/);
  await expect(page.locator('#metadata')).toHaveText(/только порядок событий/);
  await jump(2);
  await expect(page.locator('#event')).toHaveText(/время приёма неизвестно.*открыт до начала аудита/);
  await expect(position).toHaveText('Событие #2');
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
});
