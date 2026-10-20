import type {ExpansionGameId} from '../../shared/casinoExpansion';

export type SlotProtocol = 'luelon' | 'caramel' | 'convoy' | 'nitro' | 'afterglow';

export type SlotAudioProfile = {
  readonly musicStorageKey: string;
  readonly musicChords: readonly (readonly number[])[];
  readonly melody: readonly number[];
  readonly spinNotes: readonly number[];
  readonly musicIntervalMs: number;
  readonly spinIntervalMs: number;
  readonly featureCues: Readonly<Record<string, 'expand' | 'silent' | 'echo' | 'tickets' | 'drop'>>;
};

/** Presentation configuration. Probability models remain in the server game modules. */
export type SlotDefinition = {
  readonly gameId: ExpansionGameId;
  readonly title: string;
  readonly protocol: SlotProtocol;
  readonly assets: Readonly<Record<string, string>>;
  readonly audio: SlotAudioProfile;
};
