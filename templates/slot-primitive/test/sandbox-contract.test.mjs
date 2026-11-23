import assert from 'node:assert/strict';
import test from 'node:test';
import { pandaExamples as examples } from '../dist/contract/panda-examples.js';
import { validFreePicks } from '../dist/index.js';

const { capabilities, idle, start, ordinary, bonusStart, spin, bonusSpin, reward, bonusResult,
  startReplay, spinReplayAfterSettlement, errors } = examples;
const amounts = /^(?:0|[1-9][0-9]*)$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function checkReceipt(reply, command, revision, replayed = false) {
  assert.deepEqual(reply.receipt, { operationId: command.operationId,
    roundId: command.kind === 'start' ? command.operationId : command.roundId, acceptedRevision: revision, replayed });
}

test('Данные примеров читаются как JSON и относятся к одному тестовому проекту', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(examples)), examples);
  assert.equal(capabilities.scope.environment, 'sandbox');
  assert.equal(capabilities.protocolVersion, 1);
  const [game] = capabilities.games;
  assert.equal(game.gameId, 'panda-dragon-preview');
  assert.equal(game.rulesVersion, start.rulesVersion);
  assert.deepEqual(game.commands, ['start', 'free']);
  assert.equal(game.stakes.defaultCents, start.stakeCents);
  assert.deepEqual([game.stakes.minimumCents, game.stakes.maximumCents, game.stakes.stepCents], ['10', '5000', '1']);
  assert.deepEqual(game.stakes.presetsCents, ['10', '20', '50', '100', '200', '500', '1000', '2000', '5000']);
  assert.ok([start, spin, reward].every(operation => uuid.test(operation.operationId)));
  assert.equal(new Set([start, spin, reward].map(operation => operation.operationId)).size, 3);
  const snapshots = [idle, ordinary.snapshot, bonusStart.snapshot, bonusSpin.snapshot, bonusResult.snapshot];
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot.scope, capabilities.scope);
    assert.equal(snapshot.protocolVersion, 1);
    assert.equal(snapshot.gameId, game.gameId);
    assert.match(snapshot.balanceCents, amounts);
    if (!snapshot.round) continue;
    assert.equal(snapshot.round.rulesVersion, game.rulesVersion);
    for (const amount of [snapshot.round.stakeCents, snapshot.round.spentCents, snapshot.round.returnedCents]) {
      assert.match(amount, amounts);
    }
    const { columns, paylines, symbols } = snapshot.round.view;
    assert.equal(columns, 5);
    assert.equal(symbols.length, 25);
    assert.ok(symbols.every(symbol => Number.isInteger(symbol) && symbol >= 0 && symbol <= 8));
    assert.equal(paylines.length, 10);
    assert.ok(paylines.every(line => line.length === columns && line.every(row => Number.isInteger(row) && row >= 0 && row < 5)));
  }
});

test('Обычная ветка завершается сразу, бонусная имеет два бесплатных этапа', () => {
  checkReceipt(ordinary, start, 1);
  assert.equal(idle.round, null);
  assert.deepEqual(start.settings, {});
  assert.equal(ordinary.snapshot.round.state, 'settled');
  assert.equal(ordinary.snapshot.round.returnedCents, '0');
  assert.deepEqual(ordinary.snapshot.freeActions, []);
  checkReceipt(bonusStart, start, 1);
  assert.equal(bonusStart.snapshot.round.state, 'active');
  assert.equal(bonusStart.snapshot.round.view.scatter, true);
  assert.deepEqual(bonusStart.snapshot.round.view.highlights, [0, 1, 2]);
  checkReceipt(bonusSpin, spin, 2);
  assert.equal(spin.revision, bonusStart.snapshot.round.revision);
  assert.equal(Object.hasOwn(spin, 'picks'), false);
  assert.equal(bonusSpin.snapshot.round.state, 'active');
  assert.deepEqual(bonusSpin.snapshot.round.view.wins, [{ line: 0, length: 4 }]);
  checkReceipt(bonusResult, reward, 3);
  assert.equal(reward.revision, bonusSpin.snapshot.round.revision);
  assert.equal(bonusResult.snapshot.round.state, 'settled');
  assert.deepEqual(bonusResult.snapshot.freeActions, []);
  assert.ok(bonusResult.snapshot.round.view.features.includes('Персик Мудрости'));
  for (const snapshot of [ordinary.snapshot, bonusStart.snapshot, bonusSpin.snapshot, bonusResult.snapshot]) {
    assert.equal(snapshot.round.stakeCents, start.stakeCents);
    assert.equal(snapshot.round.spentCents, start.stakeCents);
    assert.equal(BigInt(snapshot.balanceCents),
      BigInt(idle.balanceCents) - BigInt(start.stakeCents) + BigInt(snapshot.round.returnedCents));
  }
});

test('Подтверждённые действия различают бесплатный спин и допустимый выбор', () => {
  const [free] = bonusStart.snapshot.freeActions;
  const [choose] = bonusSpin.snapshot.freeActions;
  assert.equal(free.id, spin.actionId);
  assert.equal(choose.id, reward.actionId);
  assert.equal(validFreePicks(free, []), true);
  assert.equal(validFreePicks(free, [2]), false);
  assert.equal(validFreePicks(choose, reward.picks), true);
  assert.equal(validFreePicks(choose, [3]), true);
  for (const picks of [[], [1], [2, 2], [2, 3]]) assert.equal(validFreePicks(choose, picks), false);
});

test('Повтор сохраняет ID и ревизию операции, даже если текущий раунд завершён позже', () => {
  const { retryStart } = examples;
  assert.deepEqual(retryStart, start);
  checkReceipt(startReplay, retryStart, 1, true);
  assert.deepEqual(startReplay.snapshot, bonusStart.snapshot);
  checkReceipt(spinReplayAfterSettlement, spin, 2, true);
  assert.deepEqual(spinReplayAfterSettlement.snapshot, bonusResult.snapshot);
  assert.equal(spinReplayAfterSettlement.snapshot.round.revision, 3);
  assert.ok(spinReplayAfterSettlement.snapshot.snapshotVersion > bonusSpin.snapshot.snapshotVersion);
  assert.equal(spinReplayAfterSettlement.snapshot.round.spentCents, start.stakeCents);
});

test('Неподтверждённый результат не выдаётся за явный отказ без операции', () => {
  assert.equal(errors.stale.disposition, 'rejected');
  assert.ok([start, spin, reward].every(command => command.operationId !== errors.stale.operationId));
  assert.equal(errors.conflict.operationId, spin.operationId);
  for (const error of [errors.conflict, errors.revoked, errors.unavailable]) {
    assert.equal(error.disposition, 'unknown');
    assert.equal(error.protocolVersion, 1);
    assert.equal('snapshot' in error, false);
    assert.equal('scope' in error, false);
  }
});
