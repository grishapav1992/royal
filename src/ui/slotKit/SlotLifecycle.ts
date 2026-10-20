import {gameAudio} from '../../game/GameAudio';
import {expansionClient} from '../../wallet/ExpansionClient';
import {demoWallet} from '../../wallet/WalletClient';

/** Subscribe only after the game DOM is mounted; release every listener together. */
export function bindSlotLifecycle(callbacks: {
  changed: () => void;
  visibility: () => void;
  keyboard: (event: KeyboardEvent) => void;
  motion: MediaQueryList;
  motionChanged: () => void;
  audioChanged: () => void;
}): () => void {
  const unsubscribeAudio = gameAudio.onPreferences(callbacks.audioChanged);
  expansionClient.addEventListener('change', callbacks.changed);
  demoWallet.addEventListener('change', callbacks.changed);
  document.addEventListener('visibilitychange', callbacks.visibility);
  document.addEventListener('keydown', callbacks.keyboard);
  callbacks.motion.addEventListener('change', callbacks.motionChanged);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeAudio();
    expansionClient.removeEventListener('change', callbacks.changed);
    demoWallet.removeEventListener('change', callbacks.changed);
    document.removeEventListener('visibilitychange', callbacks.visibility);
    document.removeEventListener('keydown', callbacks.keyboard);
    callbacks.motion.removeEventListener('change', callbacks.motionChanged);
  };
}
