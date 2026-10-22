import test from 'node:test';
import assert from 'node:assert/strict';
import { NEOPOLIS_GAME } from '../src/shared/neopolis';
import { LINES } from '../src/shared/neopolisMath';
import { STUDIO_INFO, STUDIO_MAX } from '../src/shared/studioGames';
import { CABINETS } from '../src/shared/cabinets';
import { ACTIVE_STUDIO_GAMES, ARCADE_CABINET_POSITIONS, isRetiredArcadeGame } from '../src/shared/arcadeCatalog';
import { gameModuleContract } from '../src/modules/GameModuleCatalog';
import { BAR_APPROACH, HALLS, HALL_DOORS, hallObstacles } from '../src/shared/world';
import { findPath, walkable } from '../src/game/navigation';

test('Neopolis is an active independent cabinet with its own exact lines and contract', () => {
  assert.deepEqual(gameModuleContract(NEOPOLIS_GAME), { gameId:NEOPOLIS_GAME, slug:'neopolis', apiVersion:1, rulesVersion:2, progressVersion:2 });
  assert((ACTIVE_STUDIO_GAMES as readonly string[]).includes(NEOPOLIS_GAME)); assert(!isRetiredArcadeGame(NEOPOLIS_GAME));
  assert.deepEqual(STUDIO_INFO[NEOPOLIS_GAME].paylines, LINES); assert.equal(STUDIO_MAX[NEOPOLIS_GAME], 3000);
  const cabinet = CABINETS.find(cabinet => cabinet.id === NEOPOLIS_GAME)!;
  assert(cabinet?.wallet && cabinet.playable); assert.deepEqual({x:cabinet.x,y:cabinet.y}, ARCADE_CABINET_POSITIONS[NEOPOLIS_GAME]);
  // Adding this cabinet preserves the positions of all previously active house games.
  const retained = ['studio-cosmic-escape','studio-caramel-carnival','studio-velvet-reign','studio-last-convoy','studio-nitro-run','studio-afterglow','studio-meme-overload','github-crash','royal-plinko','original-cr-vs-leo','studio-dracona'];
  retained.forEach((id,index) => assert.deepEqual(ARCADE_CABINET_POSITIONS[id], {x:1200+index%5*135,y:430+Math.floor(index/5)*270}));
});

test('the new cabinet can be reached from the player spawn, stairs and bar', () => {
  const cabinet = CABINETS.find(cabinet => cabinet.id === NEOPOLIS_GAME)!, target = {x:cabinet.x,y:cabinet.y+43};
  const obstacles = hallObstacles('arcade');
  assert(walkable(target.x,target.y,obstacles,16));
  for (const source of [HALLS.arcade.spawn,HALL_DOORS.arcade.arrival,BAR_APPROACH]) {
    const path = findPath(source,target,obstacles); assert(path.length > 0);
    const last = path.at(-1)!; assert(Math.hypot(last.x-target.x,last.y-target.y) < 30);
  }
});
