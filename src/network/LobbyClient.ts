import { translateMessage as translateText } from '../i18n/index';
import type { CatView } from '../shared/cat';
import type { GuardView, SecurityDecision } from '../shared/security';
import type { MiraView } from '../shared/miraRoutine';
import type { AmbientGuestView } from '../shared/ambientGuests';
import { Client, ErrorCode, type Room } from '@colyseus/sdk';
import type { LobbyState } from '../../server/state';
import type { PlayerView, ChatMessage, HallId } from '../shared/world';
import type { ElevatorResult } from '../shared/elevator';
import { mergeActivities, mergePianoNote, type ActivitiesMessage, type ActivitiesState, type PianoNote } from '../shared/activities';
import { savedSession, savedRoom, rememberSession, forgetSession } from './sessionRecovery';
import { configureReconnection, lobbyMatchmakingFetch } from './reconnection';
import { LOBBY_RECOVERY_WINDOW_MS } from '../shared/lobbyConnection';
import type { CabinetPlayResult } from '../shared/cabinetSeating';
import type { ChatRequest, ChatResult } from '../shared/chat';
import type { PvpSnapshot } from '../shared/pvp';
import type { PlayerRecoveryResult } from '../shared/playerRecovery';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export class LobbyClient {
  private client = new Client(import.meta.env.VITE_SERVER_URL || `${location.origin}${import.meta.env.DEV ? '/multiplayer' : ''}`, { fetchFn: lobbyMatchmakingFetch });
  private room?: Room<LobbyState>;
  private revision=0;
  private joining?: Promise<void>;
  private generation = 0;
  private recovery?: Promise<void>;
  private recoveryWait?: { timer: ReturnType<typeof setTimeout>; cancel: () => void };
  private lastCloseCode?: number;
  private recoveryAttempts = 0;
  private activities?:ActivitiesState;
  private cabinetRequest = 0;
  private elevatorRequest = 0;
  private recoveryRequest = 0;
  private pendingPlayerRecovery?: { requestId: number; hall?: HallId; revision?: number; finish: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> };
  private hall?: HallId;
  private pendingElevator?: { target: HallId; requestId: number; revision?: number; finish: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> };
  private releaseCabinetWhenConnected = false;
  private pendingCabinet?: { id: string; requestId: number; finish: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> };
  status: ConnectionStatus = 'disconnected';
  constructor(private events: {
    npcTime: (simulationAt: number, guestsAt: number) => void;
    guards: (guards: GuardView[]) => void;
    guests: (guests: AmbientGuestView[]) => void;
    cat?: (cat: CatView) => void;
    mira: (mira: MiraView) => void;
    security: (decision: SecurityDecision) => void;
    ejected: (until: number) => void;
    status: (status: ConnectionStatus) => void;
    joined: (roomId: string, sessionId: string, recovering?: boolean) => void;
    players: (players: PlayerView[], selfId: string) => void;
    chat: (message: ChatMessage) => void;
    delivery?: (result: ChatResult) => void;
    pvp?:(value:PvpSnapshot)=>void;
    pvpResult?:(value:{requestId:string;error:string;rejected:boolean})=>void;
    history: (messages: ChatMessage[]) => void;
    notice: (message: string) => void;
    activities: (state: ActivitiesState) => void;
    note: (note: PianoNote) => void;
  }) {}
  join(roomId?: string, returningToRoom = false, accountId?: string): Promise<void> {
    if (this.recovery) return this.recovery;
    if (this.joining) return this.joining;
    if (this.room) return Promise.resolve();
    const generation = ++this.generation;
    const joining = this.joinRoom(roomId, returningToRoom, accountId, generation).finally(() => {
      if (this.joining === joining) this.joining = undefined;
    });
    this.joining = joining;
    return joining;
  }
  private async joinRoom(roomId: string | undefined, returningToRoom: boolean, accountId: string | undefined, generation: number, recovering = false) {
    if (!recovering) this.releaseCabinetWhenConnected = false;
    this.activities=undefined;
    this.setStatus(recovering ? 'reconnecting' : 'connecting');
    try {
      const explicitRoom=!!roomId;roomId??=savedRoom(accountId);
      let room: Room<LobbyState> | undefined;
      // A network-error page or direct navigation can discard history.state while the account-bound reservation is still valid.
      const token = savedSession(accountId, roomId);
      if (token) {
        for(let attempt=0;attempt<5;attempt++){
        const attemptToken=savedSession(accountId,roomId)??token;
        try { room = await this.client.reconnect<LobbyState>(attemptToken);break; }
        catch (error) {
          if (generation !== this.generation) return;
          const code = (error as { code?: number }).code;
          // Only an expired reservation permits a fresh entry.
          if (code !== ErrorCode.MATCHMAKE_INVALID_ROOM_ID && code !== ErrorCode.MATCHMAKE_EXPIRED) throw error;
          // A prior socket can finish dropping or rotate its token while a replacement tab starts.
          if(code===ErrorCode.MATCHMAKE_EXPIRED&&attempt<4){await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));continue;}
          forgetSession(accountId,roomId,code===ErrorCode.MATCHMAKE_INVALID_ROOM_ID?undefined:attemptToken);
          if(!explicitRoom&&code===ErrorCode.MATCHMAKE_INVALID_ROOM_ID)roomId=undefined;
          break;
        }
        }
      }
      if (generation !== this.generation) { void room?.leave(); return; }
      const recovered = Boolean(room);
      if (!room) {
        try {
          room = roomId ? await this.client.joinById<LobbyState>(roomId, {activityProtocol:1}) : await this.client.joinOrCreate<LobbyState>('lobby', {activityProtocol:1});
        } catch (error) {
          if (generation !== this.generation) return;
          // Empty rooms can disappear while this tab reloads. Explicit invitations still show an error.
          if (!returningToRoom || (error as { code?: number }).code !== ErrorCode.MATCHMAKE_INVALID_ROOM_ID) throw error;
          room = await this.client.joinOrCreate<LobbyState>('lobby', {activityProtocol:1});
        }
      }
      if (generation !== this.generation) { void room.leave(); return; }
      this.room = room;
      rememberSession(room, accountId);
      const current = () => this.room === room && generation === this.generation;
      const onMessage = <T>(type: string, callback: (message: T) => void) => room.onMessage<T>(type, message => {
        if (current()) callback(message);
      });
      // Recover even when the connection drops just after entering the room.
      configureReconnection(room.reconnection);
      let banUntil = 0;
      let denied = false;
      onMessage('security', (decision: SecurityDecision) => { if(decision.kind === 'ejecting') banUntil = decision.until; this.events.security(decision); });
      onMessage('ejected', (value: {until: number}) => { banUntil = value.until; this.events.ejected(value.until); });
      // Older servers can still emit this packet during a host update.
      onMessage('chat-check', () => {});
      onMessage('chat-result', (result: ChatResult) => {
        if (result && typeof result.id === 'string' && ['queued', 'published', 'rejected', 'cancelled'].includes(result.status)) {
          this.events.delivery?.({ ...result, message: result.message ? translateText(result.message) : undefined });
        }
      });
      onMessage('chat', message => this.events.chat(message as ChatMessage));
      onMessage('history', messages => this.events.history(messages as ChatMessage[]));
      onMessage('notice', message => this.events.notice(translateText(String(message))));
      onMessage('pvp',(value:PvpSnapshot)=>this.events.pvp?.(value));
      onMessage('pvp-result',(value:{requestId:string;error:string;rejected:boolean})=>this.events.pvpResult?.(value));
      onMessage('cabinet-play-result', (result: CabinetPlayResult) => {
        const pending = this.pendingCabinet;
        if (!pending || result.requestId !== pending.requestId || result.id !== pending.id) return;
        clearTimeout(pending.timer); this.pendingCabinet = undefined;
        if (!result.accepted && result.reason) this.events.notice(translateText(result.reason));
        pending.finish(result.accepted);
      });
      onMessage('elevator-result', (result: ElevatorResult) => {
        const pending = this.pendingElevator;
        if (!pending || result.requestId !== pending.requestId || result.target !== pending.target) return;
        if (!result.accepted) {
          if (result.reason) this.events.notice(translateText(result.reason));
          this.finishElevator(false);
        } else if (Number.isSafeInteger(result.revision)) {
          pending.revision = result.revision;
          this.confirmElevator();
        }
      });
      onMessage('unstuck-result', (result: PlayerRecoveryResult) => {
        const pending = this.pendingPlayerRecovery;
        if (!pending || result.requestId !== pending.requestId) return;
        if (!result.accepted) {
          if (result.reason) this.events.notice(translateText(result.reason));
          this.finishPlayerRecovery(false);
        } else if (Number.isSafeInteger(result.revision)) {
          pending.revision = result.revision;
          this.confirmPlayerRecovery();
        }
      });
      onMessage('activities', (message:ActivitiesMessage) => {
        // Patches received before the initial snapshot cannot establish a baseline.
        if('patch' in message&&!this.activities)return;
        this.activities=this.activities?mergeActivities(this.activities,message):message as ActivitiesState;
        this.events.activities(this.activities);
      });
      onMessage('piano-note', (note:PianoNote) => {
        // A snapshot can include a short note that never reaches the batched activities patch.
        if(this.activities){
          const next=mergePianoNote(this.activities,note);
          if(next!==this.activities){this.activities=next;this.events.activities(next);}
        }
        this.events.note(note);
      });
      room.onStateChange(state => {
        if (!current()) return;
        this.events.npcTime(state.serverNow, state.guestsAt);
        const players: PlayerView[] = [];
        const serverNow = state.serverNow || Date.now(), localNow = Date.now();
        state.players?.forEach((p, id) => players.push({ id, level: p.level, security: p.security, hall: p.hall as PlayerView['hall'], hallRevision: p.hallRevision, name: p.name, x: p.x, y: p.y, skin: p.skin, appearance: p.appearance, facing: p.facing as PlayerView['facing'], moving: p.moving, connected: p.connected, playing: p.playing, cabinet: p.cabinet, gameReaction: p.gameReaction, gameReactionUntil: p.gameReactionUntil > serverNow ? localNow + p.gameReactionUntil - serverNow : 0, activity: p.activity, ears: p.ears, seat: p.seat, action: p.action as PlayerView['action'], drink: p.drink, actionUntil: p.actionUntil, soberAt: p.soberAt > serverNow ? localNow + p.soberAt - serverNow : 0, inputSeq: p.inputSeq, stairStep:p.stairStep ?? 0,stairDirection:p.stairDirection ?? 1 }));
        const self=players.find(p=>p.id===room.sessionId);
        this.revision=self?.hallRevision??0;this.hall=self?.hall;
        const guards: GuardView[] = []; state.guards?.forEach(g => guards.push({hall:g.hall as GuardView['hall'],x:g.x,y:g.y,facing:g.facing,phase:g.phase,target:g.target,progress:g.progress,speech:g.speech,routine:g.routine,reply:g.reply}));
        this.events.guards(guards);
        this.events.players(players, room.sessionId);
        this.confirmElevator();
        this.confirmPlayerRecovery();
        const guests:AmbientGuestView[]=[];
        state.guests?.forEach(guest=>guests.push({id:guest.id,name:guest.name,hall:guest.hall as AmbientGuestView['hall'],x:guest.x,y:guest.y,skin:guest.skin,facing:guest.facing as AmbientGuestView['facing'],moving:guest.moving,mood:guest.mood as AmbientGuestView['mood'],drink:guest.drink,seat:guest.seat,destination:guest.destination}));
        this.events.guests(guests);
        if (state.cat) this.events.cat?.({ hall: state.cat.hall as CatView['hall'], x: state.cat.x, y: state.cat.y, facing: state.cat.facing as CatView['facing'], mood: state.cat.mood as CatView['mood'], moving: state.cat.moving, onPillow: state.cat.onPillow, onBar: state.cat.onBar, carriedBy: state.cat.carriedBy, targetId: state.cat.targetId, progress: state.cat.progress, hugCooldown:state.cat.hugCooldown, surfaceId:state.cat.surfaceId, jumpingDown:state.cat.jumpingDown });
        if (state.mira) this.events.mira({ x: state.mira.x, y: state.mira.y, facing: state.mira.facing as MiraView['facing'], action: state.mira.action as MiraView['action'], progress: state.mira.progress });
      });
      room.onDrop(() => { if (current()) this.setStatus('reconnecting'); });
      room.onReconnect(() => { if (!current()) return; queueMicrotask(() => { if (current()) rememberSession(room, accountId); }); this.events.npcTime(0,0);this.activities=undefined; this.setStatus('connected'); room.send('stop'); room.send('history'); room.send('activities'); });
      room.onLeave(code => {
        if (!current()) return;
        this.lastCloseCode = code;
        if (code === 4000 || banUntil > Date.now()) forgetSession(accountId, room.roomId, room.reconnectionToken);
        // The SDK also uses 4003 when reconnection fails. Only a server sanction supplies a ban deadline.
        if (code === 4003 && banUntil > Date.now()) this.events.ejected(banUntil);
        this.room = undefined;
        if (!denied && banUntil <= Date.now() && [1001, 1006, 4001, 4003].includes(code)) {
          this.recoverRoom(room.roomId, accountId);
        } else this.setStatus('disconnected');
      });
      room.onError((code, message) => {
        if (!current()) return;
        if (code === 401 || code === 403) denied = true;
        if (this.status !== 'reconnecting' || denied) this.events.notice(translateText(message || translateText('Ошибка подключения к залу.')));
      });
      if (recovered) { room.send('stop'); if (!recovering) room.send('playing', false); }
      this.events.joined(room.roomId, room.sessionId, recovering);
      this.setStatus('connected');
      room.send('history');
      room.send('activities');
    } catch (error) {
      if (generation !== this.generation) return;
      if (!recovering) this.setStatus('disconnected');
      throw error;
    }
  }
  private recoverRoom(roomId: string, accountId: string | undefined) {
    const generation = ++this.generation, deadline = Date.now() + LOBBY_RECOVERY_WINDOW_MS;
    this.setStatus('reconnecting');
    const recovery = (async () => {
      while (generation === this.generation && Date.now() < deadline) {
        try {
          this.recoveryAttempts++;
          await this.joinRoom(roomId, true, accountId, generation, true);
          return;
        } catch (error) {
          if (generation !== this.generation) return;
          const code = (error as { code?: unknown })?.code;
          if (code === 401 || code === 403) {
            this.events.notice(translateText(error instanceof Error ? error.message : 'Ошибка подключения к залу.'));
            break;
          }
        }
        await new Promise<void>(resolve => {
          const cancel = () => { this.recoveryWait = undefined; resolve(); };
          const timer = setTimeout(cancel, Math.min(1000 + Math.random() * 2000, Math.max(0, deadline - Date.now())));
          this.recoveryWait = { timer, cancel };
        });
      }
      if (generation === this.generation) this.setStatus('disconnected');
    })().finally(() => { if (this.recovery === recovery) this.recovery = undefined; });
    this.recovery = recovery;
  }
  private setStatus(status: ConnectionStatus) {
    this.status = status;
    if (status !== 'connected') this.finishElevator(false);
    if (status !== 'connected') this.finishPlayerRecovery(false);
    if (status !== 'connected' && this.pendingCabinet) {
      this.releaseCabinetWhenConnected = true;
      const pending = this.pendingCabinet; this.pendingCabinet = undefined;
      clearTimeout(pending.timer); pending.finish(false);
    }
    if (status === 'connected' && this.releaseCabinetWhenConnected) this.releaseCabinet();
    this.events.status(status);
  }
  releaseCabinet() {
    this.releaseCabinetWhenConnected = this.status !== 'connected';
    if (!this.releaseCabinetWhenConnected) this.room?.send('playing', false);
  }
  private finishPlayerRecovery(accepted: boolean) {
    const pending = this.pendingPlayerRecovery;
    if (!pending) return;
    this.pendingPlayerRecovery = undefined; clearTimeout(pending.timer); pending.finish(accepted);
  }
  private confirmPlayerRecovery() {
    const pending = this.pendingPlayerRecovery;
    if (pending?.revision !== undefined && this.hall === pending.hall && this.revision >= pending.revision) this.finishPlayerRecovery(true);
  }
  recoverPlayer(): Promise<boolean> {
    if (this.status !== 'connected' || !this.room || this.pendingPlayerRecovery) return Promise.resolve(false);
    return new Promise(resolve => {
      const requestId = ++this.recoveryRequest;
      const timer = setTimeout(() => this.finishPlayerRecovery(false), 8000);
      this.pendingPlayerRecovery = { requestId, hall: this.hall, finish: resolve, timer };
      this.send('unstuck', { requestId, revision: this.revision });
    });
  }
  claimCabinet(id: string): Promise<boolean> {
    if (this.status !== 'connected' || !this.room || this.pendingCabinet) return Promise.resolve(false);
    return new Promise(resolve => {
      const requestId = ++this.cabinetRequest;
      const timer = setTimeout(() => {
        this.pendingCabinet = undefined;
        this.releaseCabinet();
        this.events.notice(translateText('Не удалось подтвердить место у игры. Попробуй ещё раз.'));
        resolve(false);
      }, 8000);
      this.pendingCabinet = { id, requestId, finish: resolve, timer };
      this.send('cabinet-play', { id, requestId });
    });
  }
  private finishElevator(accepted: boolean) {
    const pending = this.pendingElevator;
    if (!pending) return;
    this.pendingElevator = undefined;clearTimeout(pending.timer);pending.finish(accepted);
  }
  private confirmElevator() {
    const pending = this.pendingElevator;
    if (pending?.revision !== undefined && this.hall === pending.target && this.revision >= pending.revision) this.finishElevator(true);
  }
  travelByElevator(target: HallId): Promise<boolean> {
    if (this.status !== 'connected' || !this.room || this.pendingElevator) return Promise.resolve(false);
    return new Promise(resolve => {
      const requestId = ++this.elevatorRequest;
      const timer = setTimeout(() => {
        this.events.notice(translateText('Не удалось подтвердить поездку. Проверь подключение и попробуй ещё раз.'));
        this.finishElevator(false);
      }, 8000);
      this.pendingElevator = { target, requestId, finish: resolve, timer };
      this.send('elevator', { target, requestId, revision: this.revision });
    });
  }
  send(type: string, data?: unknown): boolean {
    if (this.status !== 'connected' || !this.room) return false;
    this.room.send(type, type==='inputs'?{revision:this.revision,inputs:data}:type==='target'||type==='move'||type==='stair-window'?{...data as object,revision:this.revision}:data);
    return true;
  }
  sendChat(request: ChatRequest): boolean { return this.send('chat', request); }
  getState() { return { status: this.status, roomId: this.room?.roomId, selfId: this.room?.sessionId, lastCloseCode: this.lastCloseCode, recoveryAttempts: this.recoveryAttempts }; }
  leave() {
    this.generation++;
    this.joining = undefined;
    this.recovery = undefined;
    if (this.recoveryWait) { clearTimeout(this.recoveryWait.timer); this.recoveryWait.cancel(); }
    forgetSession();
    const room = this.room; this.room = undefined;
    this.setStatus('disconnected');
    void room?.leave();
  }
}
