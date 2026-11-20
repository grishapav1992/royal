import type { SlotRound, SlotServicesV1 } from './index.ts';

type RoundRef<View> = Pick<SlotRound<View>, 'id' | 'revision'>;
export type SlotOutcome = 'loss' | 'partial' | 'return' | 'win' | 'bigwin';
export type SlotFeedback<View> =
  | Readonly<{ type: 'bet' | SlotOutcome; round: SlotRound<View> }>
  | Readonly<{ type: 'free'; round: SlotRound<View>; actionId: string }>;

type FeedbackListener<View> = (event: SlotFeedback<View>) => void | Promise<void>;
export type SlotPresentationActions<View> = Readonly<Partial<{
  [Type in SlotFeedback<View>['type']]: (event: SlotFeedback<View>, signal: AbortSignal) => void | Promise<void>;
}>>;

export interface SlotActionsV1<View> {
  bet(stakeDraft: string): Promise<void>;
  playFree(round: RoundRef<View>, actionId: string, picks?: readonly number[]): Promise<void>;
  recover(): Promise<void>;
  refresh(): Promise<void>;
  subscribeFeedback(listener: FeedbackListener<View>): () => void;
}

function outcome<View>(round: SlotRound<View>, bigWinMultiplier?: number): SlotOutcome | undefined {
  if (round.state !== 'settled') return;
  const spent = BigInt(round.spentCents);
  const returned = BigInt(round.returnedCents);
  if (spent <= 0n) return;
  if (returned === 0n) return 'loss';
  if (returned < spent) return 'partial';
  if (returned === spent) return 'return';
  return bigWinMultiplier !== undefined && returned >= spent * BigInt(bigWinMultiplier) ? 'bigwin' : 'win';
}

function reportFeedbackError(error: unknown) {
  console.error('Slot presentation feedback failed', error);
}

export function createSlotActions<View>(services: SlotServicesV1<View>, { bigWinMultiplier }: {
  bigWinMultiplier?: number;
} = {}): SlotActionsV1<View> {
  if (bigWinMultiplier !== undefined && (!Number.isSafeInteger(bigWinMultiplier) || bigWinMultiplier < 2)) {
    throw Error('Invalid big win multiplier');
  }
  const listeners = new Set<{ notify: FeedbackListener<View> }>();
  let submitting = false;

  async function submit(send: () => Promise<SlotRound<View> | null>, actionId?: string) {
    if (submitting) throw Error('A slot action is already in progress');
    const audience = [...listeners];
    submitting = true;
    try {
      const round = await send();
      if (!round) return;
      const emit = (event: SlotFeedback<View>) => {
        for (const entry of audience) {
          if (!listeners.has(entry)) continue;
          try { void Promise.resolve(entry.notify(event)).catch(reportFeedbackError); }
          catch (error) { reportFeedbackError(error); }
        }
      };
      emit(actionId === undefined ? { type: 'bet', round } : { type: 'free', round, actionId });
      const result = outcome(round, bigWinMultiplier);
      if (result) emit({ type: result, round });
    } finally {
      submitting = false;
    }
  }

  return {
    bet: draft => submit(() => services.spin(draft)),
    playFree: (expected, actionId, picks) => submit(() => services.playFree(expected, actionId, picks), actionId),
    recover: () => services.recover(),
    refresh: () => services.refresh(),
    subscribeFeedback(notify) {
      const entry = { notify };
      listeners.add(entry);
      return () => { listeners.delete(entry); };
    },
  };
}
