import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../src/shared/draconaMath';
import { BOSSES, MAX_ROUND_SPINS, HEROES, LINES, WILD, SCATTER, evaluateLines, playNeopolisSpin, initialTeam, type Hero } from '../src/shared/neopolisMath';
import { advanceNeopolis, emptyNeopolisView, NEOPOLIS_GAME, validNeopolisView, validNeopolisSession, validNeopolisSettings } from '../src/shared/neopolis';
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

test('recorded entropy replays team collection, all real powers, shield upgrades and three boss finishers', () => {
  const draw = rng(42); let previous: { stakeUnits: string; view: ReturnType<typeof startNeopolis>['view'] } | undefined;
  const powers = new Set<Hero>(); let battles = 0, victories = 0;
  for (let spin = 0; spin < 60; spin++) {
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
      const advanced = (next.boss ?? 0) > (oldBattle.boss ?? 0);
      if (!advanced) { assert(oldBattle.shield - next.shield <= 1); assert(oldBattle.core - next.core <= 1); }
      assert.equal(next.remaining, oldBattle.remaining - 1 + (played.finisher ? 3 : 0) + (advanced ? BOSSES[next.boss!].spins : 0));
      if (played.finisher) {
        finishers++; assert.equal(next.defeated, (oldBattle.defeated ?? 0) + 1);
        if (advanced) { assert.equal(next.shield, BOSSES[next.boss!].shield); assert.equal(next.core, BOSSES[next.boss!].core); }
        else { assert.equal(next.core, 0); assert(next.won); }
      }
      assert(validNeopolisView('10000', result.view));
    }
    assert(finishers <= 3);
    assert.equal(result.credit, Number(result.view.totalPayoutUnits));
    assert(result.credit <= 3000 * 10000); assert(result.view.revision <= MAX_ROUND_SPINS);
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
  const session = { id: '11111111-1111-4111-8111-111111111111', gameId: NEOPOLIS_GAME, rulesVersion: 2, state: 'settled', stakeUnits: '10000', spentUnits: '10000', returnedUnits: String(result.credit), view: { player: [], dealer: [], community: [], phase: 2, ended: true, actions: [], message: result.message, neopolis: result.view } };
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
    assert(spin.frames.length <= 83);
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
    assert(spin.frames.length <= 83);
  }
  assert(finishers > 0);
});

test('boss defeats preserve unused spins, add the next arena budget and finish only after Aeon', () => {
  const team = { ...initialTeam('granite'), charges:[3,3,3] };
  for (let boss = 0; boss < BOSSES.length; boss++) {
    const source = {remaining:1,played:boss * 10,shield:0,core:1,won:false,boss,defeated:boss};
    const result = playNeopolisSpin(team,source,()=>.02);
    assert.deepEqual(source,{remaining:1,played:boss * 10,shield:0,core:1,won:false,boss,defeated:boss});
    assert(result.finisher); assert(!result.finished);
    assert.equal(result.battle!.defeated,boss + 1);
    const defeated = result.frames.find(frame => frame.kind === 'boss-defeated')!;
    assert.equal(defeated.battle!.boss,boss); assert.equal(defeated.battle!.core,0);
    if (boss < 2) {
      assert.equal(result.battle!.boss,boss + 1);
      assert.equal(result.battle!.shield,BOSSES[boss + 1].shield);
      assert.equal(result.battle!.core,BOSSES[boss + 1].core);
      assert.equal(result.battle!.remaining,3 + BOSSES[boss + 1].spins);
      assert(!result.battle!.won);
      assert.equal(result.frames.at(-1)!.kind,'boss-arrival');
    } else {
      assert(result.battle!.won); assert.equal(result.battle!.remaining,3);
      let final = result;
      while (!final.finished) final = playNeopolisSpin(final.team,final.battle,()=>.99);
      assert(final.team.complete); assert(final.battle!.won);
      assert.equal(final.battle!.defeated,3);
    }
  }
});

test('legacy v1 transcripts replay unchanged and settled collection upgrades into campaign rules', () => {
  const origin = {...initialTeam('granite'),charges:[3,3,3]};
  let result = advanceNeopolis(emptyNeopolisView(origin,1),'10000',()=>4294967295);
  assert.equal(result.view.version,1); assert(!result.ended);
  assert.equal(result.view.battle!.remaining,10);
  assert.equal(result.view.battle!.boss,undefined);
  assert(validNeopolisView('10000',result.view));
  const legacyDraw = rng(42);
  while (!result.ended) {
    result = moveNeopolis(result.view,'10000',result.view.revision,legacyDraw);
    assert(validNeopolisView('10000',result.view));
  }
  assert.equal(result.view.battle!.boss,undefined); assert(result.view.revision <= 14);
  const old = advanceNeopolis(emptyNeopolisView(initialTeam('granite'),1),'10000',rng(42));
  assert(old.ended && !old.view.team.complete);
  const next = startNeopolis(settings,'10000',{stakeUnits:'10000',view:old.view},rng(11));
  assert.equal(next.view.version,2); assert.deepEqual(next.view.origin,old.view.team);
  const tampered = structuredClone(next.view); tampered.history[0].result.battle = {remaining:100,played:0,shield:5,core:5,won:false,boss:2,defeated:2};
  assert(!validNeopolisView('10000',tampered));
});
