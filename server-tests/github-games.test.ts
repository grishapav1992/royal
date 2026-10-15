import test from 'node:test';
import assert from 'node:assert/strict';
import { blackjackScore, shuffledDeck, dealBaccarat, pokerHand, comparePoker, videoRank, VIDEO_PAYOUTS } from '../src/shared/githubGames';
import { Game, PlayerBet, PassLineBet, FieldBet, AnySevenBet, DiceRoll } from '../src/vendor/github/craps/engine';
import { shouldBankerDraw } from '../src/vendor/github/baccarat/rules';
import { HALLS, hallLinks, hallLinkAt, hallObstacles } from '../src/shared/world';
import { cabinetsInHall } from '../src/shared/cabinets';
import { BASE_EXPANSION_GAMES } from '../src/shared/casinoExpansion';
import { findPath, walkable } from '../src/game/navigation';

test('all casino cabinets are on floor one and each connected door and cabinet is reachable', () => {
  assert.equal(cabinetsInHall('arcade').length, 15+BASE_EXPANSION_GAMES.length);
  assert.equal(cabinetsInHall('tables').length, 0);
  assert.equal(cabinetsInHall('github').length, 0);
  for (const hall of Object.keys(HALLS) as (keyof typeof HALLS)[]) {
    const obstacles = hallObstacles(hall);
    for (const link of hallLinks(hall)) {
      assert.equal(hallLinkAt({ ...link.door.entry, hall })?.target, link.target);
      assert(!hallLinkAt({ ...link.arrival.arrival, hall: link.target }));
      assert(walkable(link.door.entry.x, link.door.entry.y, obstacles));
      assert(findPath(HALLS[hall].spawn, link.door.entry, obstacles).length);
      for (const cabinet of cabinetsInHall(hall)) assert(findPath(link.door.arrival, { x: cabinet.x, y: cabinet.y + 43 }, obstacles).length, cabinet.id);
    }
  }
  assert.equal(hallLinkAt({ x: 800, y: 240, hall: 'arcade' }), undefined);
  assert.equal(hallLinkAt({ x: 800, y: 240, hall: 'tables' })?.target, 'github');
});
test('blackjack handles multiple aces, natural 21 and busts', () => {
  assert.equal(blackjackScore(['AS', 'AH', '9D']), 21);
  assert.equal(blackjackScore(['AS', 'AH', '9D', 'KC']), 21);
  assert.equal(blackjackScore(['AS', 'KC']), 21);
  assert.equal(blackjackScore(['KC', 'QH', '2D']), 22);
});
test('practice decks preserve all 52 distinct cards, one joker and eight baccarat copies', () => {
  const deck = shuffledDeck(); assert.equal(deck.length, 52); assert.equal(new Set(deck).size, 52);
  const joker = shuffledDeck(true); assert.equal(joker.length, 53); assert.equal(new Set(joker).size, 53);
  const shoe = shuffledDeck(false, 8); assert.equal(shoe.length, 416);
  for (const card of deck) assert.equal(shoe.filter(value => value === card).length, 8);
});
test('baccarat respects naturals, modulo ten and every banker third-card exception', () => {
  const natural = dealBaccarat(['2C', '3D', '4H', '4S']);
  assert.equal(natural.playerTotal, 8); assert.equal(natural.player.length, 2); assert.equal(natural.banker.length, 2);
  const totals = (total: number) => [{ rank: 'K' as const, suit: 'spade' as const }, { rank: String(total) as any, suit: 'heart' as const }];
  for (let total = 2; total <= 7; total++) for (let third = 0; third <= 9; third++) {
    const expected = total <= 2 || total === 3 && third !== 8 || total === 4 && third >= 2 && third <= 7 || total === 5 && third >= 4 && third <= 7 || total === 6 && (third === 6 || third === 7);
    assert.equal(shouldBankerDraw(totals(total), { rank: (third === 0 ? 'K' : String(third)) as any, suit: 'club' }), expected, `${total}/${third}`);
  }
});
test('video poker joker upgrades hands with the retained Lucky Five paytable', () => {
  for (const [hand, rank, payout] of [
    [['AS','AH','AD','AC','JJ'],10,250], [['AS','KS','QS','JS','JJ'],9,100],
    [['2S','3S','4S','5S','JJ'],8,40], [['2S','2H','2D','KC','KH'],6,8],
    [['AS','2H','3D','4C','5S'],4,4], [['AS','AH','KD','KC','2H'],2,1],
    [['AS','AH','KD','QC','2H'],1,0],
  ] as const) { assert.equal(videoRank(hand), rank); assert.equal(VIDEO_PAYOUTS[rank], payout); }
});
test('poker compares the best five of seven, wheel straights and every kicker', () => {
  assert.equal(pokerHand(['AS','2H','3D','4C','5S','5D','KH']).rank, 4);
  assert.equal(pokerHand(['AS','KS','QS','JS','TS','2D','3H']).rank, 9);
  assert(comparePoker(pokerHand(['AS','AH','KD','QC','9H','3D','2C']), pokerHand(['AD','AC','KH','QS','8H','3C','2D'])) > 0);
  assert(comparePoker(pokerHand(['AS','2H','3D','4C','5S','9D','KH']), pokerHand(['2S','3H','4D','5C','6S','9H','KD'])) < 0);
});
test('Craps Pass Line preserves a point until it repeats or seven wins, and one-roll bets pay correctly', () => {
  const game = new Game(1, 10000, 10000), settlements: number[] = [];
  game.makeBet(new PlayerBet(1, new PassLineBet(), 10));
  game.rollComplete(new DiceRoll(2, 3), (_bet: unknown, pay: number) => settlements.push(pay));
  assert.equal(game.pointValue, 5); assert.deepEqual(settlements, []);
  game.rollComplete(new DiceRoll(3, 3), (_bet: unknown, pay: number) => settlements.push(pay));
  assert.deepEqual(settlements, []);
  game.rollComplete(new DiceRoll(1, 4), (_bet: unknown, pay: number) => settlements.push(pay));
  assert.deepEqual(settlements, [10]); assert.equal(game.pointValue, 0);
  for (const [Type, dice, expected] of [[FieldBet, [1,1],20], [FieldBet,[6,6],30], [AnySevenBet,[3,4],40], [AnySevenBet,[1,1],-10]] as const) {
    const round = new Game(1,10000,10000); round.makeBet(new PlayerBet(0,new PassLineBet(),10)); round.makeBet(new PlayerBet(1,new Type(),10));
    round.rollComplete(new DiceRoll(...dice), (bet: {pid:number}, pay:number) => { if(bet.pid===1)assert.equal(pay,expected); });
  }
});
