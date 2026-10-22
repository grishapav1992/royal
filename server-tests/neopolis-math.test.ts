import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../src/shared/draconaMath';
import { HEROES, LINES, WILD, SCATTER, evaluateLines, playNeopolisSpin, initialTeam, type Hero } from '../src/shared/neopolisMath';
import { NEOPOLIS_GAME, validNeopolisView, validNeopolisSession, validNeopolisSettings } from '../src/shared/neopolis';
import { startNeopolis, moveNeopolis } from '../server/games/neopolis';
import { validExpansionAction } from '../src/shared/casinoExpansion';
const settings = { neopolis: { hero: 'granite' as const } };
const rng = (seed: number) => { const random = seededRandom(seed); return (max: number) => Math.floor(random() * max); };

test('forty unique fixed lines pay left to right, preserve scatters and apply the Wild multiplier only on matching lines', () => {
  assert.equal(LINES.length, 40); assert.equal(new Set(LINES.map(line => line.join(','))).size, 40);
  const grid = Array(20).fill(SCATTER); grid[0] = 5; grid[1] = WILD; grid[2] = 5;
  const wins = evaluateLines(grid);
  assert(wins.length > 0); assert(wins.every(win => win.count === 3 && win.symbol === 5 && win.points === 15));
  assert(evaluateLines(grid, 1).every(win => win.points === 30));
  assert(evaluateLines(grid, 3).every(win => win.points === 15));
  grid[0] = SCATTER; assert.deepEqual(evaluateLines(grid), []);
});

test('recorded entropy replays team collection, all real powers, shield upgrades and the single finisher', () => {
  const draw = rng(42); let previous: { stakeUnits: string; view: ReturnType<typeof startNeopolis>['view'] } | undefined;
  const powers = new Set<Hero>(); let battles = 0, victories = 0;
  for (let spin = 0; spin < 100; spin++) {
    let result = startNeopolis(settings, '10000', previous, draw);
    if (previous && !previous.view.team.complete) assert.deepEqual(result.view.origin, previous.view.team);
    for (const hero of result.view.history[0].result.activated) powers.add(hero);
    if (!result.ended) battles++;
    let finishers = 0;
    while (!result.ended) {
      const source = result.view, before = structuredClone(source), oldBattle = before.battle!;
      assert.equal(result.credit, 0);
      result = moveNeopolis(result.view, '10000', before.revision, draw);
      assert.deepEqual(source, before);
      const next = result.view.battle!, played = result.view.history.at(-1)!.result;
      assert.equal(new Set(played.activated).size, played.activated.length);
      assert.equal(played.empowered, oldBattle.shield === 0);
      assert(oldBattle.shield - next.shield <= 1); assert(oldBattle.core - next.core <= 1);
      assert.equal(next.remaining, oldBattle.remaining - 1 + (played.finisher ? 3 : 0));
      if (played.finisher) { finishers++; assert.equal(next.core, 0); assert(next.won); }
      assert(validNeopolisView('10000', result.view));
    }
    assert(finishers <= 1);
    assert.equal(result.credit, Number(result.view.totalPayoutUnits));
    assert(result.credit <= 3000 * 10000); assert(result.view.revision <= 14);
    if (result.view.battle) { assert(result.view.team.complete); if (result.view.battle.won) victories++; }
    previous = { stakeUnits: '10000', view: result.view };
  }
  assert.deepEqual([...powers].sort(), [...HEROES].sort()); assert(battles > 0 && victories > 0);
});

test('an unfinished battle ends after the last free spin and preserves its line wins', () => {
  const team = { ...initialTeam('granite'), charges: [3,3,3] };
  const spin = playNeopolisSpin(team, {remaining:1,played:9,shield:1,core:3,won:false}, () => .99);
  assert(spin.finished && spin.team.complete); assert.equal(spin.battle!.remaining, 0);
  assert.equal(spin.battle!.won, false); assert.equal(spin.battle!.shield, 1);
  assert(spin.points > 0); assert.equal(spin.finisher, false);
});

test('changing stake or first hero during collection fails, then becomes possible after the cycle', () => {
  const first = startNeopolis(settings, '10000', undefined, rng(42));
  assert(first.ended && !first.view.team.complete);
  const previous = { stakeUnits: '10000', view: first.view };
  assert.throws(() => startNeopolis(settings, '20000', previous));
  assert.throws(() => startNeopolis({ neopolis: { hero: 'prism' } }, '10000', previous));
  assert.equal(startNeopolis(settings, '10000', previous, rng(43)).view.origin.starter, 'granite');
});

test('modified frames, charges, payouts, random draws and session envelopes cannot pass validation', () => {
  const result = startNeopolis(settings, '10000', undefined, rng(42));
  assert(validNeopolisView('10000', result.view));
  for (const mutate of [
    (v: typeof result.view) => { v.team.charges[1] = (v.team.charges[1] + 1) % 4; },
    (v: typeof result.view) => { v.history[0].result.grid[0] = 99; },
    (v: typeof result.view) => { v.history[0].result.frames[0].grid[0] = 99; },
    (v: typeof result.view) => { v.history[0].payoutUnits = '999999'; },
    (v: typeof result.view) => { v.totalPayoutUnits = '999999'; },
    (v: typeof result.view) => { v.history[0].draws.push(0); },
    (v: typeof result.view) => { v.battle = { remaining: 10, played: 0, shield: 3, core: 3, won: false }; },
  ]) { const value = structuredClone(result.view); mutate(value); assert.equal(validNeopolisView('10000', value), false); }
  const session = { id: '11111111-1111-4111-8111-111111111111', gameId: NEOPOLIS_GAME, rulesVersion: 1, state: 'settled', stakeUnits: '10000', spentUnits: '10000', returnedUnits: String(result.credit), view: { player: [], dealer: [], community: [], phase: 2, ended: true, actions: [], message: result.message, neopolis: result.view } };
  assert(validNeopolisSession(session)); assert.equal(validNeopolisSession({ ...session, returnedUnits: '1' }), false);
  assert.equal(validNeopolisSettings({ neopolis: { hero: 'granite', bonus: true } }), false);
  const action = { id: session.id, gameId: NEOPOLIS_GAME, action: 'start', stakeUnits: '10000', settings };
  assert(validExpansionAction(action)); assert.equal(validExpansionAction({ ...action, payout: 500 }), false);
  assert.equal(validExpansionAction({ id: session.id, gameId: NEOPOLIS_GAME, action: 'move', sessionId: session.id, move: 'studio-spin' }), false);
});

test('each hero protects special symbols and abilities are bounded once per spin', () => {
  const team = { ...initialTeam('impulse'), charges: [3,3,3] };
  for (let seed = 1; seed <= 150; seed++) {
    const random = seededRandom(seed), spin = playNeopolisSpin(team, null, random);
    assert.equal(new Set(spin.activated).size, spin.activated.length);
    assert(spin.frames.length <= 80);
    for (const [index, frame] of spin.frames.entries()) {
      if (frame.kind !== 'hero' || !index) continue;
      const before = spin.frames[index - 1].grid;
      assert(frame.cells.every(cell => before[cell] !== SCATTER));
      if (frame.hero === 'prism') assert(frame.cells.every(cell => before[cell] !== WILD));
    }
  }
});

test('emblems earned during the finisher also activate every unused hero exactly once', () => {
  const team = { ...initialTeam('granite'), charges: [3,3,3] };
  let finishers = 0;
  for (let seed = 1; seed <= 250; seed++) {
    const spin = playNeopolisSpin(team, {remaining:5,played:5,shield:0,core:1,won:false}, seededRandom(seed));
    if (spin.finisher) finishers++;
    const earned = new Set(spin.frames.flatMap(frame => frame.emblems).filter(index => index >= 0).map(index => HEROES[index]));
    assert([...earned].every(hero => spin.activated.includes(hero)));
    assert.equal(new Set(spin.activated).size, spin.activated.length);
    assert(spin.frames.length <= 80);
  }
  assert(finishers > 0);
});
