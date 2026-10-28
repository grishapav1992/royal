import test from 'node:test';
import assert from 'node:assert/strict';
import { NEOPOLIS_GAME } from '../src/shared/neopolis';
import { LINES } from '../src/shared/neopolisMath';
import { STUDIO_INFO, STUDIO_MAX } from '../src/shared/studioGames';
import { CABINETS } from '../src/shared/cabinets';
import { ACTIVE_STUDIO_GAMES, ARCADE_CABINET_POSITIONS, isRetiredArcadeGame, ROYAL_PLATFORM_GAMES } from '../src/shared/arcadeCatalog';
import { gameModuleContract } from '../src/modules/GameModuleCatalog';
import { BAR_APPROACH, HALLS, HALL_DOORS, hallObstacles } from '../src/shared/world';
import { findPath, walkable } from '../src/game/navigation';
import { neopolisCopy } from '../games/neopolis/copy';

test('Neopolis identifies the shared Nile currency in both languages and retains demo preview labels', () => {
  for (const language of ['ru', 'en']) {
    const copy = neopolisCopy(language, true);
    assert.equal(copy.coins, 'USDT');
    assert.match(copy.prototype, /Nile/);
    assert.match(copy.rulesMoney, /0[.,]01 USDT/);
    assert(!/демомонет|demo coin/i.test(copy.rulesMoney + copy.signin + copy.lowBalance));
    assert.notEqual(neopolisCopy(language).coins, 'USDT');
  }
});

test('Neopolis publishes its qualified independent module in Royal with its own physical cabinet', () => {
  assert.deepEqual(gameModuleContract(NEOPOLIS_GAME), { gameId:NEOPOLIS_GAME, slug:'neopolis', apiVersion:1, rulesVersion:4, progressVersion:4 });
  assert((ACTIVE_STUDIO_GAMES as readonly string[]).includes(NEOPOLIS_GAME)); assert(!isRetiredArcadeGame(NEOPOLIS_GAME));
  assert(ROYAL_PLATFORM_GAMES.includes(NEOPOLIS_GAME));
  assert.deepEqual(STUDIO_INFO[NEOPOLIS_GAME].paylines, LINES); assert.equal(STUDIO_MAX[NEOPOLIS_GAME], 3000);
  assert(CABINETS.some(cabinet=>cabinet.id===NEOPOLIS_GAME));
  const cabinet = CABINETS.find(cabinet=>cabinet.id==='studio-dracona')!;
  assert(cabinet?.wallet && cabinet.playable);assert.deepEqual({x:cabinet.x,y:cabinet.y},ARCADE_CABINET_POSITIONS['studio-dracona']);
});

test('the published Dracona cabinet remains reachable from spawn, stairs and bar', () => {
  const cabinet = CABINETS.find(cabinet => cabinet.id === 'studio-dracona')!, target = {x:cabinet.x,y:cabinet.y+43};
  const obstacles = hallObstacles('arcade');
  assert(walkable(target.x,target.y,obstacles,16));
  for (const source of [HALLS.arcade.spawn,HALL_DOORS.arcade.arrival,BAR_APPROACH]) {
    const path = findPath(source,target,obstacles); assert(path.length > 0);
    const last = path.at(-1)!; assert(Math.hypot(last.x-target.x,last.y-target.y) < 30);
  }
});
