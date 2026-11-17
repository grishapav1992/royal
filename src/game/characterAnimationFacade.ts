export type AnimationTrigger = 'idle' | 'spin' | 'win' | 'big_win' | 'bonus' | 'jackpot' | 'lose' | 'cannon' | 'giant' | 'partial' | 'return' | 'stop';

export type AnimationInterpolationMode = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bounce';

export type AnimationStep = {
  readonly frame: number;
  readonly durationMs: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly opacity?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly interpolation?: AnimationInterpolationMode;
  readonly action?: string;
  readonly soundCue?: string;
};

export type CharacterSlotMetrics = {
  readonly spriteWidth: number;
  readonly spriteHeight: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly scale: number;
  readonly containerOffsetX: number;
  readonly containerOffsetY: number;
};

export type CharacterAnimationProfile = {
  readonly gameId: string;
  readonly characterName: string;
  readonly metrics: CharacterSlotMetrics;
  readonly steps: Readonly<Record<AnimationTrigger, readonly AnimationStep[]>>;
};

export class SlotCharacterAnimationFacade {
  private profiles = new Map<string, CharacterAnimationProfile>();
  private defaultGameId: string = 'default';

  constructor() {
    this.registerDefaultProfiles();
  }

  public registerProfile(profile: CharacterAnimationProfile): void {
    this.profiles.set(profile.gameId, profile);
  }

  public setDefaultGameId(gameId: string): void {
    this.defaultGameId = gameId;
  }

  public getProfile(gameId?: string): CharacterAnimationProfile {
    const effectiveGameId = gameId && this.profiles.has(gameId) ? gameId : this.defaultGameId;
    return this.profiles.get(effectiveGameId) || this.profiles.get('default')!;
  }

  public getSteps(gameId: string | undefined, trigger: AnimationTrigger): readonly AnimationStep[] {
    const profile = this.getProfile(gameId);
    return profile.steps[trigger] || profile.steps['idle'] || [];
  }

  public evaluateStepInterpolation(
    fromStep: AnimationStep,
    toStep: AnimationStep,
    progress: number
  ): { scaleX: number; scaleY: number; opacity: number; offsetX: number; offsetY: number } {
    let p = Math.max(0, Math.min(1, progress));
    let t = p;
    const interp = toStep.interpolation || 'linear';

    if (interp === 'easeIn') {
      t = p * p;
    } else if (interp === 'easeOut') {
      t = p * (2 - p);
    } else if (interp === 'easeInOut') {
      t = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    } else if (interp === 'bounce') {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (p < 1 / d1) {
        t = n1 * p * p;
      } else if (p < 2 / d1) {
        t = n1 * (p -= 1.5 / d1) * p + 0.75;
      } else if (p < 2.5 / d1) {
        t = n1 * (p -= 2.25 / d1) * p + 0.9375;
      } else {
        t = n1 * (p -= 2.625 / d1) * p + 0.984375;
      }
    }

    const fx = fromStep.scaleX ?? 1;
    const tx = toStep.scaleX ?? 1;
    const fy = fromStep.scaleY ?? 1;
    const ty = toStep.scaleY ?? 1;
    const fo = fromStep.opacity ?? 1;
    const to = toStep.opacity ?? 1;
    const fox = fromStep.offsetX ?? 0;
    const tox = toStep.offsetX ?? 0;
    const foy = fromStep.offsetY ?? 0;
    const toy = toStep.offsetY ?? 0;

    return {
      scaleX: fx + (tx - fx) * t,
      scaleY: fy + (ty - fy) * t,
      opacity: fo + (to - fo) * t,
      offsetX: fox + (tox - fox) * t,
      offsetY: foy + (toy - foy) * t,
    };
  }

  private registerDefaultProfiles(): void {
    const standardMetrics: CharacterSlotMetrics = {
      spriteWidth: 128,
      spriteHeight: 128,
      anchorX: 0.5,
      anchorY: 1.0,
      scale: 1.0,
      containerOffsetX: 0,
      containerOffsetY: 0,
    };

    const defaultSteps: Record<AnimationTrigger, readonly AnimationStep[]> = {
      idle: [
        { frame: 0, durationMs: 250, scaleX: 1.0, scaleY: 1.0, opacity: 1.0, interpolation: 'easeInOut' },
        { frame: 1, durationMs: 250, scaleX: 1.01, scaleY: 0.99, opacity: 1.0, interpolation: 'easeInOut' },
      ],
      spin: [
        { frame: 2, durationMs: 120, scaleX: 0.95, scaleY: 1.05, soundCue: 'spin_start', interpolation: 'easeOut' },
        { frame: 3, durationMs: 120, scaleX: 1.02, scaleY: 0.98, interpolation: 'easeIn' },
      ],
      win: [
        { frame: 4, durationMs: 150, scaleX: 1.1, scaleY: 1.1, offsetY: -5, action: 'celebrate', soundCue: 'win_chime', interpolation: 'bounce' },
        { frame: 5, durationMs: 150, scaleX: 1.0, scaleY: 1.0, offsetY: 0, action: 'celebrate', interpolation: 'easeInOut' },
      ],
      big_win: [
        { frame: 4, durationMs: 100, scaleX: 1.15, scaleY: 1.15, offsetY: -10, action: 'hyper_celebrate', soundCue: 'big_win_fanfare', interpolation: 'bounce' },
        { frame: 5, durationMs: 100, scaleX: 0.95, scaleY: 1.05, offsetY: 0, action: 'hyper_celebrate', interpolation: 'easeInOut' },
        { frame: 4, durationMs: 100, scaleX: 1.1, scaleY: 1.1, offsetY: -5, action: 'hyper_celebrate', interpolation: 'easeInOut' },
      ],
      bonus: [
        { frame: 6, durationMs: 200, scaleX: 1.05, scaleY: 1.05, action: 'trigger_bonus', soundCue: 'bonus_alert', interpolation: 'bounce' }
      ],
      jackpot: [
        { frame: 7, durationMs: 300, scaleX: 1.2, scaleY: 1.2, offsetY: -15, action: 'jackpot_dance', soundCue: 'jackpot_anthem', interpolation: 'bounce' }
      ],
      lose: [
        { frame: 0, durationMs: 300, scaleX: 0.98, scaleY: 0.95, offsetY: 5, opacity: 0.9, action: 'sympathy', soundCue: 'lose_sigh', interpolation: 'easeInOut' }
      ],
      cannon: [
        { frame: 2, durationMs: 200, scaleX: 1.05, scaleY: 0.95, offsetY: -3, action: 'cannon_fire', soundCue: 'cannon', interpolation: 'easeOut' }
      ],
      giant: [
        { frame: 4, durationMs: 250, scaleX: 1.1, scaleY: 1.1, offsetY: -8, action: 'giant_symbol', soundCue: 'giant', interpolation: 'bounce' }
      ],
      partial: [
        { frame: 1, durationMs: 200, scaleX: 1.0, scaleY: 1.0, offsetY: 2, action: 'partial_win', soundCue: 'partial', interpolation: 'easeInOut' }
      ],
      return: [
        { frame: 0, durationMs: 200, scaleX: 1.0, scaleY: 1.0, offsetY: 0, action: 'return_stake', soundCue: 'return', interpolation: 'easeInOut' }
      ],
      stop: [
        { frame: 0, durationMs: 150, scaleX: 1.0, scaleY: 1.0, offsetY: 0, action: 'stop_action', soundCue: 'stop', interpolation: 'easeInOut' }
      ]
    };

    this.registerProfile({
      gameId: 'default',
      characterName: 'Standard Host',
      metrics: standardMetrics,
      steps: defaultSteps
    });

    this.registerProfile({
      gameId: 'pirates',
      characterName: 'Captain Redbeard',
      metrics: { ...standardMetrics, scale: 1.05 },
      steps: {
        ...defaultSteps,
        win: [
          { frame: 10, durationMs: 150, scaleX: 1.12, scaleY: 1.08, offsetY: -6, action: 'pirate_cheer', soundCue: 'arrr_win', interpolation: 'bounce' },
          { frame: 11, durationMs: 150, scaleX: 1.0, scaleY: 1.0, offsetY: 0, action: 'pirate_cheer', interpolation: 'easeInOut' }
        ],
        jackpot: [
          { frame: 12, durationMs: 400, scaleX: 1.25, scaleY: 1.25, offsetY: -20, action: 'pirate_treasure', soundCue: 'cannon_fire', interpolation: 'bounce' }
        ]
      }
    });

    this.registerProfile({
      gameId: 'jackichan',
      characterName: 'Master Dragon',
      metrics: { ...standardMetrics, scale: 1.0 },
      steps: {
        ...defaultSteps,
        win: [
          { frame: 20, durationMs: 120, scaleX: 1.15, scaleY: 0.95, offsetY: -8, action: 'kung_fu_pose', soundCue: 'hiya', interpolation: 'bounce' },
          { frame: 21, durationMs: 120, scaleX: 1.0, scaleY: 1.0, offsetY: 0, action: 'kung_fu_pose', interpolation: 'easeInOut' }
        ],
        big_win: [
          { frame: 22, durationMs: 100, scaleX: 1.2, scaleY: 1.1, offsetY: -12, action: 'martial_arts_fury', soundCue: 'dragon_roar', interpolation: 'bounce' }
        ]
      }
    });
  }
}

export const slotCharacterAnimationFacade = new SlotCharacterAnimationFacade();
