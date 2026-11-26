import type {CaptainPose, CrewId} from '../CaribbeanCrew';

type Flourish = 'toast' | 'beckon' | 'unfurl' | 'offer' | 'salute' | 'sweep' | 'open' | 'rally';
type Action = Flourish | 'brace' | 'look' | 'settle';
export type CrewEvent = 'watch' | 'giant' | 'cannon' | 'choice' | 'sail' | 'win' | 'big' | 'soft' | 'enter' | 'meet' | 'idle';

type Hand = readonly [number, number];
interface Style {
  hands: readonly [Hand, Hand];
  lead: 'left' | 'right';
  signature: Flourish;
  answer: Flourish;
  tempo: number;
}

// Wrist locations in the original portraits. The left and right refer to the screen.
export const CREW_STYLE: Record<CrewId, Style> = {
  isabella: {hands: [[.24,.49],[.77,.59]], lead:'left',  signature:'salute', answer:'rally',  tempo:1.00},
  amara:    {hands: [[.24,.51],[.74,.67]], lead:'left',  signature:'toast',  answer:'offer',  tempo:1.13},
  mei:      {hands: [[.23,.55],[.72,.73]], lead:'left',  signature:'unfurl', answer:'sweep',  tempo:1.06},
  priya:    {hands: [[.23,.52],[.74,.67]], lead:'right', signature:'beckon', answer:'toast',  tempo:.94},
  yasmin:   {hands: [[.28,.69],[.79,.52]], lead:'right', signature:'salute', answer:'offer',  tempo:1.11},
  zahara:   {hands: [[.28,.66],[.72,.66]], lead:'left',  signature:'rally',  answer:'sweep',  tempo:.89},
  catalina: {hands: [[.27,.78],[.77,.64]], lead:'left',  signature:'sweep',  answer:'beckon', tempo:.93},
  moana:    {hands: [[.20,.68],[.73,.65]], lead:'right', signature:'offer',  answer:'unfurl', tempo:1.12},
  freya:    {hands: [[.32,.64],[.79,.70]], lead:'right', signature:'open',   answer:'salute', tempo:1.03},
  rowan:    {hands: [[.21,.76],[.71,.65]], lead:'left',  signature:'open',   answer:'rally',  tempo:.88},
  ines:     {hands: [[.30,.53],[.74,.69]], lead:'left',  signature:'unfurl', answer:'beckon', tempo:1.18},
};

interface Cue {
  pose: CaptainPose;
  action: Action;
  seconds: number;
  next?: CaptainPose;
  strength?: number;
}

export function crewCue(style: Style, event: CrewEvent, variation: number): Cue {
  const flourish = variation % 2 ? style.answer : style.signature;
  switch (event) {
    case 'idle': return {pose:'focus', next:'idle', action:variation % 2 ? 'look' : style.signature, seconds:1.9, strength:.45};
    case 'watch': return {pose:'focus', action:'look', seconds:.7};
    case 'giant': return {pose:'focus', action:'brace', seconds:.8};
    case 'cannon': return {pose:'surprise', next:'focus', action:'brace', seconds:.9};
    case 'choice': return {pose:'bonus', action:flourish, seconds:1.5};
    case 'sail': return {pose:'focus', next:'bonus', action:'sweep', seconds:1.55};
    case 'win': return {pose:'win', action:flourish, seconds:1.55};
    case 'big': return {pose:'bonus', next:'laugh', action:flourish, seconds:2.35};
    case 'soft': return {pose:'soft', action:'settle', seconds:1.15};
    case 'enter': return {pose:'focus', next:'idle', action:flourish, seconds:1.3, strength:.75};
    case 'meet': return {pose:'bonus', next:'win', action:flourish, seconds:1.85};
  }
}

// A hand moves in portrait coordinates. A positive outward value moves it away from the torso.
export interface Articulation {
  leadOut: number; leadUp: number; offOut: number; offUp: number; head: number; shoulder: number;
}

export function articulate(action: Action, progress: number, strength: number): Articulation {
  const u = Math.max(0, Math.min(1, progress));
  const beat = (start: number, end: number) => {
    if (u <= start || u >= end) return 0;
    const wave = Math.sin(Math.PI * (u - start) / (end - start));
    return wave * wave * strength;
  };
  const lift = beat(0,.87), follow = beat(.18,1), flick = beat(.42,.72), finish = beat(.65,1);
  let leadOut = 0, leadUp = 0, offOut = 0, offUp = 0, head = 0, shoulder = 0;
  switch (action) {
    case 'toast': leadUp=.080*lift; leadOut=.024*follow; offUp=.018*follow; head=-.080*follow; break;
    case 'unfurl': leadUp=.063*lift; leadOut=-.047*lift; offOut=.058*follow; offUp=.039*follow; head=.090*lift; break;
    case 'beckon': leadOut=.051*lift-.035*flick; leadUp=.052*lift+.024*finish; head=-.065*follow; break;
    case 'offer': leadOut=.075*follow; leadUp=.045*lift; offUp=.025*lift; shoulder=.026*follow; break;
    case 'salute': leadOut=-.048*lift; leadUp=.09*lift; head=.085*follow; offOut=.018*finish; break;
    case 'sweep': leadOut=-.032*lift+.082*follow; leadUp=.055*lift; offUp=.028*finish; shoulder=.035*follow; break;
    case 'open': leadOut=.066*lift; offOut=.065*follow; leadUp=.055*lift; offUp=.052*follow; head=-.065*follow; break;
    case 'rally': leadUp=.086*lift+.037*finish; offUp=.046*follow; head=-.085*lift; shoulder=.03*lift; break;
    case 'brace': leadOut=-.039*lift; offOut=-.033*lift; leadUp=.07*lift; offUp=.045*follow; head=-.11*lift; shoulder=-.033*lift; break;
    case 'look': head=.11*lift; shoulder=.032*follow; leadUp=.023*follow; break;
    case 'settle': leadUp=-.022*follow; offUp=-.014*follow; head=.055*lift; shoulder=-.012*lift; break;
  }
  return {leadOut, leadUp, offOut, offUp, head, shoulder};
}
