import type { CaribbeanCue } from '../../games/caribbean-treasures/CaribbeanAudio';
import type { CaptainPose } from '../../games/caribbean-treasures/CaribbeanCrew';
import { slotCharacterAnimationFacade, type AnimationStep, type AnimationTrigger } from './characterAnimationFacade';

export const CARIBBEAN_ANIMATION_GAME_ID = 'studio-caribbean-treasures';
export const CARIBBEAN_ANIMATION_POSES: Readonly<Record<number, CaptainPose>> = {
  0: 'idle', 1: 'win', 2: 'blink', 3: 'focus',
  4: 'surprise', 5: 'bonus', 6: 'soft', 7: 'laugh',
};

slotCharacterAnimationFacade.registerProfile({
  gameId: CARIBBEAN_ANIMATION_GAME_ID,
  characterName: 'Caribbean crew',
  metrics: { spriteWidth: 720, spriteHeight: 1080, anchorX: 0.5, anchorY: 1, scale: 1, containerOffsetX: 0, containerOffsetY: 0 },
  steps: {
    idle: [{ frame: 0, durationMs: 0 }],
    spin: [{ frame: 3, durationMs: 0 }],
    stop: [{ frame: 3, durationMs: 0 }],
    giant: [{ frame: 3, durationMs: 0 }],
    win: [{ frame: 1, durationMs: 1500 }],
    big_win: [{ frame: 7, durationMs: 1300 }, { frame: 1, durationMs: 650 }],
    bonus: [{ frame: 5, durationMs: 1300 }],
    cannon: [{ frame: 4, durationMs: 300 }, { frame: 3, durationMs: 420 }],
    lose: [{ frame: 6, durationMs: 1100 }],
    partial: [{ frame: 6, durationMs: 1100 }],
    return: [{ frame: 0, durationMs: 1100 }],
    jackpot: [{ frame: 7, durationMs: 1100 }],
  },
});

export function getCaribbeanAnimationTrigger(cue: CaribbeanCue): AnimationTrigger {
  if (cue === 'loss') return 'lose';
  if (cue === 'bigwin') return 'big_win';
  if (cue === 'line' || cue === 'click') return 'spin';
  return cue;
}

export function getCaribbeanAnimationSteps(trigger: AnimationTrigger, reduced: boolean): readonly AnimationStep[] {
  const steps = slotCharacterAnimationFacade.getSteps(CARIBBEAN_ANIMATION_GAME_ID, trigger);
  // Reduced motion keeps only the first pose and its original hold.
  if (reduced && steps.length && (trigger === 'big_win' || trigger === 'cannon')) {
    return [{ ...steps[0], durationMs: trigger === 'cannon' ? 800 : 1100 }];
  }
  return steps;
}
