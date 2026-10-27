/** Shared walking cadence for the live character and the atelier fitting room. */
export const CHARACTER_WALK_FRAMES = 6;
export const CHARACTER_WALK_FRAME_RATE = 12;

export type CharacterMotionMode = 'walk' | 'rest' | 'action';
export type CharacterMotion = {
  mode: CharacterMotionMode;
  distance: number;
  restingAt: number | null;
  lastTravelAt: number | null;
};

export function createCharacterMotion(): CharacterMotion {
  return { mode: 'action', distance: 0, restingAt: null, lastTravelAt: null };
}

/** Advance only for visible travel. A stopped or interrupted actor cannot queue steps. */
export function advanceCharacterMotion(state: CharacterMotion, input: {
  mode: CharacterMotionMode; distance: number; time: number; normalSpeed: number;
}): { frame: number; landing: -1 | 0 | 1 } {
  const { mode, time, normalSpeed } = input;
  if (!Number.isFinite(normalSpeed) || normalSpeed <= 0) throw new RangeError('Invalid walking reference speed');
  if (mode !== 'walk') {
    if (mode === 'rest' && (state.mode !== 'rest' || state.restingAt === null)) state.restingAt = time;
    if (mode !== 'rest') state.restingAt = null;
    state.mode = mode; state.distance = 0; state.lastTravelAt = null;
    return { frame: 6, landing: 0 };
  }
  if (state.mode !== 'walk') { state.distance = 0; state.lastTravelAt = time; }
  state.mode = 'walk'; state.restingAt = null;
  const travel = Number.isFinite(input.distance) && input.distance > .01 && input.distance < 24 ? input.distance : 0;
  const stalled = state.lastTravelAt === null || time - state.lastTravelAt >= 150;
  if (stalled) state.distance = 0;
  if (!travel && (stalled || state.distance === 0)) return { frame: 6, landing: 0 };
  if (travel) state.lastTravelAt = time;
  const stride = normalSpeed * CHARACTER_WALK_FRAMES / CHARACTER_WALK_FRAME_RATE;
  const before = Math.floor(state.distance / (stride / 2)), next = state.distance + travel;
  const contact = Math.floor(next / (stride / 2));
  state.distance = next % stride;
  return {
    frame: Math.min(CHARACTER_WALK_FRAMES - 1, Math.floor(state.distance / stride * CHARACTER_WALK_FRAMES)),
    landing: contact > before ? contact % 2 ? 1 : -1 : 0,
  };
}

/** A small whole-figure breath fades in from the planted resting pose. */
export function characterRestScale(state: CharacterMotion, time: number, seed: number, reducedMotion: boolean) {
  if (reducedMotion || state.mode !== 'rest' || state.restingAt === null) return { x: 1, y: 1 };
  const progress = Math.max(0, Math.min(1, (time - state.restingAt) / 500));
  const envelope = progress * progress * (3 - 2 * progress);
  const breath = Math.sin((time + seed * 137) / 4200 * Math.PI * 2) * envelope;
  return { x: 1 - breath * .003, y: 1 + breath * .008 };
}
