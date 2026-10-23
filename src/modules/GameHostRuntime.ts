import { expansionClient } from '../wallet/ExpansionClient';
import { demoWallet, coins } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import * as i18n from '../i18n/index';
import * as reactions from '../ui/gameReactions';
import * as demoGames from '../game/demoGames';
import { minesClient } from '../wallet/MinesClient';
import { casinoClients } from '../wallet/CasinoClient';
import { nilePlay } from '../wallet/NilePlayClient';
import { usdtWallet } from '../wallet/UsdtClient';
import { cryptoWallet } from '../wallet/CryptoClient';
import { flightClient } from '../wallet/FlightClient';
import Phaser from 'phaser';
import { GAME_HOST_KEY, type GameHostV1 } from './GameHostContract';

const runtime: GameHostV1 = Object.freeze({ apiVersion: 1, expansionClient, demoWallet,
 walletCoins: coins, gameAudio, i18n, reactions, demoGames, minesClient, casinoClients,
 nilePlay, usdtWallet, cryptoWallet, flightClient, Phaser });

/** Modules receive the existing host services, including their pending-operation state. */
export function installGameHost(): GameHostV1 {
 const previous = Object.getOwnPropertyDescriptor(globalThis, GAME_HOST_KEY);
 if (previous && previous.value !== runtime) throw Error('A different game host is already installed');
 if (!previous) Object.defineProperty(globalThis, GAME_HOST_KEY, { value: runtime, writable: false, configurable: false });
 return runtime;
}
