import test from 'node:test';
import assert from 'node:assert/strict';
import { PENALTY_RISKS, PENALTY_BETS, penaltyQuote, penaltyPathQuote, penaltyZone, validPenaltySettings, validPenaltyView, type PenaltyRisk, type PenaltyHero } from '../src/shared/crLeo';
import { validExpansionAction } from '../src/shared/casinoExpansion';
import { startPenalty, movePenalty } from '../server/games/crLeo';
import { celebrationPose, celebrationTime, celebrationDuration, CR_SIUU_AT, CR_JUMP_TAKEOFF, CR_JUMP_LANDING, flightPosition, keeperPlacement, PENALTY_CONTACT, PENALTY_RESULT, shotPose, shotTarget, strikePlacement, strikeAnchors } from '../src/ui/crLeoTimeline';
import { spriteParts } from '../src/ui/crLeoSprites';

test('each risk has its exact advertised chance and both heroes share the outcome distribution', () => {
  for (const risk of Object.keys(PENALTY_RISKS) as PenaltyRisk[]) for (const hero of ['cr', 'leo'] as PenaltyHero[]) {
    let won = 0;
    for (let roll = 0; roll < 100; roll++) {
      const view = startPenalty({ penalty: { hero, risk } }, '1000', max => max === 100 ? roll : 0);
      assert(validPenaltyView(view, '1000')); won += Number(view.shots[0].goal);
    }
    assert.equal(won, PENALTY_RISKS[risk].chance);
  }
});
test('exact integer quotes apply 99 percent once, rounding only final money for every risk, stake and stop', () => {
  const rows: any[] = [];
  for (const risk of Object.keys(PENALTY_RISKS) as PenaltyRisk[]) for (const stake of PENALTY_BETS) for (let n = 1; n <= 5; n++) {
    const p = BigInt(PENALTY_RISKS[risk].chance) ** BigInt(n), scale = 100n ** BigInt(n), expectedNumerator = BigInt(stake) * 99n * scale;
    const paid = BigInt(penaltyQuote(stake, risk, n));
    assert.equal(paid, expectedNumerator / (100n * p));
    assert(paid * 100n * p <= expectedNumerator);
    assert((paid + 1n) * 100n * p > expectedNumerator);
    const rtp = Number(paid * p) / Number(BigInt(stake) * scale);
    assert(rtp <= .99 && rtp > .989);
    rows.push({ risk, stake, stop: n, paidUnits: String(paid), rtp });
  }
  assert.equal(rows.length, 60);
});
test('all five goals auto-complete; losing any shot removes the entire unbanked series', () => {
  for (const risk of Object.keys(PENALTY_RISKS) as PenaltyRisk[]) for (let loseAt = 0; loseAt <= 5; loseAt++) {
    let shot = 0; const draw = (max: number) => max === 100 ? shot++ === loseAt ? 99 : 0 : 0;
    let view = startPenalty({ penalty: { hero: 'cr', risk } }, '50000', draw);
    while (view.status === 'playing') view = movePenalty(view, '50000', 'penalty-kick', view.revision, draw);
    assert(validPenaltyView(view, '50000'));
    assert.equal(view.status, loseAt === 5 ? 'complete' : 'lost');
    assert.equal(view.availableUnits, loseAt === 5 ? penaltyQuote('50000', risk, 5) : '0');
    assert.throws(() => movePenalty(view, '50000', 'cashout', view.revision, draw));
  }
});
test('banking closes the series without drawing another outcome; stale revisions cannot advance it', () => {
  let draws = 0; const draw = () => { draws++; return 0; };
  const v = startPenalty({ penalty: { hero: 'leo', risk: 'extreme' } }, '1000', draw), before = draws;
  const paid = movePenalty(v, '1000', 'cashout', 1, draw);
  assert.equal(draws, before); assert.equal(paid.availableUnits, '2200'); assert(validPenaltyView(paid, '1000'));
  assert.throws(() => movePenalty(v, '1000', 'penalty-kick', 0, draw)); assert.equal(draws, before);
});
test('settings, fabricated histories and fabricated money are rejected', () => {
  for (const v of [{}, { penalty: { hero: 'cr', risk: '__proto__' } }, { penalty: { hero: 'other', risk: 'safe' } }, { penalty: { hero: 'cr', risk: 'safe', chance: 100 } }]) assert(!validPenaltySettings(v));
  const v = startPenalty({ penalty: { hero: 'cr', risk: 'safe' } }, '1000', () => 0);
  assert(!validPenaltyView({ ...v, availableUnits: '9999999' }, '1000'));
  assert(!validPenaltyView({ ...v, status: 'complete' }, '1000'));
});
test('flight starts at the striking foot and resolves at the goal before result poses; celebrations differ', () => {
  const from = { x: 10, y: 90 }, to = { x: 100, y: 30 };
  assert.deepEqual(flightPosition(PENALTY_CONTACT, from, to), { ...from, u: 0 });
  const end = flightPosition(PENALTY_RESULT, from, to); assert.equal(end.x, to.x); assert(Math.abs(end.y - to.y) < 1e-8);
  for (const hero of ['cr', 'leo'] as PenaltyHero[]) { assert.equal(shotPose(PENALTY_CONTACT, hero), 4); assert.equal(celebrationPose(3, hero), 11); }
  assert.notEqual(celebrationPose(.9, 'cr'), celebrationPose(.9, 'leo'));
});
test('atlas extraction keeps a whole diving body that crosses a cell and rejects detached fragments', () => {
  const width = 80, height = 40, pixels = new Uint8ClampedArray(width * height * 4);
  const rect = (left: number, top: number, right: number, bottom: number) => { for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) pixels[(y * width + x) * 4 + 3] = 255; };
  for (let cell = 0; cell < 8; cell++) if (cell !== 2) rect(cell % 4 * 20 + 8, Math.floor(cell / 4) * 20 + 4, cell % 4 * 20 + 12, Math.floor(cell / 4) * 20 + 16);
  rect(39, 8, 60, 11); rect(22, 2, 22, 2);
  const { parts, labels } = spriteParts(pixels, width, height, 4, 2);
  assert(parts.every(Boolean)); assert.equal(parts[2]!.left, 39); assert.equal(parts[2]!.right, 60);
  assert.notEqual(labels[8 * width + 39], parts[1]!.id);
  assert.equal(parts[1]!.area, 65);
});

test('CR lands on the selected recording cue after five goals while early cashout and Leo keep their choreography', () => {
  const lead = CR_SIUU_AT - CR_JUMP_LANDING;
  assert.equal(celebrationPose(0, 'cr', true), 7);
  assert.equal(celebrationPose(lead + .01, 'cr', true), 8);
  assert.equal(celebrationPose(lead + CR_JUMP_TAKEOFF + .01, 'cr', true), 10);
  assert.equal(celebrationPose(CR_SIUU_AT - .001, 'cr', true), 10);
  assert.equal(celebrationPose(CR_SIUU_AT + .001, 'cr', true), 11);
  assert(Math.abs(celebrationTime(CR_SIUU_AT, 'cr', true) - CR_JUMP_LANDING) < 1e-9);
  assert(celebrationDuration('cr', true) > 4.62);
  assert.equal(celebrationDuration('cr'), 4.3);
  assert.equal(celebrationPose(.9, 'cr'), 10);
  assert.equal(celebrationDuration('leo', true), 4.3);
  for (const t of [0, .6, 1.2, 1.8, 3]) assert.equal(celebrationPose(t, 'leo', true), celebrationPose(t, 'leo'));
});

test('right and left strike anchors land exactly on the same penalty ball',()=>{for(const hero of ['cr','leo'] as const){const ball={x:640,y:420},size=260,place=strikePlacement(hero,ball,size),toe=strikeAnchors[hero];assert(Math.abs(place.x+(toe.x-.5)*size-ball.x)<1e-9);assert(Math.abs(place.bottom+(.0+toe.y-.94)*size-ball.y)<1e-9);}});

test('every mixed risk path has its exact payout, one house edge and only final-money rounding', () => {
  let quotes = 0;
  const visit = (path: PenaltyRisk[]) => {
    if (path.length) for (const stake of PENALTY_BETS) {
      const p = path.reduce((n,r) => n * BigInt(PENALTY_RISKS[r].chance), 1n), scale = 100n ** BigInt(path.length), numerator = BigInt(stake) * 99n * scale;
      const paid = BigInt(penaltyPathQuote(stake, path));
      assert.equal(paid, numerator / (100n * p)); assert(paid * 100n * p <= numerator && (paid+1n)*100n*p > numerator);
      assert(Number(paid*p)/Number(BigInt(stake)*scale) <= .990000000001); assert(paid < BigInt(stake)*54n); quotes++;
    }
    if (path.length < 5) for (const risk of Object.keys(PENALTY_RISKS) as PenaltyRisk[]) visit([...path,risk]);
  };
  visit([]); assert.equal(quotes,1452); assert.equal(penaltyPathQuote('1000',['safe','extreme']),'2933');
  for(const stake of PENALTY_BETS){
    const best = (path: PenaltyRisk[]):number => {
      const bank = Number(penaltyPathQuote(stake,path));
      return path.length===5?bank:Math.max(bank,...(Object.keys(PENALTY_RISKS) as PenaltyRisk[]).map(r=>PENALTY_RISKS[r].chance/100*best([...path,r])));
    };
    const expected = Math.max(...(Object.keys(PENALTY_RISKS) as PenaltyRisk[]).map(r=>PENALTY_RISKS[r].chance/100*best([r])));
    assert(expected<=Number(stake)*.99+1e-7,'adaptive switching and stopping must never remove the house edge');
  }
});
test('risk switching preserves accepted history and cashout, supports legacy saves and rejects fabricated paths',()=>{
  const first=startPenalty({penalty:{hero:'leo',risk:'safe'}},'1000',()=>0);
  const next=movePenalty(first,'1000','penalty-kick',1,()=>0,'extreme');
  assert.equal(first.availableUnits,'1320'); assert.equal(next.availableUnits,'2933'); assert.deepEqual(next.shots.map(s=>s.risk),['safe','extreme']); assert(validPenaltyView(next,'1000'));
  const paid=movePenalty(next,'1000','cashout',2,()=>{throw Error('must not draw');});assert.equal(paid.availableUnits,'2933');assert(validPenaltyView(paid,'1000'));
  assert(!validPenaltyView({...next,availableUnits:penaltyQuote('1000','extreme',2)},'1000'));
  assert(!validPenaltyView({...next,shots:next.shots.map((s,i)=>i?{...s,zone:18}:s)},'1000'));
  const legacy={...first,version:1,shots:first.shots.map(({risk,zone,...s})=>s)};
  assert(validPenaltyView(legacy,'1000'));const migrated=movePenalty(legacy,'1000','penalty-kick',1,()=>0,'extreme');assert.equal(migrated.availableUnits,'2933');assert(validPenaltyView(migrated,'1000'));
  const op={id:'11111111-1111-4111-8111-111111111111',gameId:'original-cr-vs-leo',action:'move',sessionId:'22222222-2222-4222-8222-222222222222',move:'penalty-kick',revision:1,penaltyRisk:'safe'};
  assert(validExpansionAction(op));for(const invalid of [{...op,penaltyRisk:'__proto__'},{...op,chance:100},{...op,zone:0},{...op,move:'cashout'}])assert(!validExpansionAction(invalid));
});
test('all eighteen sectors are cosmetic and have the same exact goal chance for either player and every risk',()=>{
  for(const hero of ['cr','leo'] as const)for(const risk of Object.keys(PENALTY_RISKS) as PenaltyRisk[])for(let zone=0;zone<18;zone++){
    let goals=0;for(let roll=0;roll<100;roll++){const v=startPenalty({penalty:{hero,risk}},'1000',max=>max===100?roll:max===18?zone:0);assert.equal(v.shots[0].zone,zone);assert.equal(v.shots[0].side,penaltyZone(zone).side);assert(validPenaltyView(v,'1000'));goals+=Number(v.shots[0].goal);}assert.equal(goals,PENALTY_RISKS[risk].chance);
  }
});
test('sector trajectories finish inside each referenced cell; saves meet gloves and misses hit frame or go outside',()=>{
  const goal={x:640,bottom:400,width:600,height:200},from={x:640,y:700};const points=new Set<string>();
  for(let id=0;id<18;id++){
    const zone=penaltyZone(id),shot={index:0,goal:true,finish:'goal' as const,side:zone.side,zone:id,risk:'safe' as const};
    const to=shotTarget(shot,goal),column=Math.floor((to.x-340)/100),row=Math.floor((to.y-200)/(200/3));assert.equal(column,zone.column);assert.equal(row,zone.row);points.add(JSON.stringify(to));
    for(const arc of [.025,.12,.3]){assert.deepEqual(flightPosition(PENALTY_CONTACT,from,to,arc,15),{...from,u:0});const end=flightPosition(PENALTY_RESULT,from,to,arc,15);assert(Math.abs(end.x-to.x)<1e-7&&Math.abs(end.y-to.y)<1e-7);}
    for(const hand of [{x:.1,y:.1},{x:.5,y:.05},{x:.9,y:.66}]){const p=keeperPlacement(to,hand,100);assert(Math.abs(p.x+(hand.x-.5)*100-to.x)<1e-7);assert(Math.abs(p.bottom+(hand.y-.94)*100-to.y)<1e-7);}
    const post=shotTarget({...shot,goal:false,finish:'post'},goal);assert(post.x===340||post.x===940||post.y===200);
    const wide=shotTarget({...shot,goal:false,finish:'wide'},goal);assert(wide.x<340||wide.x>940||wide.y<200);
  }assert.equal(points.size,18);assert.deepEqual(Array.from({length:18},(_,id)=>penaltyZone(id).number),[9,8,7,7,8,9,6,5,4,4,5,6,3,2,1,1,2,3]);
});
