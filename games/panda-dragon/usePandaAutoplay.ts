import { useLayoutEffect, useRef, useState } from 'react';
import { AUTO_SPIN_COUNTS, Autoplay } from '../../src/ui/slotKit/SlotAutoplay';
import { DRAGON_PATH_FREE_SPIN } from '../../src/shared/dragonPathProtocol';
import type { SlotActionsV1 } from '../../templates/slot-primitive/src/actions.ts';
import type { SlotRound, SlotStatus } from '../../templates/slot-primitive/src/index.ts';
import type { PandaState } from './mountPanda';
import type { PandaView } from './PandaView';

type Round = SlotRound<PandaView>;
interface Series { account: string; draft: string; controller: AbortController }
interface Playback {
  state: PandaState;
  commands: SlotActionsV1<PandaView>;
  account: () => string | null;
  canPlay: () => boolean;
  run: (action: () => Promise<void>, animate?: boolean) => Promise<boolean>;
  presented: Round | null;
  status: SlotStatus;
  paused: boolean;
  resultDelay: number;
  failure: string | null;
}

export function usePandaAutoplay(playback: Playback) {
  const latest = useRef(playback);
  const series = useRef<Series | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const acknowledge = useRef<(() => void) | null>(null);
  const [bonusResult, setBonusResult] = useState<Round | null>(null);
  const [, redraw] = useState(0);
  const [auto] = useState(() => new Autoplay(spin, () => redraw(v => v + 1), finishRound));

  function stop() {
    auto.stop();
    series.current?.controller.abort();
  }

  function isCurrent(active: Series) {
    const { account, canPlay } = latest.current;
    return !active.controller.signal.aborted && canPlay() && account() === active.account;
  }

  function waitForPresentation(id: string, signal: AbortSignal, settled = false) {
    return new Promise<Round | null>(resolve => {
      const abort = () => finish(null);
      function finish(round: Round | null) {
        wake.current = null;
        signal.removeEventListener('abort', abort);
        resolve(round);
      }
      wake.current = () => {
        const { presented } = latest.current;
        if (presented?.id === id && (!settled || presented.state === 'settled')) finish(presented);
      };
      if (signal.aborted) abort();
      else {
        signal.addEventListener('abort', abort, { once: true });
        wake.current();
      }
    });
  }

  async function confirmed(type: 'bet' | 'free', action: () => Promise<void>) {
    const { commands, run } = latest.current;
    let accepted = false;
    const off = commands.subscribeFeedback(event => { if (event.type === type) accepted = true; });
    try {
      return await run(action) && accepted;
    } finally { off(); }
  }

  async function spin() {
    const active = series.current;
    const { state, commands } = latest.current;
    if (!active || !isCurrent(active) || state.read().status !== 'spin') return false;
    return confirmed('bet', () => commands.bet(active.draft));
  }

  async function finishRound() {
    const active = series.current;
    if (!active || !isCurrent(active)) { stop(); return; }
    const { state, commands } = latest.current;
    const liveRound = state.read().round;
    if (!liveRound) { stop(); return; }
    const signal = active.controller.signal;
    const shown = await waitForPresentation(liveRound.id, signal);
    if (!shown || !isCurrent(active)) { stop(); return; }
    if (shown.state === 'active') {
      const free = state.read().freeActions.find(action => action.id === DRAGON_PATH_FREE_SPIN);
      if (free && !await confirmed('free', () => commands.playFree(shown, free.id))) { stop(); return; }
      const result = await waitForPresentation(shown.id, signal, true);
      if (!result || !isCurrent(active)) { stop(); return; }
      await new Promise<void>(resolve => {
        function finish() {
          signal.removeEventListener('abort', finish);
          acknowledge.current = null;
          setBonusResult(null);
          resolve();
        }
        acknowledge.current = finish;
        signal.addEventListener('abort', finish, { once: true });
        setBonusResult(result);
      });
    }
    if (isCurrent(active)) await pauseBetweenSpins(latest.current.resultDelay, signal);
  }

  function start(count: number, draft: string) {
    const { state, account, canPlay } = latest.current;
    const id = account();
    if (series.current || !id || !canPlay() || state.read().status !== 'spin' || state.stakes.parse(draft) === undefined
      || !AUTO_SPIN_COUNTS.some(value => value === count)) return;
    series.current = { account: id, draft, controller: new AbortController() };
    void auto.start(count).catch(error => {
      console.error('Не удалось завершить автоигру «Пути дракона».', error);
    }).finally(() => { series.current = null; });
  }

  useLayoutEffect(() => {
    latest.current = playback;
    if (series.current && (!isCurrent(series.current) || playback.paused || playback.failure
      || (playback.status !== 'busy' && playback.status !== 'continue' && playback.status !== 'spin'))) stop();
    wake.current?.();
  });
  useLayoutEffect(() => {
    const onVisibility = () => { if (document.hidden) stop(); };
    const unsubscribe = playback.state.subscribe(() => {
      if (series.current && !isCurrent(series.current)) stop();
    });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      series.current?.controller.abort();
    };
  }, [playback.state]);

  return { ...auto.state, start, stop, bonusResult, confirmBonus: () => acknowledge.current?.() };
}

function pauseBetweenSpins(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
