import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSlotActions } from '../dist/actions.js';
import { cosmicBonus, cosmicExamples } from '../dist/contract/cosmic-examples.js';
import { createCosmicDemo } from '../dist/cosmic/demo-services.js';
import { apiVersion, rulesVersion, progressVersion, gameId } from '../dist/cosmic/entry.js';

const root = new URL('../', import.meta.url);

test('Манифест Cosmic соответствует игровому входу без зависимостей от стенда и Royal', async () => {
  const manifest = JSON.parse(await readFile(new URL('cosmic.module.json', root), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.deepEqual([manifest.gameId, manifest.apiVersion, manifest.rulesVersion, manifest.progressVersion],
    [gameId, apiVersion, rulesVersion, progressVersion]);
  assert.equal(manifest.sdkVersion, pkg.version);
  const imports = new Set();
  async function visit(file) {
    if (imports.has(file.href)) return;
    assert.ok(file.href.startsWith(new URL('src/', root).href));
    assert.doesNotMatch(file.pathname, /demo|fixtures|\/contract\//);
    imports.add(file.href);
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/);
    for (const [, specifier] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.ok(specifier.startsWith('.'), specifier);
      await visit(new URL(specifier, file));
    }
  }
  await visit(new URL(manifest.entry, root));
  await readFile(new URL(manifest.stylesheet, root));
});

test('Сообщения Cosmic сериализуются; платный старт и бесплатный ход не подменяются', () => {
  const { start, free, portal, continuation, settled, recovered, lateReplay, idle, win } = cosmicExamples;
  assert.deepEqual(JSON.parse(JSON.stringify(cosmicExamples)), cosmicExamples);
  assert.deepEqual(start.settings, { luelon: { mode: 'normal' } });
  assert.deepEqual(free, { operationId: free.operationId, kind: 'free', roundId: start.operationId, revision: 1, actionId: 'luelon-spin' });
  assert.equal(portal.snapshot.balanceCents, '4990');
  assert.equal(continuation.snapshot.balanceCents, '4990');
  assert.equal(settled.balanceCents, '5820');
  assert.equal(win.snapshot.balanceCents, '5002');
  assert.equal(idle.balanceCents, '5000');
  assert.equal(recovered.receipt.operationId, start.operationId);
  assert.equal(recovered.receipt.replayed, true);
  assert.equal(lateReplay.receipt.acceptedRevision, 2);
  assert.equal(lateReplay.snapshot.round.revision, 11);
  assert.equal(cosmicBonus.length, 11);
  assert.ok(cosmicBonus.flatMap(view => view.frames).every(frame => frame.symbols.length === 15 && frame.symbols.every(value => value >= 0 && value <= 8)));
  assert.equal(cosmicBonus[1].frames[1].cue, 'expand');
  assert.equal(cosmicBonus[2].frames[1].cue, 'echo');
});

test('Бонус Cosmic сохраняет стоимость одного старта и подтверждает итог только в конце', async () => {
  const demo = createCosmicDemo('bonus');
  const { services } = demo;
  assert.equal(services.stakes.parse('100,00'), '10000');
  assert.equal(services.stakes.parse('100,01'), undefined);
  await assert.rejects(services.spin('0,101'));
  const actions = createSlotActions(services);
  const feedback = [];
  actions.subscribeFeedback(event => feedback.push(event.type));
  await actions.bet('0,10');
  const first = services.read().round;
  assert.equal(services.read().balanceLabel, '49,90');
  assert.equal(services.read().round.view.series.remaining, 10);
  await assert.rejects(services.playFree(first, 'luelon-spin', [2]));
  for (let played = 1; played <= 10; played++) {
    const saved = services.read().round;
    await actions.playFree(saved, 'luelon-spin');
    const { round, balanceLabel } = services.read();
    assert.equal(round.id, first.id);
    assert.equal(round.revision, played + 1);
    assert.equal(round.spentCents, '10');
    assert.equal(round.view.series.remaining, 10 - played);
    assert.equal(round.returnedCents, played < 10 ? '0' : '830');
    assert.equal(balanceLabel, played < 10 ? '49,90' : '58,20');
  }
  assert.equal(services.read().status, 'spin');
  assert.equal(demo.operations().filter(operation => operation.kind === 'start').length, 1);
  assert.equal(new Set(demo.operations().map(operation => operation.id)).size, 11);
  assert.deepEqual(feedback, ['bet', ...Array(10).fill('free'), 'win']);
});

test('После потери ответа новые ставки блокируются; переоткрытие восстанавливает ровно одну запись', async () => {
  const demo = createCosmicDemo('recovery');
  const { services } = demo;
  let feedback = 0;
  createSlotActions(services).subscribeFeedback(() => feedback++);
  assert.equal(await services.spin('0.10'), null);
  const before = demo.operations();
  assert.equal(before.length, 1);
  assert.equal(demo.pendingId(), before[0].id);
  assert.equal(services.read().balanceLabel, '50,00');
  assert.equal(services.read().status, 'recover');
  await assert.rejects(services.spin('0.10'));
  const reopened = createSlotActions(services);
  reopened.subscribeFeedback(() => feedback++);
  await reopened.recover();
  await assert.rejects(reopened.recover());
  assert.deepEqual(demo.operations(), before);
  assert.equal(services.read().round.id, before[0].id);
  assert.equal(services.read().balanceLabel, '50,02');
  assert.equal(feedback, 0);
});
