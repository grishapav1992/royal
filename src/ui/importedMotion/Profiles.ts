import type { ImportedMotionGame } from './Outcome';

export type MotionProfile = { color: string; secondary: string; glyph: string; notes: readonly number[]; wave: OscillatorType; nativeAudio?: boolean };
export const MOTION_PROFILES: Record<ImportedMotionGame, MotionProfile> = {
  'royal-fruits': { color: '#b63b54', secondary: '#f6c77e', glyph: '✿', notes: [392, 493.88, 587.33, 783.99], wave: 'triangle', nativeAudio: true },
  'royal-dice': { color: '#78d7bf', secondary: '#e9c88e', glyph: '✧', notes: [293.66, 369.99, 440, 587.33], wave: 'sine', nativeAudio: true },
  'royal-limbo': { color: '#ab94f1', secondary: '#7ddcfa', glyph: '✦', notes: [220, 329.63, 440, 659.25], wave: 'sine', nativeAudio: true },
  'royal-mines': { color: '#f1c569', secondary: '#77c99e', glyph: '◆', notes: [261.63, 329.63, 392, 523.25], wave: 'triangle' },
  'royal-keno': { color: '#94b9f3', secondary: '#f0d698', glyph: '✦', notes: [349.23, 440, 523.25, 698.46], wave: 'sine' },
  'github-craps': { color: '#dfb16d', secondary: '#c6a4e9', glyph: '♪', notes: [233.08, 293.66, 349.23, 440], wave: 'triangle' },
  'github-diamonds': { color: '#91e5df', secondary: '#c3a8f4', glyph: '◆', notes: [523.25, 659.25, 783.99, 1046.5], wave: 'sine' },
  'github-sic-bo': { color: '#e7c36e', secondary: '#6ec7bf', glyph: '✧', notes: [220, 277.18, 329.63, 440], wave: 'triangle' },
};
