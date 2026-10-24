import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetsInHall } from '../src/shared/cabinets';
import { ARCADE_GITHUB_GAMES, ARCADE_CABINET_SPECS, ROYAL_COLLECTION_GAMES, ROYAL_PLATFORM_GAMES, collectionGames, isCollectionGame } from '../src/shared/arcadeCatalog';
import { CLUB_ZONES } from '../src/shared/clubLayout';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { gameModuleContract } from '../src/modules/GameModuleCatalog';

test('twelve collection seats keep Royal and GitHub separate on the common USDT wallet', () => {
  const cabinets=cabinetsInHall('arcade');
  assert.equal(cabinets.length,12);
  assert.equal(new Set(CABINETS.map(c=>c.id)).size,CABINETS.length);
  for(const [collection,count] of Object.entries({royal:12,github:0,casinoapipro:0,luelon:0})) {
    assert.equal(cabinets.filter(c=>c.collection===collection).length,count);
  }
  for(const c of cabinets){
    assert.ok(gameModuleContract(c.defaultGameId??c.id));
    assert.equal(c.demo,c.collection==='luelon');
    assert.equal(c.provider,c.collection==='casinoapipro');
  }
  assert.equal(new Set(cabinets.map(c=>`${cabinetSeat(c).x},${cabinetSeat(c).y}`)).size,12);
  assert.ok(CABINETS.filter(c=>c.hall==='github').every(c=>!c.collection&&!c.defaultGameId));
});

test('the source collections are disjoint, complete and prohibit cross-collection launches',()=>{
  assert.deepEqual([...ROYAL_COLLECTION_GAMES,...ARCADE_GITHUB_GAMES].sort(),[...ROYAL_PLATFORM_GAMES].sort());
  assert.equal(new Set(ROYAL_PLATFORM_GAMES).size,ROYAL_PLATFORM_GAMES.length);
  assert.equal(ARCADE_GITHUB_GAMES.length,0);
  assert.equal(ROYAL_PLATFORM_GAMES.includes('studio-neopolis'),true);
  assert.deepEqual(collectionGames('casinoapipro'),[]);
  for(const source of ['royal','github','casinoapipro'] as const){
    for(const id of collectionGames(source)) {
      assert.ok(gameModuleContract(id));assert.ok(isCollectionGame(source,id));
      for(const other of ['royal','github','casinoapipro'] as const)if(source!==other)assert.equal(isCollectionGame(other,id),false);
    }
    for(const id of ['luelon','variant-double-mines','github-blackjack','hockey'])assert.equal(isCollectionGame(source,id),false);
  }
});

test('each collection fits its own nonoverlapping carpet, including the seats and entry paths',()=>{
  const names={royal:'ROYAL · НАШИ ИГРЫ'};
  for(const [collection,name] of Object.entries(names)){
    const zone=CLUB_ZONES.arcade.find(z=>z.name===name)!;assert.ok(zone);
    for(const spec of ARCADE_CABINET_SPECS.filter(c=>c.collection===collection)) {
      const cabinet=cabinetsInHall('arcade').find(c=>c.id===spec.id)!;
      const seat=cabinetSeat(cabinet);
      assert.ok(spec.x-49>zone.x&&spec.x+49<zone.x+zone.w);
      assert.ok(spec.y-142>zone.y&&seat.entry.y<zone.y+zone.h);
    }
  }
});
