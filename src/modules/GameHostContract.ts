import type { flagToteClient } from '../wallet/FlagToteClient';
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
import type { PvpMove, PvpSnapshot } from '../shared/pvp';
import type { progression } from '../wallet/ProgressionClient';

export const GAME_HOST_KEY = Symbol.for('royal.game-host.v1');
export interface GameHostV1 {
 readonly apiVersion: 1;
 readonly manualStakes?: 1;
 readonly cosmicStakeLimit?: 1;
 readonly caramelStakeLimit?: 1;
 readonly flagToteClient?: typeof flagToteClient;
 readonly expansionClient: typeof expansionClient;
 readonly demoWallet: typeof demoWallet;
 readonly progression: typeof progression;
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
 readonly pvp?: {get():PvpSnapshot|undefined;busy():boolean;subscribe(callback:()=>void):()=>void;move(value:PvpMove):void;
   now?():number;terms?(stakeUnits:string,revision:number):void;ready?(revision:number,ready:boolean):void;cancel?():void};
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

export function mountGameHostRefresh(host: HTMLElement, gameName: string, language: string): GameModuleInstance {
 const document = host.ownerDocument;
 const panel = document.createElement('div');
 panel.style.cssText = 'padding:32px;text-align:center;color:inherit';
 const message = document.createElement('p');
 message.setAttribute('role', 'alert');
 const english = language === 'en';
 message.textContent = english ? `Refresh the page to play ${gameName}.` : `Обнови страницу, чтобы играть в ${gameName}.`;
 const refresh = document.createElement('button');
 refresh.type = 'button';
 refresh.textContent = english ? 'Refresh page' : 'Обновить страницу';
 refresh.onclick = () => document.defaultView?.location.reload();
 panel.append(message, refresh);
 host.replaceChildren(panel);
 return { destroy: () => panel.remove() };
}
