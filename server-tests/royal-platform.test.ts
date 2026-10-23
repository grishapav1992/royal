import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetsInHall } from '../src/shared/cabinets';
import { ROYAL_PLATFORM_GAMES, ARCADE_GITHUB_GAMES, PLATFORM_CABINET_DEFAULTS, isPlatformGame } from '../src/shared/arcadeCatalog';
import { gameModuleContract } from '../src/modules/GameModuleCatalog';
import { royalGameArtwork } from '../src/ui/RoyalGameArtwork';

test('twenty stable physical seats have different default games with matching artwork and supported modules', () => {
  const cabinets=cabinetsInHall('arcade');
  assert.equal(cabinets.length,20);
  assert.equal(new Set(cabinets.map(c=>c.defaultGameId)).size,20);
  assert.equal(new Set(cabinets.map(c=>royalGameArtwork(c.defaultGameId!))).size,20);
  assert.deepEqual(cabinets.map(c=>c.id).sort(),Object.keys(PLATFORM_CABINET_DEFAULTS).sort());
  for(const cabinet of cabinets){
    assert.equal(cabinet.defaultGameId,PLATFORM_CABINET_DEFAULTS[cabinet.id]);
    assert.ok(isPlatformGame(cabinet.defaultGameId!));
    assert.ok(gameModuleContract(cabinet.defaultGameId!));
    assert.ok(royalGameArtwork(cabinet.defaultGameId!));
    assert.ok(!cabinet.demo&&!cabinet.provider);
  }
  assert.ok(CABINETS.filter(c=>c.hall==='github').every(c=>!c.defaultGameId));
});

test('the common catalogue contains exactly the RoyalGames collection and ten first-floor GitHub games',()=>{
  assert.equal(ROYAL_PLATFORM_GAMES.length,50);
  assert.equal(new Set(ROYAL_PLATFORM_GAMES).size,50);
  assert.equal(ROYAL_PLATFORM_GAMES.filter(id=>!ARCADE_GITHUB_GAMES.includes(id as any)).length,40);
  for(const id of ROYAL_PLATFORM_GAMES)assert.ok(gameModuleContract(id));
  assert.equal(isPlatformGame('casinoapipro'),true);
  for(const id of ['luelon','variant-double-mines','github-blackjack','hockey'])assert.equal(isPlatformGame(id),false);
});
