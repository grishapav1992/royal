import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SlotCharacterAnimationFacade, type AnimationStep } from './characterAnimationFacade.js';

describe('SlotCharacterAnimationFacade with Easing and Metrics', () => {
  it('returns standard metrics and profile data', () => {
    const facade = new SlotCharacterAnimationFacade();
    const profile = facade.getProfile('pirates');
    assert.equal(profile.characterName, 'Captain Redbeard');
    assert.equal(profile.metrics.spriteWidth, 128);
    assert.equal(profile.metrics.anchorY, 1);
  });

  it('returns a registered profile and its sequences, including replacements', () => {
    const facade = new SlotCharacterAnimationFacade();
    const profile = { ...facade.getProfile(), gameId: 'test-game', steps: {
      ...facade.getProfile().steps, win: [{ frame: 42, durationMs: 1750 }],
    } };
    facade.registerProfile(profile);
    assert.equal(facade.getProfile('test-game'), profile);
    assert.equal(facade.getSteps('test-game', 'win'), profile.steps.win);
    const replacement = { ...profile, steps: { ...profile.steps, win: [{ frame: 7, durationMs: 250 }] } };
    facade.registerProfile(replacement);
    assert.equal(facade.getSteps('test-game', 'win'), replacement.steps.win);
  });

  it('falls back to the configured default game and to idle for missing triggers', () => {
    const facade = new SlotCharacterAnimationFacade();
    const standard = facade.getProfile('default');
    assert.equal(facade.getProfile('unknown'), standard);
    assert.equal(facade.getSteps(undefined, 'win'), standard.steps.win);
    assert.equal(facade.getSteps('unknown', 'win'), standard.steps.win);
    assert.equal(facade.getSteps('default', 'missing' as Parameters<typeof facade.getSteps>[1]), standard.steps.idle);
    facade.setDefaultGameId('pirates');
    assert.equal(facade.getProfile(), facade.getProfile('pirates'));
    assert.equal(facade.getSteps('unknown', 'win'), facade.getProfile('pirates').steps.win);
    facade.setDefaultGameId('missing');
    assert.equal(facade.getProfile(), standard);
  });

  it('interpolates step values correctly with linear easing', () => {
    const facade = new SlotCharacterAnimationFacade();
    const from = { frame: 0, durationMs: 100, scaleX: 1, scaleY: 1, opacity: 1, offsetX: 0, offsetY: 0 };
    const to: AnimationStep = { frame: 1, durationMs: 100, scaleX: 2, scaleY: 2, opacity: 0, offsetX: 100, offsetY: 50, interpolation: 'linear' };
    assert.deepEqual(facade.evaluateStepInterpolation(from, to, 0.5), {
      scaleX: 1.5, scaleY: 1.5, opacity: 0.5, offsetX: 50, offsetY: 25,
    });
  });

  it('evaluates every bounce segment and clamps progress', () => {
    const facade = new SlotCharacterAnimationFacade();
    const from: AnimationStep = { frame: 0, durationMs: 100, offsetX: 0 };
    const to: AnimationStep = { frame: 1, durationMs: 100, offsetX: 1, interpolation: 'bounce' };
    const cases = [[-1, 0], [0.2, 0.3025], [0.5, 0.765625], [0.8, 0.94], [0.95, 0.98453125], [2, 1]];
    for (const [progress, expected] of cases) {
      assert(Math.abs(facade.evaluateStepInterpolation(from, to, progress).offsetX - expected) < 1e-12);
    }
  });
});
