import type { SkinCard, SkinJob, SkinStudioSnapshot } from './skinStudio';

export type SkinNpcContext = { skinId: string; description: string };
export type SkinDescriptionCard = SkinCard & { description?: string; descriptionPending?: boolean };
export type SkinDescribedSnapshot = Omit<SkinStudioSnapshot, 'job' | 'wardrobe'> & {
  job: (Omit<SkinJob, 'variants'> & { variants: SkinDescriptionCard[] }) | null;
  wardrobe: SkinDescriptionCard[];
};
