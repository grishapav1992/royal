import { createRoot } from 'react-dom/client';
import type { GameHostV1, GameModuleInstance } from '../../src/modules/GameHostContract';
import type { SlotActionsV1 } from '../../templates/slot-primitive/src/actions.ts';
import type { SlotServicesV1 } from '../../templates/slot-primitive/src/index.ts';
import { PandaSlot } from './PandaSlot';
import type { PandaView } from './PandaView';
import { createPandaAudio } from './sound';

export type PandaState = Pick<SlotServicesV1<PandaView>, 'stakes' | 'read' | 'subscribe'>;

interface PandaMountOptions {
  title: string;
  state: PandaState;
  commands: SlotActionsV1<PandaView>;
  hostAudio: GameHostV1['gameAudio'];
}

export function mountPanda(host: HTMLElement, { title, state, commands, hostAudio }: PandaMountOptions): GameModuleInstance {
  const root = createRoot(host);
  const audio = createPandaAudio(hostAudio);
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  const render = () => root.render(<div className="panda-page"><PandaSlot title={title} state={state} commands={commands} audio={audio} paused={paused || document.hidden} reducedMotion={motionPreference.matches} /></div>);
  motionPreference.addEventListener('change', render);
  render();
  return {
    pause() { paused = true; audio.cancel(); render(); },
    resume() { paused = false; render(); },
    destroy() {
      motionPreference.removeEventListener('change', render);
      root.unmount();
      audio.destroy();
    },
  };
}
