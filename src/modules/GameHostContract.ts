import type { expansionClient } from '../wallet/ExpansionClient';
import type { demoWallet, coins } from '../wallet/WalletClient';
import type { gameAudio } from '../game/GameAudio';
import type * as i18n from '../i18n/index';
import type * as reactions from '../ui/gameReactions';

export const GAME_HOST_KEY = Symbol.for('royal.game-host.v1');
export interface GameHostV1 {
 readonly apiVersion: 1;
 readonly expansionClient: typeof expansionClient;
 readonly demoWallet: typeof demoWallet;
 readonly walletCoins: typeof coins;
 readonly gameAudio: typeof gameAudio;
 readonly i18n: typeof i18n;
 readonly reactions: typeof reactions;
}
export interface GameModuleV1 {
 readonly gameId: 'studio-afterglow';
 readonly apiVersion: 1;
 readonly rulesVersion: 2;
 readonly progressVersion: 3;
 mount(host: HTMLElement): { destroy(): void };
}

export function readGameHost(): GameHostV1 {
 const value = (globalThis as unknown as Record<symbol, GameHostV1>)[GAME_HOST_KEY];
 if (!value || value.apiVersion !== 1) throw Error('Game host version is incompatible');
 return value;
}
