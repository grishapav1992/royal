import '../../src/style.css';
import { IndependentGameUI } from '../../src/modules/IndependentGameUI';
import { GAME_MODULES, type IndependentGameId } from '../../src/modules/GameModuleCatalog';
import { installGameHost } from '../../src/modules/GameHostRuntime';
import { demoWallet } from '../../src/wallet/WalletClient';
import { expansionClient } from '../../src/wallet/ExpansionClient';
import { minesClient } from '../../src/wallet/MinesClient';
import { casinoClients } from '../../src/wallet/CasinoClient';
import { flightClient } from '../../src/wallet/FlightClient';
import { nilePlay } from '../../src/wallet/NilePlayClient';
import { usdtWallet } from '../../src/wallet/UsdtClient';
import { cryptoWallet } from '../../src/wallet/CryptoClient';
import { PianoAudio } from '../../src/game/PianoAudio';
import * as demoGames from '../../src/game/demoGames';
import { ProviderGameUI } from '../../src/modules/ProviderGameUI';
import { CHESS_TIME_MS, type ActivitiesState, type TableState } from '../../src/shared/activities';
import type { GameModuleContextV1 } from '../../src/modules/GameHostContract';

const views = new Map<string, IndependentGameUI>();
const runtime = installGameHost();
const messages: unknown[] = [];
const statuses: unknown[] = [];
const self = 'module-self', peer = 'module-peer';
const pianoAudio = new PianoAudio();
let title = '', locked = false;
let provider: ProviderGameUI | undefined;
const table = (id: 'hockey' | 'pool'): TableState => ({
 id, players: [self, peer], phase: 'playing', score: [0, 0], groups: ['open', 'open'], breaking: false,
 ballInHand: 'none', message: '', sound: { seq: 0, kind: '' }, winner: '', turn: 0, moving: false,
 balls: [{ id: 0, x: id === 'hockey' ? 360 : 140, y: 200, vx: 0, vy: 0, active: true }, ...(id === 'pool' ? [{ id: 1, x: 400, y: 200, vx: 0, vy: 0, active: true }] : [])],
 paddles: [{ x: 100, y: 200 }, { x: 620, y: 200 }], ready: [], serveDelay: 0,
});
let state: ActivitiesState = {
 tables: [table('hockey'), table('pool')], pianist: self, notes: [],
 chess: { players: [self, peer], phase: 'playing', turn: 'w', board: [{ square: 'e1', type: 'k', color: 'w' }, { square: 'e8', type: 'k', color: 'b' }, { square: 'e2', type: 'p', color: 'w' }],
  moves: [{ from: 'e2', to: 'e4' }], last: null, check: false, winner: '', message: '', ready: [], revision: 1, sound: '', clock: { remainingMs: [CHESS_TIME_MS, CHESS_TIME_MS], running: null } },
};
const harness = {
 games: GAME_MODULES.map(game => game.gameId),
 open(gameId: IndependentGameId, container = 'primary') {
  views.get(container)?.destroy();
  const host = document.getElementById(container)!;
  host.replaceChildren();
  const context: GameModuleContextV1 = {
   setTitle(value) { title = value; }, onStatus(value) { statuses.push(value); },
   scene: { setLocked(value) { locked = value; }, approach() { return undefined; } },
   onPlaying(value) { messages.push({ type: 'provider-playing', value }); },
   onClosed() { messages.push({ type: 'provider-closed' }); },
   activity: {
    scene: { hall: gameId === 'piano' ? 'arcade' : 'tables', player: { x: 100, y: 200 } as any, setLocked(value) { locked = value; }, pianoNote(note) { messages.push({ type: 'piano-visual', note }); } },
    send(value) { messages.push(value); }, state: structuredClone(state),
    players: [{ id: self, name: 'Тестовый игрок' }, { id: peer, name: 'Соперник' }] as any,
    self, pianoAudio, onClose() { messages.push({ type: 'leave' }); harness.close(container); },
   },
  };
  views.set(container, new IndependentGameUI(host, gameId, context));
 },
 close(container = 'primary') {
  views.get(container)?.destroy(); views.delete(container);
  document.getElementById(container)!.replaceChildren();
 },
 account(id: string) { demoWallet.setAccount(id); },
 selectedDemo() { return demoGames.getCabinetDemoGame(); },
 providerOpen() {
  provider ??= new ProviderGameUI({ setLocked(value) { locked = value; }, approach() { return undefined; } }, value => messages.push({ type: 'provider-playing', value }));
  provider.open(true);
 },
 providerDestroy() { provider?.destroy(); provider = undefined; },
 retry() { return expansionClient.retry().catch(() => undefined); },
 start(container = 'primary') { views.get(container)?.start(); },
 pause(container = 'primary') { views.get(container)?.pause(); },
 resume(container = 'primary') { views.get(container)?.resume(); },
 messages() { return structuredClone(messages); },
 clearMessages() { messages.length = 0; },
 statuses() { return structuredClone(statuses); },
 clearStatuses() { statuses.length = 0; },
 currentState(container = 'primary') { return views.get(container)?.getState(); },
 activityState() { return structuredClone(state); },
 updateActivity(value: ActivitiesState, container = 'primary') { state = value; views.get(container)?.update(value); },
 updatePlayers(players: unknown[], playerId = self, container = 'primary') { views.get(container)?.updatePlayers(players as any, playerId); },
 receive(note: { player: string; note: number; down: boolean }, container = 'primary') { views.get(container)?.receive(note); },
 snapshot() {
  return { sharedWallet: runtime.demoWallet === demoWallet, sharedExpansion: runtime.expansionClient === expansionClient,
   sharedMines: runtime.minesClient === minesClient, sharedCasino: runtime.casinoClients === casinoClients,
   sharedFlight: runtime.flightClient === flightClient, sharedNile: runtime.nilePlay === nilePlay,
   sharedUsdt: runtime.usdtWallet === usdtWallet, sharedCrypto: runtime.cryptoWallet === cryptoWallet, title, lockedScene: locked,
   sharedDemoGames: runtime.demoGames === demoGames,
   pending: structuredClone(expansionClient.pending), balance: demoWallet.wallet?.balance,
   storage: expansionClient.accountId ? sessionStorage.getItem('royal-expansion:' + expansionClient.accountId) : null,
   locked: demoWallet.externalBusy };
 },
};
(window as unknown as { moduleHarness: typeof harness }).moduleHarness = harness;
