import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CaribbeanCue } from '../../games/caribbean-treasures/CaribbeanAudio';
import { CAPTAIN_POSES } from '../../games/caribbean-treasures/CaribbeanCrew';
import { CARIBBEAN_ANIMATION_GAME_ID, CARIBBEAN_ANIMATION_POSES, getCaribbeanAnimationSteps, getCaribbeanAnimationTrigger } from './caribbeanAnimationAdapter.js';
import { slotCharacterAnimationFacade, type AnimationTrigger } from './characterAnimationFacade.js';

const expectedTriggers = {
  loss: 'lose', bigwin: 'big_win', line: 'spin', click: 'spin',
  stop: 'stop', giant: 'giant', cannon: 'cannon', bonus: 'bonus',
  partial: 'partial', return: 'return', win: 'win',
} as const satisfies Record<CaribbeanCue, AnimationTrigger>;

const expectedReactions = {
  win: [['win', 1500]], big_win: [['laugh', 1300], ['win', 650]],
  bonus: [['bonus', 1300]], cannon: [['surprise', 300], ['focus', 420]],
  lose: [['soft', 1100]], partial: [['soft', 1100]], return: [['idle', 1100]],
  spin: [['focus', 0]], stop: [['focus', 0]], giant: [['focus', 0]],
} as const;

const poses = (trigger: AnimationTrigger, reduced = false) =>
  getCaribbeanAnimationSteps(trigger, reduced).map(step => [CARIBBEAN_ANIMATION_POSES[step.frame], step.durationMs]);

describe('caribbeanAnimationAdapter', () => {
  it('maps every confirmed cue without reading or classifying a round', () => {
    for (const cue of Object.keys(expectedTriggers) as CaribbeanCue[]) {
      assert.equal(getCaribbeanAnimationTrigger(cue), expectedTriggers[cue]);
    }
  });

  it('registers a game profile using exactly the eight existing captain poses', () => {
    const profile = slotCharacterAnimationFacade.getProfile(CARIBBEAN_ANIMATION_GAME_ID);
    assert.equal(profile.gameId, CARIBBEAN_ANIMATION_GAME_ID);
    assert.notEqual(profile, slotCharacterAnimationFacade.getProfile('pirates'));
    assert.deepEqual(Object.values(CARIBBEAN_ANIMATION_POSES).sort(), Object.keys(CAPTAIN_POSES).sort());
    for (const steps of Object.values(profile.steps)) {
      for (const step of steps) {
        assert(Number.isInteger(step.frame));
        assert(CARIBBEAN_ANIMATION_POSES[step.frame] in CAPTAIN_POSES);
        assert(step.durationMs >= 0);
        assert.equal(step.soundCue, undefined);
        assert.equal(step.action, undefined);
      }
    }
  });

  it('preserves the existing poses, hold times and non-holding cues', () => {
    for (const trigger of Object.keys(expectedReactions) as (keyof typeof expectedReactions)[]) {
      assert.deepEqual(poses(trigger), expectedReactions[trigger]);
      if (trigger !== 'big_win' && trigger !== 'cannon') assert.deepEqual(poses(trigger, true), expectedReactions[trigger]);
    }
  });

  it('keeps the cannon surprise pose for 800 ms in reduced motion', () => {
    const original = slotCharacterAnimationFacade.getSteps(CARIBBEAN_ANIMATION_GAME_ID, 'cannon');
    assert.deepEqual(poses('cannon', true), [['surprise', 800]]);
    assert.equal(slotCharacterAnimationFacade.getSteps(CARIBBEAN_ANIMATION_GAME_ID, 'cannon'), original);
    assert.deepEqual(poses('cannon'), expectedReactions.cannon);
  });

  it('keeps only the first big-win pose for 1100 ms in reduced motion', () => {
    const original = slotCharacterAnimationFacade.getSteps(CARIBBEAN_ANIMATION_GAME_ID, 'big_win');
    assert.deepEqual(poses('big_win', true), [['laugh', 1100]]);
    assert.equal(slotCharacterAnimationFacade.getSteps(CARIBBEAN_ANIMATION_GAME_ID, 'big_win'), original);
    assert.deepEqual(poses('big_win'), expectedReactions.big_win);
  });
});
