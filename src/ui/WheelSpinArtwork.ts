import { t as translateText } from '../i18n/index';
import type {WheelSpinPresentationGameId,WheelSpinTarget} from '../shared/wheelSpinPresentation';

export const WHEEL_SPIN_NAMES:Record<WheelSpinPresentationGameId,string>={
  'studio-saffron-spin':translateText('Золотое вращение'),
  'studio-lucky-spotlight':translateText('Колесо прожекторов'),
};
export const WHEEL_TARGET_NAMES=[translateText('Золото'),translateText('Изумруд'),translateText('Рубин'),translateText('Звезда')] as const;
export const WHEEL_TARGET_COLORS=['#f5c45a','#69bb96','#df7d78','#b39bdd'] as const;
export const wheelGlyph=(value:WheelSpinTarget)=>[
  '<circle cx="0" cy="0" r="13"/><circle cx="0" cy="0" r="6" fill="none" stroke="currentColor" stroke-width="2"/>',
  '<path d="M0-16 13 0 0 16-13 0Z"/><path d="M0-11v22M-9 0H9" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  '<path d="M-14-8H14L0 16Z"/><path d="M-10-5 0 12 10-5Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  '<path d="m0-17 4 11 12-1-9 8 4 12-11-7-11 7 4-12-9-8 12 1Z"/>',
][value];
export const wheelCategoryIcon=(value:WheelSpinTarget)=>`<svg viewBox="-20 -20 40 40" aria-hidden="true"><g fill="currentColor">${wheelGlyph(value)}</g></svg>`;
export const wheelEmblem=(game:WheelSpinPresentationGameId)=>game==='studio-saffron-spin'
  ?'<svg viewBox="0 0 120 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M15 27c0-17 21-21 35-24M24 28C24 13 46 8 54 5M105 27c0-17-21-21-35-24M96 28C96 13 74 8 66 5"/><path d="M27 14 14 11m20-2-9-6m-1 17-11 1M93 14l13-3M86 9l9-6m1 17 11 1"/><circle cx="60" cy="17" r="11"/><path d="m60 9 3 5 6 3-6 3-3 5-3-5-6-3 6-3Z"/></g></svg>'
  :'<svg viewBox="0 0 120 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 27V9h24l13 18M108 27V9H84L71 27M20 9l9 18M100 9l-9 18M43 27h34"/><circle cx="60" cy="16" r="9"/><path d="M60 3v3m0 20v3M47 16h-3m29 0h3"/></g><circle cx="60" cy="16" r="3" fill="currentColor"/></svg>';
