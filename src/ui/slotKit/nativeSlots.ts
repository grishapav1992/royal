import { t as translateText } from '../../i18n/index';
import type {SlotDefinition} from './SlotDefinition';

export const cosmicSlot = {
  gameId: 'studio-cosmic-escape', title: 'Cosmic Escape', protocol: 'luelon',
  assets: {
  symbols: '/assets/cosmic-guardians/v1/symbols-v2.webp',
  alien: '/assets/cosmic-guardians/v1/alien.webp',
  background: '/assets/cosmic-guardians/v1/background.webp',
},
  audio: {musicStorageKey: 'royal-cosmic-music', musicChords: [[220,261.63,329.63,440],[174.61,220,261.63,349.23],[196,246.94,293.66,392],[164.81,207.65,246.94,329.63]],
    melody: [0,2,3,2,1,2,3,1], spinNotes: [440,523.25,659.26,880,659.26,523.25,493.88,587.33], musicIntervalMs: 370, spinIntervalMs: 85, featureCues:{expand:'expand',energy:'silent',echo:'echo',scatter:'tickets'}},
} as const satisfies SlotDefinition;

export const caramelSlot = {
  gameId: 'studio-caramel-carnival', title: 'Caramel Carnival', protocol: 'caramel',
  assets: {
  symbols: '/assets/caramel-rebuild/v1/symbols.webp',
  background: '/assets/caramel-rebuild/v1/background.webp',
},
  audio: {musicStorageKey: 'royal-caramel-music', musicChords: [[196,246.94,293.66,392],[174.61,220,261.63,349.23],[220,261.63,329.63,440],[130.81,164.81,196,261.63]],
    melody: [0,2,3,2,1,2,3,1], spinNotes: [523.25,659.26,783.99,1046.5,783.99,659.26,587.33,880], musicIntervalMs: 320, spinIntervalMs: 95, featureCues:{expand:'expand',energy:'silent',echo:'echo',scatter:'tickets'}},
} as const satisfies SlotDefinition;

export const velvetSlot = {
  gameId: 'studio-velvet-reign', title: 'Velvet Reign', protocol: 'luelon',
  assets: {
  symbols: '/assets/velvet-rebuild/v1/symbols.webp',
  background: '/assets/velvet-rebuild/v1/background.webp',
},
  audio: {musicStorageKey: 'royal-velvet-music', musicChords: [[196,246.94,293.66,369.99],[220,261.63,329.63,392],[174.61,220,261.63,349.23],[146.83,196,233.08,293.66]],
    melody: [0,2,1,3,2,1,0,2], spinNotes: [392,493.88,587.33,783.99,659.26,587.33,493.88,440], musicIntervalMs: 440, spinIntervalMs: 95, featureCues:{sticky:'expand',expand:'expand',energy:'silent',echo:'echo',scatter:'tickets',retrigger:'tickets',collect:'drop'}},
} as const satisfies SlotDefinition;

export const convoySlot = {
 gameId:'studio-last-convoy',title:/* @__PURE__ */translateText('Последний конвой'),protocol:'convoy',
 assets:{symbols:'/assets/last-convoy/v1/symbols.webp',background:'/assets/last-convoy/v1/background.webp',heroine:'/assets/last-convoy/v1/heroine.webp'},
 audio:{musicStorageKey:'royal-convoy-music',musicChords:[[146.83,174.61,220,293.66],[130.81,164.81,196,261.63],[116.54,146.83,174.61,233.08],[110,130.81,164.81,220]],melody:[0,2,1,3,2,0,3,1],spinNotes:[146.83,220,293.66,349.23,293.66,220,174.61,261.63],musicIntervalMs:540,spinIntervalMs:110,featureCues:{barricade:'expand',scatter:'tickets',drop:'drop'}},
} as const satisfies SlotDefinition;

export const nitroSlot = {
 gameId:'studio-nitro-run',title:/* @__PURE__ */translateText('Нитро-заезд'),protocol:'nitro',
 assets:{symbols:'/assets/nitro-run/v1/symbols.webp',background:'/assets/nitro-run/v1/background.webp'},
 audio:{musicStorageKey:'royal-nitro-music',musicChords:[[110,130.81,164.81,220],[98,123.47,146.83,196],[130.81,164.81,196,261.63],[87.31,110,130.81,174.61]],melody:[0,0,2,1,3,2,1,2],spinNotes:[82.41,110,130.81,164.81,196,220,246.94,293.66],musicIntervalMs:280,spinIntervalMs:105,featureCues:{nitro:'expand',gear:'drop',scatter:'tickets'}},
} as const satisfies SlotDefinition;

export const afterglowSlot={
 gameId:'studio-afterglow',title:'GIRLHUB',protocol:'afterglow',
 assets:{symbols:'/assets/afterglow/v1/symbols.webp',background:'/assets/afterglow/v1/background-studio-v3.webp',base0:'/assets/afterglow/v3/base-0.webp',look0:'/assets/afterglow/v4/look-0-legendary.webp',base1:'/assets/afterglow/v3/base-1.webp',look1:'/assets/afterglow/v3/look-1-user.webp',base2:'/assets/afterglow/v3/base-2.webp',look2:'/assets/afterglow/v3/look-2-user.webp',base3:'/assets/afterglow/v3/base-3.webp',look3:'/assets/afterglow/v3/look-3-user.webp'},
 audio:{musicStorageKey:'royal-afterglow-music',musicChords:[[164.81,196,246.94,329.63],[146.83,174.61,220,293.66],[130.81,164.81,196,261.63],[146.83,196,246.94,293.66]],melody:[0,2,1,3,2,3,1,2],spinNotes:[329.63,392,493.88,659.26,493.88,392,440,523.25],musicIntervalMs:430,spinIntervalMs:100,featureCues:{pin:'expand',flash:'echo',scatter:'tickets'}},
} as const satisfies SlotDefinition;

export const memeSlot={
 gameId:'studio-meme-overload',title:'MEME OVERLOAD',protocol:'nitro',
 assets:{doge:'/assets/meme-overload/v1/doge.jpg',harold:'/assets/meme-overload/v1/harold.jpg',grumpy:'/assets/meme-overload/v1/grumpy.jpg',smudge:'/assets/meme-overload/v1/smudge.jpg',stonks:'/assets/meme-overload/v1/stonks.png',pepe:'/assets/meme-overload/v1/pepe.jpg',background:'/assets/meme-overload/v1/desktop.svg'},
 audio:{musicStorageKey:'royal-meme-music',musicChords:[[261.63,329.63,392,523.25],[220,261.63,329.63,440],[174.61,220,261.63,349.23],[196,246.94,293.66,392]],melody:[0,2,1,2,0,1,3,2],spinNotes:[523.25,659.26,783.99,1046.5,783.99,659.26],musicIntervalMs:400,spinIntervalMs:95,featureCues:{reconnect:'echo',overclock:'expand',scatter:'tickets'}},
} as const satisfies SlotDefinition;
