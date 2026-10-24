import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVED_GITHUB_GAMES } from '../src/shared/arcadeCatalog';
import { STUDIO_GAMES } from '../src/shared/studioGames';
import { IMPORTED_MOTION_GAMES, IMPORTED_OUTCOME_EVENT, emitImportedOutcome, importedOutcomeTier } from '../src/ui/importedMotion/Outcome';

test('presentation scope is exactly the archived nine GitHub games and excludes RoyalGames', () => {
  assert.deepEqual([...IMPORTED_MOTION_GAMES].sort(), [...ARCHIVED_GITHUB_GAMES].sort());
  for (const game of [...STUDIO_GAMES, 'royal-plinko', 'github-crash', 'original-cr-vs-leo']) assert(!IMPORTED_MOTION_GAMES.includes(game as any));
});
test('partial returns and stake returns never receive win celebrations', () => {
  assert.equal(importedOutcomeTier('10000', '0'), 'none');
  assert.equal(importedOutcomeTier('10000', '9999'), 'none');
  assert.equal(importedOutcomeTier('10000', '10000'), 'return');
  assert.equal(importedOutcomeTier('10000', '10001'), 'win');
  assert.equal(importedOutcomeTier('10000', '49999'), 'win');
  assert.equal(importedOutcomeTier('10000', '50000'), 'big');
  assert.equal(importedOutcomeTier('10000', '200000'), 'epic');
});
test('money comparisons preserve precision beyond JavaScript integers', () => {
  assert.equal(importedOutcomeTier('9007199254740992', '9007199254740993'), 'win');
  assert.equal(importedOutcomeTier('9007199254740993', '9007199254740992'), 'none');
  for (const [stake, returned] of [['0','100'],['NaN','100'],['100','-1'],['1.5','2'],['1','1e9']]) assert.equal(importedOutcomeTier(stake, returned), undefined);
});
test('confirmed hooks retain exact amounts and cannot emit effects for other games', () => {
  const host = new EventTarget() as HTMLElement, events: unknown[] = [];
  host.addEventListener(IMPORTED_OUTCOME_EVENT, event => events.push((event as CustomEvent).detail));
  emitImportedOutcome(host, {gameId:'studio-dracona',spentUnits:'100',returnedUnits:'10000'});
  assert.equal(events.length, 0);
  const result = {gameId:'royal-keno',spentUnits:'100',returnedUnits:'500'};
  emitImportedOutcome(host, result);
  assert.deepEqual(events, [result]);
});
