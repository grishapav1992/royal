/** Executable examples for stage 1, not the production engine or an RTP proof. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const examples = JSON.parse(readFileSync(new URL('../../docs/game-design/flooded-temple-stage1.json', import.meta.url), 'utf8'));
const edgeKey = (a, b) => [a, b].sort((x, y) => x - y).join(':');
const adjacent = (a, b, cols) => Math.abs(a % cols - b % cols) + Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) === 1;

function validate(map) {
  assert.equal(map.cols, 5);
  assert.equal(map.rows, 4);
  assert.equal(map.entry, 5);
  const count = map.cols * map.rows, keys = new Set();
  const room = value => assert.ok(Number.isInteger(value) && value >= 0 && value < count, 'Room outside board');
  for (const edge of map.edges) {
    room(edge.a); room(edge.b);
    assert.ok(adjacent(edge.a, edge.b, map.cols), 'Doors must join adjacent rooms');
    assert.ok(['open', 'gate', 'gap'].includes(edge.kind));
    assert.ok(!keys.has(edgeKey(edge.a, edge.b)), 'Duplicate edge');
    keys.add(edgeKey(edge.a, edge.b));
  }
  const occupied = new Set([map.entry]);
  for (const [id, value] of Object.entries(map.treasures)) {
    room(Number(id));
    assert.ok(!occupied.has(Number(id)), 'One content kind per room');
    occupied.add(Number(id));
    assert.ok(Number.isInteger(value) && value > 0);
  }
  for (const [id, target] of Object.entries(map.levers)) {
    room(Number(id));
    assert.ok(!occupied.has(Number(id)), 'One content kind per room');
    occupied.add(Number(id));
    assert.ok(map.edges.some(e => edgeKey(e.a, e.b) === target && e.kind === 'gate'), 'Lever needs a gate');
  }
  for (const id of map.relics) {
    room(id);
    assert.ok(!occupied.has(id), 'One content kind per room');
    occupied.add(id);
  }
  if ('steps' in map) { assert.equal(map.steps, 6); assert.equal(map.ropes, 1); assert.equal(map.relics.length, 0); }
}

function baseExplore(map) {
  validate(map);
  const visited = new Set(), opened = new Set(), events = [];
  while (true) {
    const distances = new Map([[map.entry, 0]]), queue = [map.entry];
    for (const from of queue) {
      for (const edge of map.edges) {
        if (edge.kind !== 'open' && !opened.has(edgeKey(edge.a, edge.b))) continue;
        const to = edge.a === from ? edge.b : edge.b === from ? edge.a : null;
        if (to === null || distances.has(to)) continue;
        distances.set(to, distances.get(from) + 1); queue.push(to);
      }
    }
    const next = [...distances.keys()].filter(id => !visited.has(id)).sort((a, b) => distances.get(a) - distances.get(b) || a - b)[0];
    if (next === undefined) break;
    visited.add(next); events.push(next);
    if (map.levers[next]) opened.add(map.levers[next]);
  }
  return {
    visited: [...visited].sort((a, b) => a - b), events,
    scoreHundredths: [...visited].reduce((sum, id) => sum + (map.treasures[id] || 0), 0),
    bonus: map.relics.some(id => visited.has(id)),
  };
}

function start(map) {
  validate(map);
  const state = { at: map.entry, left: map.steps, ropes: map.ropes, visited: [map.entry], opened: [], bridge: null, scoreHundredths: 0, done: false };
  state.done = !moves(map, state).length;
  return state;
}

function moves(map, state) {
  if (state.done || !state.left) return [];
  return map.edges.flatMap(edge => {
    const to = edge.a === state.at ? edge.b : edge.b === state.at ? edge.a : null;
    if (to === null) return [];
    const key = edgeKey(edge.a, edge.b);
    if (edge.kind === 'open' || state.opened.includes(key) || state.bridge === key) return [{ to, rope: false }];
    return edge.kind === 'gap' && state.ropes ? [{ to, rope: true }] : [];
  });
}

function move(map, state, action) {
  assert.ok(moves(map, state).some(legal => legal.to === action.to && legal.rope === action.rope), 'Illegal move');
  const next = structuredClone(state);
  next.left--; next.at = action.to;
  if (action.rope) { next.ropes--; next.bridge = edgeKey(state.at, action.to); }
  if (!next.visited.includes(action.to)) {
    next.visited.push(action.to);
    next.scoreHundredths += map.treasures[action.to] || 0;
    const gate = map.levers[action.to];
    if (gate && !next.opened.includes(gate)) next.opened.push(gate);
  }
  next.done = !next.left || !moves(map, next).length;
  return next;
}

function follow(example) {
  let state = start(examples.bonus);
  for (const [index, to] of example.path.entries()) state = move(examples.bonus, state, { to, rope: index + 1 === example.ropeAt });
  return state;
}

test('both rule examples have valid room contents, doors and lever targets', () => {
  validate(examples.base); validate(examples.bonus);
});
test('row wrap, diagonal, invalid room and duplicate edge are rejected', () => {
  for (const edge of [{ a: 4, b: 5, kind: 'open' }, { a: 6, b: 12, kind: 'open' }, { a: -1, b: 0, kind: 'open' }, examples.base.edges[0]]) {
    assert.throws(() => validate({ ...examples.base, edges: [...examples.base.edges, edge] }));
  }
});
test('base lever exposes the relic; unreachable treasure is not collected', () => {
  const result = baseExplore(examples.base);
  for (const field of ['visited', 'scoreHundredths', 'bonus']) assert.deepEqual(result[field], examples.base.expected[field]);
  assert.deepEqual(result.events, [5, 6, 11, 7, 8, 12, 9]);
});
test('without the lever the gate stays closed and there is no bonus', () => {
  const result = baseExplore({ ...examples.base, levers: {} });
  assert.equal(result.bonus, false); assert.equal(result.scoreHundredths, 50);
});
test('a connected cycle cannot duplicate visits, chest awards or a bonus', () => {
  const cyclic = { ...examples.base, edges: [...examples.base.edges, { a: 5, b: 10, kind: 'open' }, { a: 10, b: 11, kind: 'open' }] };
  const result = baseExplore(cyclic);
  assert.equal(result.events.length, new Set(result.events).size);
  assert.equal(result.scoreHundredths, 270); assert.equal(result.bonus, true);
});
for (const example of examples.bonus.examples) test(`six-step route ${example.id} collects its declared reward`, () => {
  const state = follow(example);
  assert.equal(state.left, 0); assert.equal(state.done, true); assert.equal(state.scoreHundredths, example.scoreHundredths);
});
test('the sixth transition collects its chest before ending the expedition', () => {
  let state = start(examples.bonus);
  for (const [index, to] of [6, 11, 12, 13, 8].entries()) state = move(examples.bonus, state, { to, rope: index === 2 });
  assert.equal(state.scoreHundredths, 150); assert.equal(state.left, 1);
  state = move(examples.bonus, state, { to: 9, rope: false });
  assert.equal(state.scoreHundredths, 350); assert.equal(state.done, true);
});
test('revisiting a chest spends a step without a second award', () => {
  let state = start(examples.bonus);
  for (const to of [6, 7, 6, 7]) state = move(examples.bonus, state, { to, rope: false });
  assert.equal(state.scoreHundredths, 20); assert.equal(state.left, 2);
});
test('a gap requires explicit rope; the bridge then supports free-of-charge return crossings', () => {
  let state = start(examples.bonus);
  for (const to of [6, 11]) state = move(examples.bonus, state, { to, rope: false });
  assert.throws(() => move(examples.bonus, state, { to: 12, rope: false }), /Illegal move/);
  for (const [to, rope] of [[12, true], [11, false], [12, false], [13, false]]) state = move(examples.bonus, state, { to, rope });
  assert.equal(state.ropes, 0); assert.equal(state.bridge, '11:12'); assert.equal(state.scoreHundredths, 150);
});
test('illegal actions do not mutate state or consume a step', () => {
  const state = start(examples.bonus), before = JSON.stringify(state);
  for (const action of [{ to: 0, rope: false }, { to: 11, rope: false }, { to: 6, rope: true }]) assert.throws(() => move(examples.bonus, state, action), /Illegal move/);
  assert.equal(JSON.stringify(state), before);
});
test('early finish preserves all collected rewards and rejects further movement', () => {
  let state = start(examples.bonus);
  for (const to of [6, 7]) state = move(examples.bonus, state, { to, rope: false });
  state.done = true;
  assert.equal(state.scoreHundredths, 20); assert.equal(270 + state.scoreHundredths, 290);
  assert.throws(() => move(examples.bonus, state, { to: 6, rope: false }), /Illegal move/);
});
test('a serialised restored position keeps gates, bridge, steps and collected treasure', () => {
  let state = start(examples.bonus);
  for (const [to, rope] of [[6, false], [11, false], [12, true]]) state = move(examples.bonus, state, { to, rope });
  const restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(moves(examples.bonus, restored), moves(examples.bonus, state));
  assert.deepEqual(move(examples.bonus, restored, { to: 13, rope: false }), move(examples.bonus, state, { to: 13, rope: false }));
});
test('a dead end includes a possible rope crossing when determining legal moves', () => {
  const ropeOnly = { ...examples.bonus, edges: [{ a: 5, b: 6, kind: 'gap' }], levers: {} };
  assert.deepEqual(moves(ropeOnly, start(ropeOnly)), [{ to: 6, rope: true }]);
  const state = move(ropeOnly, start(ropeOnly), { to: 6, rope: true });
  assert.equal(state.done, false); assert.deepEqual(moves(ropeOnly, state), [{ to: 5, rope: false }]);
  const isolated = { ...ropeOnly, edges: [] };
  assert.deepEqual(moves(isolated, start(isolated)), []);
  assert.equal(start(isolated).done, true);
});
test('exhausting every decision on this fixed bonus map confirms the optimal route value', () => {
  let states = 0;
  function best(state) {
    states++;
    return Math.max(state.scoreHundredths, ...moves(examples.bonus, state).map(action => best(move(examples.bonus, state, action))));
  }
  assert.equal(best(start(examples.bonus)), 350);
  assert.ok(states > 30);
});
