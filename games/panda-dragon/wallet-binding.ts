import { createRoyalSlotServices } from '../../src/modules/RoyalSlotServices';
import type { GameHostV1 } from '../../src/modules/GameHostContract';
import {
  DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_FREE_SPIN, DRAGON_PATH_GAME, DRAGON_PATH_REWARDS,
  DRAGON_PATH_REWARD_LABELS, DRAGON_PATH_RULES_VERSION,
} from '../../src/shared/dragonPathProtocol';
import { PANDA_LAYOUT } from './layout';
import type { PandaView } from './PandaView';

export function createDragonPathServices(host: GameHostV1) {
  return createRoyalSlotServices<PandaView>(host, {
    gameId: DRAGON_PATH_GAME,
    rulesVersion: DRAGON_PATH_RULES_VERSION,
    ordinaryStart: () => ({}),
    freeMoves: () => [
      { id: DRAGON_PATH_FREE_SPIN },
      { id: DRAGON_PATH_CHOOSE_REWARD, choices: DRAGON_PATH_REWARDS.map(value => ({ value, label: DRAGON_PATH_REWARD_LABELS[value] })) },
    ],
    project(session) {
      const confirmed = session.view.dragonPath;
      if (!confirmed) return;
      const { round, wins, scatterPositions } = confirmed;
      const features: string[] = [];
      if (round.phase === 'free-spin') features.push('Три Свитка Дракона открыли бонус', 'Остался 1 бесплатный спин');
      if (round.free) features.push('Множитель ×3');
      if (round.reward !== null) features.push('Бонус завершён', DRAGON_PATH_REWARD_LABELS[round.reward]);
      return { revision: round.revision, view: {
        columns: PANDA_LAYOUT.columns,
        paylines: PANDA_LAYOUT.paylines,
        symbols: round.free ?? round.base,
        highlights: [...new Set([...wins.flatMap(win => win.positions), ...scatterPositions])],
        wins: wins.filter(win => win.kind === 'line').map(win => ({ line: win.index, length: win.count })),
        columnWins: wins.filter(win => win.kind === 'column').map(win => ({ column: win.index, from: 0, length: win.count })),
        scatter: scatterPositions.length > 0,
        features,
      } };
    },
  });
}
