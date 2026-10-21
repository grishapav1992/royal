import { t } from '../i18n/index';
import { installGameHost } from './GameHostRuntime';
import { GIRLHUB_MODULE, validModulePointer, validModuleManifest, moduleDigest, moduleRoot } from './GameModuleManifest';
import { gameModuleContract, type IndependentGameId } from './GameModuleCatalog';
import type { GameModuleV1, GameModuleContextV1, GameModuleInstance } from './GameHostContract';
import type { ActivitiesState, PianoNote } from '../shared/activities';
import type { PlayerView } from '../shared/world';

const owners = new WeakMap<HTMLElement, IndependentGameUI>();

/** A loaded round keeps its immutable module version until the game is closed. */
export class IndependentGameUI {
 private disposed = false;
 private controller?: AbortController;
 private game?: GameModuleInstance;
 private style?: HTMLLinkElement;
 private attempt = 0;
 private latestState?: ActivitiesState;
 private latestPlayers?: { players: PlayerView[]; self: string };
 private paused = false;
 constructor(private host: HTMLElement, private gameId: IndependentGameId = GIRLHUB_MODULE, private context: GameModuleContextV1 = {}) {
  if (!gameModuleContract(gameId)) throw Error('Unsupported independent game');
  owners.get(host)?.destroy();
  owners.set(host, this);
  void this.loadPackage();
 }
 private owns() { return !this.disposed && owners.get(this.host) === this; }
 private clearStyle() { this.style?.remove(); this.style = undefined; }
 private async json(url: string) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: this.controller!.signal });
  if (!response.ok) throw Error('Game package is unavailable');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 65536) throw Error('Game manifest is too large');
  return { bytes, data: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
 }
 private async stylesheet(url: string) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = url; link.dataset.royalGameModule = this.gameId;
  this.style = link;
  await new Promise<void>((resolve, reject) => {
   const finish = (error?: Error) => { clearTimeout(timeout); this.controller?.signal.removeEventListener('abort', abort); link.onload = link.onerror = null; error ? reject(error) : resolve(); };
   const abort = () => finish(new DOMException('Game closed', 'AbortError'));
   const timeout = setTimeout(() => finish(new Error('Game stylesheet timed out')), 12000);
   link.onload = () => finish(); link.onerror = () => finish(new Error('Game stylesheet is unavailable'));
   this.controller!.signal.addEventListener('abort', abort, { once: true });
   if (this.controller!.signal.aborted) abort(); else document.head.append(link);
  });
 }
 private async loadPackage() {
  if (!this.owns()) return;
  this.controller?.abort(); this.clearStyle();
  this.controller = new AbortController();
  const loading = document.createElement('div'); loading.setAttribute('role', 'status'); loading.style.cssText = 'padding:32px;text-align:center;color:inherit';
  loading.textContent = t('Загрузка игры…'); this.host.replaceChildren(loading);
  const timeout = setTimeout(() => this.controller?.abort(), 20000);
  try {
   const pointer = (await this.json(`/game-modules/${this.gameId}/active.json`)).data;
   if (!validModulePointer(pointer, this.gameId)) throw Error('Invalid game pointer');
   const manifest = await this.json(pointer.manifest);
   if (await moduleDigest(manifest.bytes) !== pointer.sha256 || !validModuleManifest(manifest.data, pointer.manifest, this.gameId)) throw Error('Incompatible game package');
   if (!this.owns()) return;
   const metadata = manifest.data, root = moduleRoot(metadata.version, this.gameId);
   installGameHost();
   await this.stylesheet(root + metadata.styles[0]);
   const path = root + metadata.entry + (this.attempt ? `?retry=${this.attempt}` : '');
   const module = await import(/* @vite-ignore */ path) as GameModuleV1;
   if (!this.owns()) return;
   const contract = gameModuleContract(this.gameId)!;
   if (module.gameId !== this.gameId || module.apiVersion !== contract.apiVersion || module.rulesVersion !== contract.rulesVersion || module.progressVersion !== contract.progressVersion || typeof module.mount !== 'function') throw Error('Incompatible game interface');
   this.game = module.mount(this.host, this.context) as GameModuleInstance;
   if (this.latestPlayers) this.game.updatePlayers?.(this.latestPlayers.players, this.latestPlayers.self);
   if (this.latestState) this.game.update?.(this.latestState);
   if (this.paused) this.game.pause?.();
   this.host.dataset.gameModuleVersion = metadata.version;
   this.host.dataset.gameModuleId = this.gameId;
   this.context.onMounted?.(this.game);
  } catch (error) {
   this.clearStyle();
   if (!this.owns()) return;
   const panel = document.createElement('div'); panel.style.cssText = 'padding:32px;text-align:center;color:inherit';
   const message = document.createElement('p'); message.setAttribute('role', 'alert');
   message.textContent = t('Не удалось загрузить игру. Повтори попытку. Монеты не списывались.');
   const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('Повторить загрузку');
   retry.onclick = () => { this.attempt++; void this.loadPackage(); };
   panel.append(message, retry); this.host.replaceChildren(panel);
   console.warn('Game module did not open:', error instanceof Error ? error.message : 'load failed');
  } finally { clearTimeout(timeout); }
 }
 start() { this.game?.start?.(); }
 restart() { this.game?.restart?.(); }
 load() { return this.game?.load?.(); }
 open(atCabinet = false) { this.game?.open?.(atCabinet); }
 pause() { this.paused = true; this.game?.pause?.(); }
 resume() { this.paused = false; this.game?.resume?.(); }
 getState() { return this.game?.getState?.() ?? null; }
 update(state: ActivitiesState) { this.latestState = state; this.game?.update?.(state); }
 updatePlayers(players: PlayerView[], self: string) { this.latestPlayers = { players, self }; this.game?.updatePlayers?.(players, self); }
 receive(note: PianoNote) { this.game?.receive?.(note); }
 hallChanged() { this.game?.hallChanged?.(); }
 connected() { this.game?.connected?.(); }
 disconnected() { this.game?.disconnected?.(); }
 destroy() {
  if (this.disposed) return;
  this.disposed = true; this.controller?.abort(); this.game?.destroy(); this.game = undefined;
  this.clearStyle();
  if (owners.get(this.host) === this) { owners.delete(this.host); delete this.host.dataset.gameModuleVersion; delete this.host.dataset.gameModuleId; }
 }
}
