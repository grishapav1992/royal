import { createSlotActions } from '../../templates/slot-primitive/src/actions.ts';
import { mountGameHostRefresh, readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { DRAGON_PATH } from '../../src/modules/GameModuleCatalog';
import { createDragonPathServices } from './wallet-binding';
import { BIG_WIN_MULTIPLIER } from './layout';
import { mountPanda } from './mountPanda';
import './panda.css';

export const { gameId, apiVersion, rulesVersion, progressVersion } = DRAGON_PATH;

export const mount: GameModuleV1['mount'] = (host, context) => {
  const runtime = readGameHost();
  const title = runtime.i18n.t(DRAGON_PATH.title);
  context?.setTitle?.(title);
  if (runtime.manualStakes !== 1 || runtime.expansionClient.dragonPathRules !== rulesVersion)
    return mountGameHostRefresh(host, title, runtime.i18n.language);
  const services = createDragonPathServices(runtime);
  void services.refresh();
  return mountPanda(host, {
    title, state: services,
    commands: createSlotActions(services, { bigWinMultiplier: BIG_WIN_MULTIPLIER }),
    hostAudio: runtime.gameAudio,
    account: () => runtime.expansionClient.accountId,
  });
};
