import { createRoot } from 'react-dom/client';
import type { GameHostV1, GameModuleInstance } from '../../src/modules/GameHostContract';
import type { SlotActionsV1 } from '../../templates/slot-primitive/src/actions.ts';
import type { SlotServicesV1 } from '../../templates/slot-primitive/src/index.ts';
import { PandaSlot } from './PandaSlot';
import { PandaValley } from './PandaValley';
import type { PandaView } from './PandaView';
import { createPandaAudio } from './sound';

export type PandaState = Pick<SlotServicesV1<PandaView>, 'stakes' | 'read' | 'subscribe'>;

interface PandaMountOptions {
  title: string;
  state: PandaState;
  commands: SlotActionsV1<PandaView>;
  hostAudio: GameHostV1['gameAudio'];
  account: () => string | null;
}

export function mountPanda(host: HTMLElement, { title, state, commands, hostAudio, account }: PandaMountOptions): GameModuleInstance {
  const root = createRoot(host);
  const audio = createPandaAudio(hostAudio);
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  let currentAccount = account();
  const canPlay = () => !paused && !document.hidden;
  const render = () => {
    const inactive = !canPlay();
    const reducedMotion = motionPreference.matches;
    root.render(<div className="panda-page">
      <PandaValley paused={inactive} reducedMotion={reducedMotion} />
      <PandaSlot key={currentAccount} title={title} state={state} commands={commands} audio={audio} account={account}
        canPlay={canPlay} paused={inactive} reducedMotion={reducedMotion} />
    </div>);
  };
  const unsubscribe = state.subscribe(() => {
    const next = account();
    if (currentAccount === next) return;
    currentAccount = next;
    audio.cancel();
    render();
  });
  motionPreference.addEventListener('change', render);
  render();
  return {
    pause() { paused = true; audio.cancel(); render(); },
    resume() { paused = false; render(); },
    destroy() {
      paused = true;
      unsubscribe();
      motionPreference.removeEventListener('change', render);
      root.unmount();
      audio.destroy();
    },
  };
}
