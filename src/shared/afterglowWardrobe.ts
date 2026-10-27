import { t as translateText } from '../i18n/index';
// Stable character IDs: Alice, Mia, Eva, Naomi. Amounts use wallet hundredths.
export const AFTER_LOOK_TARGETS = [200, 50, 150, 100] as const; // Legacy migration only.
export const AFTER_LOOK_TARGET_UNITS = [400000, 100000, 300000, 200000] as const;
export const AFTER_ALBUM_TARGET_UNITS = [90000, 0, 44000, 16000] as const;
export const AFTER_ALBUM_MAX_UNITS = 90000;
export const AFTER_STARTER_GIRL = 1;
export const AFTER_PROGRESS_HEADER = 'X-Royal-Afterglow-Progress';
export const AFTER_PROGRESS_VERSION = '4';
export const AFTER_GALLERY_ORDER = [1, 3, 2, 0] as const;
export const AFTER_LOOK_RARITIES = [translateText('Легендарный'), translateText('Обычный'), translateText('Эпический'), translateText('Редкий')] as const;
export const afterAlbumUnlocked = (units: number) => AFTER_ALBUM_TARGET_UNITS.map(target => units >= target);
export type AfterWardrobe = {
  version: 4; revision: number; selectedGirl: number; selectedLook: 0 | 1;
  albumUnits: number; pointsUnits: number[]; unlocked: boolean[]; active: boolean; activeGirl: number | null;
};
export type AfterLookChoice = {girl: number; look: 0 | 1; revision: number};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
export function validAfterLookChoice(v: unknown): v is AfterLookChoice {
  return object(v) && Object.keys(v).sort().join() === 'girl,look,revision'
    && integer(v.girl, 3) && integer(v.look, 1) && integer(v.revision, Number.MAX_SAFE_INTEGER);
}
export function validAfterWardrobe(v: unknown): v is AfterWardrobe {
  if (!object(v) || Object.keys(v).sort().join() !== 'active,activeGirl,albumUnits,pointsUnits,revision,selectedGirl,selectedLook,unlocked,version') return false;
  if (!Array.isArray(v.pointsUnits) || v.pointsUnits.length !== 4 || !Array.isArray(v.unlocked) || v.unlocked.length !== 4) return false;
  const points = Array.from(v.pointsUnits), unlocked = Array.from(v.unlocked);
  return v.version === 4 && integer(v.revision, Number.MAX_SAFE_INTEGER) && integer(v.selectedGirl, 3)
    && integer(v.selectedLook, 1) && integer(v.albumUnits, AFTER_ALBUM_MAX_UNITS) && typeof v.active === 'boolean'
    && (v.activeGirl === null || integer(v.activeGirl, 3)) && (v.active || v.activeGirl === null)
    && points.every((n, i) => integer(n, AFTER_LOOK_TARGET_UNITS[i]) && unlocked[i] === (n === AFTER_LOOK_TARGET_UNITS[i]))
    // An accepted bonus keeps its original heroine until final settlement.
    && (afterAlbumUnlocked(v.albumUnits)[v.selectedGirl] || v.active && v.activeGirl === v.selectedGirl)
    && (v.selectedLook === 0 || unlocked[v.selectedGirl] === true);
}
