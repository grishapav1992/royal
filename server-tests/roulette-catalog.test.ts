import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionGames,isCollectionGame,ARCADE_CABINET_SPECS,isRetiredArcadeGame} from '../src/shared/arcadeCatalog';
import {CABINETS,GAME_CABINETS} from '../src/shared/cabinets';
import {gameModuleContract} from '../src/modules/GameModuleCatalog';
import {royalCatalogArtwork} from '../src/ui/RoyalCatalogArtwork';

test('European roulette opens from Royal seats as its existing independent wallet module',()=>{
 assert.equal(collectionGames('royal').filter(id=>id==='royal-roulette').length,1);
 assert(!isCollectionGame('github','royal-roulette'));assert(!isRetiredArcadeGame('royal-roulette'));
 const game=GAME_CABINETS.find(game=>game.id==='royal-roulette');assert(game?.wallet);assert(!game?.demo);
 assert.deepEqual(gameModuleContract('royal-roulette'),{gameId:'royal-roulette',slug:'royal-roulette',apiVersion:1,rulesVersion:1,progressVersion:1});
 assert.equal(CABINETS.filter(c=>c.hall==='arcade').length,12);
 assert.equal(ARCADE_CABINET_SPECS.length,12);
 assert.equal(royalCatalogArtwork('royal-roulette'),'/assets/royal-roulette/cover.svg');
});
