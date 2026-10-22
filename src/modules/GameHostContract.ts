import type { IndependentGameId } from './GameModuleCatalog';
import type { expansionClient } from '../wallet/ExpansionClient';
import type { demoWallet, coins } from '../wallet/WalletClient';
import type { gameAudio } from '../game/GameAudio';
import type * as i18n from '../i18n/index';
import type * as reactions from '../ui/gameReactions';
import type * as demoGames from '../game/demoGames';
import type { minesClient } from '../wallet/MinesClient';
import type { casinoClients } from '../wallet/CasinoClient';
import type { nilePlay } from '../wallet/NilePlayClient';
import type { usdtWallet } from '../wallet/UsdtClient';
import type { cryptoWallet } from '../wallet/CryptoClient';
import type { flightClient } from '../wallet/FlightClient';
import type Phaser from 'phaser';
import type { RoomScene } from '../game/RoomScene';
import type { BreakerStatus } from '../game/breaker';
import type { ActivitiesState, PianoNote } from '../shared/activities';
import type { PlayerView } from '../shared/world';
import type { ActivityHostContext } from './ActivityHostContract';

export const GAME_HOST_KEY = Symbol.for('royal.game-host.v1');
export interface GameHostV1 {
 readonly apiVersion: 1;
 readonly expansionClient: typeof expansionClient;
 readonly demoWallet: typeof demoWallet;
 readonly walletCoins: typeof coins;
 readonly gameAudio: typeof gameAudio;
 readonly i18n: typeof i18n;
 readonly reactions: typeof reactions;
 readonly demoGames: typeof demoGames;
 readonly minesClient: typeof minesClient;
 readonly casinoClients: typeof casinoClients;
 readonly nilePlay: typeof nilePlay;
 readonly usdtWallet: typeof usdtWallet;
 readonly cryptoWallet: typeof cryptoWallet;
 readonly flightClient: typeof flightClient;
 readonly Phaser: typeof Phaser;
}
export interface GameModuleInstance {
 destroy(): void;
 start?(): void;
 restart?(): void;
 load?(): void | Promise<void>;
 open?(atCabinet?: boolean): void;
 pause?(): void;
 resume?(): void;
 getState?(): unknown;
 update?(state: ActivitiesState): void;
 updatePlayers?(players: PlayerView[], self: string): void;
 receive?(note: PianoNote): void;
 hallChanged?(): void;
 connected?(): void;
 disconnected?(): void;
}
export interface GameModuleContextV1 {
 readonly onStatus?: (state: BreakerStatus) => void;
 readonly setTitle?: (title: string) => void;
 readonly scene?: Pick<RoomScene, 'setLocked' | 'approach'>;
 readonly onPlaying?: (playing: boolean) => void;
 readonly onClosed?: () => void;
 readonly onMounted?: (instance: GameModuleInstance) => void;
 readonly provider?: { readonly embedded: boolean; readonly gameId?: string; readonly gameName?: string; readonly onCatalogue: () => void };
 readonly activity?: ActivityHostContext;
}
export interface GameModuleV1 {
 readonly gameId: IndependentGameId;
 readonly apiVersion: 1;
 readonly rulesVersion: number;
 readonly progressVersion: number;
 mount(host: HTMLElement, context?: GameModuleContextV1): { destroy(): void };
}

export function readGameHost(): GameHostV1 {
 const value = (globalThis as unknown as Record<symbol, GameHostV1>)[GAME_HOST_KEY];
 if (!value || value.apiVersion !== 1) throw Error('Game host version is incompatible');
 return value;
}
