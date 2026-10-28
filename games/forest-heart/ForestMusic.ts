/** Original composition. Eighth notes at 76 BPM, sixteen bars, three orchestration passes. */
export const FOREST_MUSIC_STEP = 60 / 76 / 2;
export type ForestNote = { instrument: 'harp' | 'flute' | 'pad' | 'drum'; midi: number; delay: number; duration: number; level: number; pan: number };
const chords = [
  [50,57,65,72], [58,65,69,76], [53,60,69,76], [48,55,65,70],
  [55,62,65,72], [50,57,65,69], [58,65,69,74], [45,52,62,69],
  [50,57,65,76], [53,60,67,74], [58,65,69,77], [48,55,64,74],
  [55,62,69,74], [58,65,72,77], [45,52,62,71], [50,57,65,74],
];
// Phrases breathe: rests are part of the score, rather than an unbroken arpeggio.
const melody: (number|null)[][] = [
  [null,null,null,null,null,null,null,null], [77,null,76,null,74,null,null,null],
  [null,null,72,null,null,74,76,null], [74,null,null,null,69,null,null,null],
  [null,null,null,null,null,null,null,null], [69,null,72,74,null,null,77,null],
  [76,null,null,74,null,72,null,null], [73,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null], [81,null,null,79,null,77,76,null],
  [77,null,74,null,null,null,72,null], [null,null,76,null,74,null,null,null],
  [74,null,null,null,77,null,81,null], [79,null,77,null,null,74,null,null],
  [76,null,null,73,null,null,null,null], [74,null,null,null,null,null,null,null],
];
const picking: (number|null)[][] = [
  [0,null,2,null,1,null,3,null], [0,null,null,1,null,2,null,3],
  [0,2,null,null,1,null,2,null], [0,null,1,null,null,3,null,null],
];

export function forestMusicNotes(index: number, bonus: boolean): ForestNote[] {
  const bar = Math.floor(index / 8) % 16, step = index % 8, pass = Math.floor(index / 128) % 3;
  const chord = chords[bar], result: ForestNote[] = [];
  const add = (instrument: ForestNote['instrument'], midi: number, duration: number, level: number, pan: number, delay = 0) => result.push({instrument,midi,duration,level,pan,delay});
  if (step === 0) {
    // Long voiced harmony, with space between chord changes.
    [0,1,2].forEach((n,i) => add('pad',chord[n],FOREST_MUSIC_STEP * 7.8,.024,[-.45,.42,0][i],i * .018));
  }
  const pick = picking[(Math.floor(bar / 4) + pass) % picking.length][step];
  if (pick !== null && !(pass === 2 && bar % 4 === 3 && step > 3)) {
    add('harp',chord[pick] + (pick < 2 ? 12 : 0),1.65,bonus ? .105 : .085,step % 4 < 2 ? -.36 : .32);
  }
  const tune = melody[bar][step];
  if (tune !== null && (pass !== 1 || bar >= 8 || bar % 2 === 1)) {
    add(pass === 2 && bar < 8 ? 'harp' : 'flute',tune,FOREST_MUSIC_STEP * (step === 0 ? 2.7 : 1.6),.075,pass % 2 ? -.12 : .18);
  }
  if (bonus) {
    // The grove changes rhythm and instrumentation, not just volume.
    if ([0,3,6].includes(step)) add('drum',step === 0 ? 42 : 49,.24,step === 0 ? .08 : .042,step === 3 ? -.2 : .15);
    if (step === 5 && bar % 2 === 0) add('harp',chord[3] + 12,.9,.055,.5);
  }
  return result;
}
