import type { RoomScene } from './game/RoomScene';
import type { PlayerView, HallId } from './shared/world';
import type { PlayerControls } from './ui/PlayerControls';

/** One online session survives presentation changes. The world is an optional view. */
export class ClubHost implements PlayerControls {
  presentation: 'club' | 'casino' = 'club';
  world?: RoomScene;
  private commands?: Parameters<RoomScene['enableOnline']>[0];
  private players: PlayerView[] = [];
  private selfId = '';
  private locked = true;
  private security = false;
  private snapshots: {
    time?: Parameters<RoomScene['syncNpcTime']>;
    guests?: Parameters<RoomScene['syncGuests']>[0];
    cat?: Parameters<RoomScene['syncCat']>[0];
    guards?: Parameters<RoomScene['syncGuards']>[0];
    mira?: Parameters<RoomScene['syncMira']>[0];
  } = {};
  onAtelier: RoomScene['onAtelier'] = () => {};
  onToiletMerchant: RoomScene['onToiletMerchant'] = () => {};
  onNotice: RoomScene['onNotice'] = () => {};
  onHall: RoomScene['onHall'] = () => {};
  onBar: RoomScene['onBar'] = () => {};
  onApproach: RoomScene['onApproach'] = () => {};

  attach(world: RoomScene) {
    this.world = world;
    world.onAtelier = () => this.onAtelier();
    world.onToiletMerchant = () => this.onToiletMerchant();
    world.onNotice = text => this.onNotice(text);
    world.onHall = hall => this.onHall(hall);
    world.onBar = () => this.onBar();
    world.onApproach = id => this.onApproach(id);
    if (this.commands) world.enableOnline(this.commands);
    if (this.snapshots.time) world.syncNpcTime(...this.snapshots.time);
    if (this.snapshots.guests) world.syncGuests(this.snapshots.guests);
    if (this.snapshots.guards) world.syncGuards(this.snapshots.guards);
    if (this.snapshots.cat) world.syncCat(this.snapshots.cat);
    if (this.snapshots.mira) world.syncMira(this.snapshots.mira);
    if (this.selfId) world.syncPlayers(this.players, this.selfId);
    world.setSecurity(this.security);
    world.setLocked(this.locked || this.presentation === 'casino');
  }
  get hall(): HallId { return this.world?.hall ?? this.players.find(p => p.id === this.selfId)?.hall ?? 'arcade'; }
  getState() {
    return this.world?.getState() ?? {
      hall: this.hall, x: 0, y: 0, cabinet: '', security: this.security,
      reducedMotion: this.getReducedMotion(), online: Boolean(this.commands), locked: this.locked,
    };
  }
  setLocked(value: boolean) { this.locked = value; this.world?.setLocked(value || this.presentation === 'casino'); }
  setSecurity(value: boolean) { this.security = value; this.world?.setSecurity(value); }
  setTyping(value: boolean) { this.world?.setTyping(value); }
  getReducedMotion() { return this.world?.getReducedMotion() ?? matchMedia('(prefers-reduced-motion: reduce)').matches; }
  getPortraitFrame(...args: Parameters<RoomScene['getPortraitFrame']>) { return this.world?.getPortraitFrame(...args) ?? ''; }
  guardPortrait() { return this.world?.textures.getBase64('security-guard', 'down-6') ?? ''; }
  enableOnline(commands: Parameters<RoomScene['enableOnline']>[0]) { this.commands = commands; this.world?.enableOnline(commands); }
  syncPlayers(players: PlayerView[], selfId: string) {
    this.players = players; this.selfId = selfId;
    this.security = Boolean(players.find(p => p.id === selfId)?.security);
    this.world?.syncPlayers(players, selfId);
  }
  syncNpcTime(...value: Parameters<RoomScene['syncNpcTime']>) { this.snapshots.time = value; this.world?.syncNpcTime(...value); }
  syncGuests(value: Parameters<RoomScene['syncGuests']>[0]) { this.snapshots.guests = value; this.world?.syncGuests(value); }
  syncGuards(value: Parameters<RoomScene['syncGuards']>[0]) { this.snapshots.guards = value; this.world?.syncGuards(value); }
  syncCat(value: Parameters<RoomScene['syncCat']>[0]) { this.snapshots.cat = value; this.world?.syncCat(value); }
  syncMira(value: Parameters<RoomScene['syncMira']>[0]) { this.snapshots.mira = value; this.world?.syncMira(value); }
  finishMovement(action: () => void) { if (this.world) this.world.finishMovement(action); else action(); }
  cancelMovement() { this.world?.cancelMovement(); this.commands?.stop(); }
  onElevatorCancel() { this.world?.onElevatorCancel(); }
  deferDecorations() { this.world?.deferDecorations(); }
  endCabinet() { this.world?.endCabinet(); }
  approach(id: string) { this.world?.approach(id); }
  cabinetOccupant(id: string) { return this.world?.cabinetOccupant(id); }
  beginCabinet(...args: Parameters<RoomScene['beginCabinet']>) { return this.world?.beginCabinet(...args) ?? Promise.resolve(false); }
  reactToGame(...args: Parameters<RoomScene['reactToGame']>) { this.world?.reactToGame(...args); }
  setDealerAction(...args: Parameters<RoomScene['setDealerAction']>) { this.world?.setDealerAction(...args); }
  recoverPlayer() { return this.world?.recoverPlayer() ?? Promise.resolve(false); }
  getTailorState() { return this.world?.getTailorState() ?? null; }
}
