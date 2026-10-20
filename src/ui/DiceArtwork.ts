import { t as translateText } from '../i18n/index';
import type {DicePresentationGame} from '../shared/dicePresentation';
export const DICE_NAMES:Record<DicePresentationGame,string>={'royal-dice':'Royal Dice','variant-dice':translateText('Неоновый коридор'),'studio-signal-fox':translateText('Лисий сигнал')};
export function diceEmblem(game:DicePresentationGame){
 if(game==='royal-dice')return `<svg viewBox="0 0 120 90" aria-hidden="true"><path d="M25 68 19 29 40 42 60 17 80 42 101 29 95 68z" fill="#c5a165" stroke="#f8e3b4" stroke-width="2"/><path d="M28 74h64M37 61h46" stroke="#f8e3b4" stroke-width="3"/><circle cx="60" cy="51" r="9" fill="#263336"/><path d="M60 42v18M51 51h18" stroke="#edd4a0"/></svg>`;
 if(game==='variant-dice')return `<svg viewBox="0 0 120 90" aria-hidden="true"><path d="M12 18h96v54H12zM27 31h66v28H27z" fill="none" stroke="#71e5ed" stroke-width="2"/><path d="m12 18 15 13M108 18 93 31M12 72l15-13M108 72 93 59" stroke="#b387ec" stroke-width="2"/><path d="M35 45h50" stroke="#e9f8ff" stroke-width="3"/><circle cx="60" cy="45" r="6" fill="#ffbc76"/></svg>`;
 return `<svg viewBox="0 0 120 90" aria-hidden="true"><path d="m25 15 22 17h26l22-17-4 46-31 21-31-21z" fill="#bd6c43" stroke="#ffe1a6" stroke-width="2"/><path d="m31 31 12 17-11 8M89 31 77 48l11 8" fill="#ffe1a6"/><path d="m37 51 23 23 23-23-23 8z" fill="#fff0cd"/><path d="m54 59 6 8 6-8z" fill="#243c35"/><path d="M40 44h8M72 44h8" stroke="#253e36" stroke-width="3" stroke-linecap="round"/></svg>`;
}
