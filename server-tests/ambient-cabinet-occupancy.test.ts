import test from 'node:test';
import assert from 'node:assert/strict';
import { AmbientGuests } from '../src/shared/ambientGuests';
import { AmbientGuests as ServerGuests } from '../server/ambientGuests';
import { CABINETS } from '../src/shared/cabinets';
import { LobbyState, Player } from '../server/state';
import { hallObstacles } from '../src/shared/world';
import { walkable } from '../src/game/navigation';

const cabinetIds = new Set(CABINETS.map(cabinet => cabinet.id));

test('a real cabinet claim redirects both stationary and approaching NPCs to free destinations', () => {
  const routine = new AmbientGuests(), initial = routine.snapshot();
  const stationary = initial.find(guest => guest.hall === 'arcade' && cabinetIds.has(guest.destination))!;
  assert(stationary);
  const occupied = new Set([stationary.destination]);
  routine.setOccupiedCabinets(occupied); routine.tick(.1);
  const leaving = routine.snapshot().find(guest => guest.id === stationary.id)!;
  assert.notEqual(leaving.destination, stationary.destination);
  assert.equal(leaving.mood, 'walking'); assert.equal(leaving.moving, true);
  assert(Math.hypot(leaving.x - stationary.x, leaving.y - stationary.y) > 0, 'the NPC starts walking away instead of teleporting');
  let approaching: ReturnType<AmbientGuests['snapshot']>[number] | undefined;
  for (let tick = 0; tick < 500 && !approaching; tick++) {
    routine.tick(.1);
    approaching = routine.snapshot().find(guest => guest.moving && cabinetIds.has(guest.destination));
  }
  assert(approaching, 'the routine produces an approach to another cabinet');
  occupied.add(approaching.destination); routine.setOccupiedCabinets(occupied); routine.tick(.1);
  const redirected = routine.snapshot().find(guest => guest.id === approaching.id)!;
  assert(!occupied.has(redirected.destination), 'an in-flight approach abandons its occupied destination on the next tick');
  for (let tick = 0; tick < 1000; tick++) {
    routine.tick(.1);
    for (const guest of routine.snapshot()) {
      assert(!occupied.has(guest.destination), guest.id + ' never selects an occupied cabinet');
      assert(walkable(guest.x, guest.y, hallObstacles(guest.hall)), guest.id + ' keeps its navigation route outside furniture');
    }
  }
});

test('reserving all cabinets preserves bar, lounge and table observer destinations', () => {
  const routine = new AmbientGuests(), initial = routine.snapshot();
  const watchers = initial.filter(guest => guest.destination === 'pool-watch' || guest.destination === 'hockey-watch');
  assert.equal(watchers.length, 2);
  routine.setOccupiedCabinets([...cabinetIds, 'pool-watch', 'hockey-watch']); routine.tick(.1);
  for (const watcher of watchers) {
    const next = routine.snapshot().find(guest => guest.id === watcher.id)!;
    assert.equal(next.destination, watcher.destination, 'observer stops are not cabinets');
    assert.equal(next.mood, 'playing'); assert.equal(next.moving, false);
  }
  for (let tick = 0; tick < 600; tick++) {
    routine.tick(.1);
    for (const guest of routine.snapshot()) {
      assert(!cabinetIds.has(guest.destination), guest.id + ' leaves every real cabinet available');
      assert(walkable(guest.x, guest.y, hallObstacles(guest.hall)), guest.id + ' still follows valid navigation');
    }
  }
  routine.setOccupiedCabinets([]);
  let returned = false;
  for (let tick = 0; tick < 1800 && !returned; tick++) {
    routine.tick(.1); returned = routine.snapshot().some(guest => cabinetIds.has(guest.destination));
  }
  assert(returned, 'released cabinets become ordinary NPC destinations again');
});

test('server guests avoid a player cabinet claim even during reconnection grace', () => {
  const state = new LobbyState(), routine = new ServerGuests(state);
  const guest = [...state.guests.values()].find(view => view.hall === 'arcade' && cabinetIds.has(view.destination))!;
  const cabinet = guest.destination, player = new Player(); player.cabinet = cabinet; player.playing = true; player.connected = false;
  state.players.set('reconnecting-player', player); routine.tick(.1);
  assert([...state.guests.values()].every(view => view.destination !== cabinet));
  for (let tick = 0; tick < 600; tick++) {
    routine.tick(.1);
    assert([...state.guests.values()].every(view => view.destination !== cabinet));
  }
  assert.equal(state.players.size, 1, 'ambient routines never create game accounts or player claims');
  assert.equal(player.cabinet, cabinet, 'the routine never modifies real player ownership');
});
