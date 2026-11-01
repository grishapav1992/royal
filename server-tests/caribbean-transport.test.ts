import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startCaribbean,moveCaribbean } from '../server/games/caribbeanTreasures';
import { CARIBBEAN_GAME } from '../src/shared/caribbeanTreasures';
import { CARIBBEAN_LINE_COUNTS } from '../src/shared/caribbeanTreasuresMath';
import { validExpansionAction,type ExpansionSession } from '../src/shared/casinoExpansion';
import { caribbeanExpansionView,validCaribbeanSession,validCaribbeanReply } from '../src/shared/caribbeanTransport';
import { gameModuleContract } from '../src/modules/GameModuleCatalog';
import { cabinetsInHall,GAME_CABINETS } from '../src/shared/cabinets';
import { collectionGames } from '../src/shared/arcadeCatalog';
function fixture() {
  const settings = {caribbean:{lines:20 as const,mode:'normal' as const}}, id = randomUUID();
  const start = startCaribbean(settings.caribbean,'100',() => 0);
  const session:ExpansionSession = {id,gameId:CARIBBEAN_GAME,rulesVersion:1,state:'active',stakeUnits:'100',spentUnits:start.costUnits,returnedUnits:'0',view:caribbeanExpansionView(start.view)};
  const operation = {id,gameId:CARIBBEAN_GAME,action:'start' as const,stakeUnits:'100',settings};
  return {session,operation};
}
test('the catalogue adds a loadable slot without adding physical seats or retiring legacy games',() => {
  assert.equal(cabinetsInHall('arcade').length,13); // Includes the independently added Hong Kong Warrior seat.
  assert.equal(cabinetsInHall('arcade').some(cabinet => cabinet.id === CARIBBEAN_GAME),false);
  assert(collectionGames('royal').includes(CARIBBEAN_GAME));
  assert(GAME_CABINETS.some(cabinet => cabinet.id === CARIBBEAN_GAME && cabinet.wallet));
  assert.deepEqual(gameModuleContract(CARIBBEAN_GAME),{gameId:CARIBBEAN_GAME,slug:'caribbean-treasures',apiVersion:1,rulesVersion:2,progressVersion:1});
  for (const id of ['studio-neopolis','studio-dracona','studio-cosmic-escape']) assert(collectionGames('royal').includes(id));
});
test('transport accepts every declared preset and rejects foreign moves, extra fields and missing revisions',() => {
  const {operation,session} = fixture();
  for (const lines of CARIBBEAN_LINE_COUNTS) assert(validExpansionAction({...operation,settings:{caribbean:{lines,mode:'normal'}}}));
  for (const move of ['caribbean-spin','caribbean-choose-raid','caribbean-choose-flagship']) {
    const action = {id:randomUUID(),gameId:CARIBBEAN_GAME,action:'move',sessionId:session.id,move,revision:1};
    assert(validExpansionAction(action));
    assert(!validExpansionAction({...action,picks:[0]}));
    assert(!validExpansionAction({...action,revision:undefined}));
    assert(!validExpansionAction({...action,gameId:'github-crash'}));
  }
  assert(!validExpansionAction({...operation,appearance:{girl:0,look:0}}));
  assert(!validExpansionAction({...operation,settings:{caribbean:{lines:2,mode:'normal'}}}));
});
test('session envelopes reject altered money, actions and embedded foreign game state',() => {
  const {session} = fixture(); assert(validCaribbeanSession(session));
  for (const edit of [
    (value:any) => { value.stakeUnits='1000'; },(value:any) => { value.spentUnits='1'; },
    (value:any) => { value.returnedUnits='999'; },(value:any) => { value.view.actions[0].cost=1; },
    (value:any) => { value.view.actions[0].move='cashout'; },(value:any) => { value.view.neopolis={}; },
    (value:any) => { value.rulesVersion=2; },(value:any) => { value.view.ended=true; },
    (value:any) => { value.settings={}; },
  ]) { const bad=structuredClone(session);edit(bad);assert(!validCaribbeanSession(bad)); }
});
test('reply validation pins accepted settings, operation revision and the consistent session list',() => {
  const {session,operation} = fixture();
  assert(validCaribbeanReply(session,operation,false,[session]));
  assert(!validCaribbeanReply(session,{...operation,settings:{caribbean:{lines:1,mode:'normal'}}},false,[session]));
  assert(!validCaribbeanReply(session,operation,false,[]));
  const next = moveCaribbean(session.view.caribbean!,1,'choose-raid',() => 0);
  const updated:ExpansionSession = {...session,view:caribbeanExpansionView(next.view)};
  const move = {id:randomUUID(),gameId:CARIBBEAN_GAME,action:'move' as const,sessionId:session.id,move:'caribbean-choose-raid',revision:1};
  assert(validCaribbeanReply(updated,move,false,[updated]));
  assert(!validCaribbeanReply(updated,{...move,move:'caribbean-choose-flagship'},false,[updated]));
  assert(!validCaribbeanReply(updated,{...move,revision:2},true,[updated]));
});
