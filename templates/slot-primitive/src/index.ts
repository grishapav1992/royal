export type SlotStatus = 'spin' | 'continue' | 'recover' | 'busy' | 'blocked'
  | 'signed-out' | 'sync-required' | 'unsupported-round';

export type SlotRound<View> = Readonly<{
  id: string;
  revision: number;
  rulesVersion: number;
  state: 'active' | 'settled';
  stakeCents: string;
  spentCents: string;
  returnedCents: string;
  view: View;
}>;

export type SlotChoice = Readonly<{ value: number; label: string }>;
export type SlotFreeAction = Readonly<{
  id: string;
  label: string;
  minPicks: number;
  maxPicks: number;
  choices: readonly SlotChoice[];
}>;

export function validFreePicks(action: SlotFreeAction, picks: readonly number[]): boolean {
  return picks.length >= action.minPicks && picks.length <= action.maxPicks
    && new Set(picks).size === picks.length
    && Array.from(picks).every(pick => action.choices.some(choice => choice.value === pick));
}

export type SlotSnapshot<View> = Readonly<{
  status: SlotStatus;
  round: SlotRound<View> | null;
  freeActions: readonly SlotFreeAction[];
  balanceLabel: string | null;
  error: string | null;
}>;

export interface SlotServicesV1<View> {
  readonly apiVersion: 1;
  readonly stakes: Readonly<{
    defaultCents: string;
    presetsCents: readonly string[];
    parse(draft: string): string | undefined;
  }>;
  read(): SlotSnapshot<View>;
  subscribe(change: () => void): () => void;
  // Only a fresh confirmation of this command returns a round; recovery and refresh do not replay it.
  spin(stakeDraft: string): Promise<SlotRound<View> | null>;
  playFree(round: Pick<SlotRound<View>, 'id' | 'revision'>, actionId: string, picks?: readonly number[]): Promise<SlotRound<View> | null>;
  recover(): Promise<void>;
  refresh(): Promise<void>;
}

export function formatCents(cents: string): string {
  const digits = cents.padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
