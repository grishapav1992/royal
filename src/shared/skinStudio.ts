import { normalizeAppearance, type Appearance } from './appearance';
import type { SkinGenerationGrant } from './progression';

/** Historical orders and the legacy payment bridge retain their ten-dollar contract. */
export const SKIN_PRICE_UNITS = '10000000';
export const SKIN_VARIANTS = 2;
export const SKIN_OFFERS = {
  atelier:{priceUnits:'1000000',variantCount:2},
  janitor:{priceUnits:'5000000',variantCount:1},
} as const;
export type SkinOfferId=keyof typeof SKIN_OFFERS;
export type SkinPaymentTerms={priceUnits:string;offerId:SkinOfferId};
export function skinOfferId(value:unknown):SkinOfferId|null{return value===undefined?'atelier':value==='atelier'||value==='janitor'?value:null;}
export const SKIN_THEME = { id: 'south-park', name: 'Южный парк', version: 1 } as const;
export const SKIN_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type GeneratedAppearance = { version: 2; skinId: string; theme: string };
export type CharacterAppearance = Appearance | GeneratedAppearance;
export function generatedAppearance(value: unknown): GeneratedAppearance | null {
  const row = value as GeneratedAppearance;
  return row?.version === 2 && Object.keys(row).sort().join(',') === 'skinId,theme,version'
    && typeof row.skinId === 'string' && SKIN_UUID.test(row.skinId) && row.theme === SKIN_THEME.id ? row : null;
}
export function parseGeneratedAppearance(value: string): GeneratedAppearance | null {
  if (!value || value.length > 256) return null;
  try { return generatedAppearance(JSON.parse(value)); } catch { return null; }
}
export const normalizeCharacterAppearance = (value: unknown): CharacterAppearance | null => generatedAppearance(value) ?? normalizeAppearance(value);
export { skinAssetUrl } from './skinAssetUrl';
export type SkinJobState = 'reserving' | 'generating' | 'capturing' | 'ready' | 'selected' | 'refunding' | 'failed';
export type SkinCard = { id: string; jobId: string; prompt: string; createdAt: number };
export type SkinJob = { id: string; prompt: string; state: SkinJobState; error: string; selectedId: string | null; createdAt: number; variantCount: number; variants: SkinCard[]; funding?: 'paid' | 'reward';offerId?:SkinOfferId;priceUnits?:string };
export type SkinStudioSnapshot = { theme: typeof SKIN_THEME; priceUnits: string; variantCount: number;offerId?:SkinOfferId; enabled: boolean; job: SkinJob | null; wardrobe: SkinCard[]; equippedId: string | null; freeGenerations?: SkinGenerationGrant[];
  character: { skin: number; appearance: CharacterAppearance | null } };
export type SkinPurchase = { id: string; state: 'reserved' | 'captured' | 'refunded'; amountUnits: string };
