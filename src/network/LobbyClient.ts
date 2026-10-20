import type { GuardView, SecurityDecision } from '../shared/security';
import type { MiraView } from '../shared/miraRoutine';
import type { AmbientGuestView } from '../shared/ambientGuests';
import type { CatView } from '../shared/cat';
import { Client, ErrorCode, type Room } from '@colyseus/sdk';
import type { LobbyState } from '../../server/state';
import type { PlayerView, ChatMessage } from '../shared/world';
import { mergeActivities, mergePianoNote, type ActivitiesMessage, type ActivitiesState, type PianoNote } from '../shared/activities';
import { configureReconnection, matchmakingError } from './reconnection';
import { RoomClock } from './RoomClock';
import { savedSession, rememberSession, forgetSession } from './sessionRecovery';
import type { CabinetPlayResult } from '../shared/cabinetSeating';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export class LobbyClient {
  private client = new Client(import.meta.env.VITE_SERVER_URL || `${location.origin}${import.meta.env.DEV ? '/multiplayer' : ''}`);
  private room?: Room<LobbyState>;
  private revision=0;
  private joining?: Promise<void>;
  private generation = 0;
  private activities?:ActivitiesState;
  private cabinetRequest = 0;
  private releaseCabinetWhenConnected = false;
  private pendingCabinet?: { id: string; requestId: number; finish: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> };
  status: ConnectionStatus = 'disconnected';
  constructor(private events: {
    guards: (guards: GuardView[]) => void;
    guests: (guests: AmbientGuestView[]) => void;
    cat?: (cat: CatView) => void;
    mira: (mira: MiraView) => void;
    security: (decision: SecurityDecision) => void;
    ejected: (until: number) => void;
    checking: (value: boolean) => void;
    status: (status: ConnectionStatus) => void;
    joined: (roomId: string, sessionId: string) => void;
    players: (players: PlayerView[], selfId: string) => void;
    chat: (message: ChatMessage) => void;
    history: (messages: ChatMessage[]) => void;
    notice: (message: string) => void;
    activities: (state: ActivitiesState) => void;
    note: (note: PianoNote) => void;
    target?: (point: { x: number; y: number } | null) => void;
  }) {}
  join(roomId?: string, returningToRoom = false, accountId?: string): Promise<void> {
    if (this.joining) return this.joining;
    if (this.room) return Promise.resolve();
    const generation = ++this.generation;
    const joining = this.joinRoom(roomId, returningToRoom, accountId, generation).finally(() => {
      if (this.joining === joining) this.joining = undefined;
    });
    this.joining = joining;
    return joining;
  }
  private async joinRoom(roomId: string | undefined, returningToRoom: boolean, accountId: string | undefined, generation: number) {
    this.releaseCabinetWhenConnected = false;
    this.activities=undefined;
    this.setStatus('connecting');
    try {
      let room: Room<LobbyState> | undefined;
      const token = returningToRoom ? savedSession(accountId, roomId) : undefined;
      if (token) {
        try { room = await this.client.reconnect<LobbyState>(token); }
        catch (error) {
          if (generation !== this.generation) return;
          const code = (error as { code?: number }).code;
          // Only an expired reservation permits a fresh entry.
          if (code !== ErrorCode.MATCHMAKE_INVALID_ROOM_ID && code !== ErrorCode.MATCHMAKE_EXPIRED) throw error;
          forgetSession();
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
      const clock = new RoomClock();
      configureReconnection(room.reconnection);
      let banUntil = 0;
      onMessage('security', (decision: SecurityDecision) => { if(decision.kind === 'ejecting') banUntil = decision.until; this.events.security(decision); });
      onMessage('ejected', (value: {until: number}) => { banUntil = value.until; this.events.ejected(value.until); });
      onMessage('chat-check', value => this.events.checking(Boolean(value)));
      onMessage('chat', message => this.events.chat(message as ChatMessage));
      onMessage('history', messages => this.events.history(messages as ChatMessage[]));
      onMessage('notice', message => this.events.notice(String(message)));
      onMessage('cabinet-play-result', (result: CabinetPlayResult) => {
        const pending = this.pendingCabinet;
        if (!pending || result.requestId !== pending.requestId || result.id !== pending.id) return;
        clearTimeout(pending.timer); this.pendingCabinet = undefined;
        if (!result.accepted && result.reason) this.events.notice(result.reason);
        pending.finish(result.accepted);
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
      room.onMessage('walk-target', (data: { target: { x: number; y: number } | null; revision: number }) => {
        if (current() && data.revision === this.revision) this.events.target?.(data.target);
      });
      room.onStateChange(state => {
        if (!current()) return;
        const players: PlayerView[] = [];
        const { serverNow, localNow } = clock.snapshot(state.serverNow);
        state.players?.forEach((p, id) => players.push({ id, security: p.security, hall: p.hall as PlayerView['hall'], hallRevision: p.hallRevision, name: p.name, x: p.x, y: p.y, skin: p.skin, appearance: p.appearance, facing: p.facing as PlayerView['facing'], moving: p.moving, connected: p.connected, playing: p.playing, cabinet: p.cabinet, gameReaction: p.gameReaction, gameReactionUntil: p.gameReactionUntil > serverNow ? localNow + p.gameReactionUntil - serverNow : 0, activity: p.activity, ears: p.ears, seat: p.seat, action: p.action as PlayerView['action'], drink: p.drink, actionUntil: p.actionUntil, soberAt: p.soberAt > serverNow ? localNow + p.soberAt - serverNow : 0, controlLayout: p.controlLayout, inputSeq: p.inputSeq }));
        this.revision=players.find(p=>p.id===room.sessionId)?.hallRevision??0;
        const guards: GuardView[] = []; state.guards?.forEach(g => guards.push({hall:g.hall as GuardView['hall'],x:g.x,y:g.y,facing:g.facing,phase:g.phase,target:g.target,progress:g.progress,speech:g.speech,routine:g.routine,reply:g.reply}));
        this.events.guards(guards);
        this.events.players(players, room.sessionId);
        const guests:AmbientGuestView[]=[];
        state.guests?.forEach(guest=>guests.push({id:guest.id,name:guest.name,hall:guest.hall as AmbientGuestView['hall'],x:guest.x,y:guest.y,skin:guest.skin,facing:guest.facing as AmbientGuestView['facing'],moving:guest.moving,mood:guest.mood as AmbientGuestView['mood'],drink:guest.drink,seat:guest.seat,destination:guest.destination}));
        this.events.guests(guests);
        if (state.cat) this.events.cat?.({ hall: state.cat.hall as CatView['hall'], x: state.cat.x, y: state.cat.y, facing: state.cat.facing as CatView['facing'], mood: state.cat.mood as CatView['mood'], moving: state.cat.moving, onPillow: state.cat.onPillow, onBar: state.cat.onBar, carriedBy: state.cat.carriedBy, targetId: state.cat.targetId, progress: state.cat.progress, hugCooldown:state.cat.hugCooldown, surfaceId:state.cat.surfaceId, jumpingDown:state.cat.jumpingDown });
        if (state.mira) this.events.mira({ x: state.mira.x, y: state.mira.y, facing: state.mira.facing as MiraView['facing'], action: state.mira.action as MiraView['action'], progress: state.mira.progress });
      });
      room.onDrop(() => { if (current()) this.setStatus('reconnecting'); });
      room.onReconnect(() => { if (!current()) return; queueMicrotask(() => { if (current()) rememberSession(room, accountId); }); clock.reset(); this.activities=undefined; this.setStatus('connected'); room.send('stop'); room.send('history'); room.send('activities'); });
      room.onLeave(code => { if (!current()) return; forgetSession(); if(code===4003) this.events.ejected(banUntil || Date.now()+600000); if (this.room === room) { this.room = undefined; this.setStatus('disconnected'); } });
      room.onError((_code, message) => { if (current()) this.events.notice(message || 'Ошибка подключения к залу.'); });
      if (recovered) { room.send('stop'); room.send('playing', false); }
      this.events.joined(room.roomId, room.sessionId);
      this.setStatus('connected');
      room.send('history');
      room.send('activities');
    } catch (error) {
      if (generation !== this.generation) return;
      this.setStatus('disconnected');
      throw matchmakingError(error);
    }
  }
  private setStatus(status: ConnectionStatus) {
    this.status = status;
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
  claimCabinet(id: string): Promise<boolean> {
    if (this.status !== 'connected' || !this.room || this.pendingCabinet) return Promise.resolve(false);
    return new Promise(resolve => {
      const requestId = ++this.cabinetRequest;
      const timer = setTimeout(() => {
        this.pendingCabinet = undefined;
        this.releaseCabinet();
        this.events.notice('Не удалось подтвердить место у игры. Попробуй ещё раз.');
        resolve(false);
      }, 8000);
      this.pendingCabinet = { id, requestId, finish: resolve, timer };
      this.send('cabinet-play', { id, requestId });
    });
  }
  send(type: string, data?: unknown) { if (this.status === 'connected') this.room?.send(type, type==='inputs'?{revision:this.revision,inputs:data}:type==='target'||type==='move'?{...data as object,revision:this.revision}:data); }
  getState() { return { status: this.status, roomId: this.room?.roomId, selfId: this.room?.sessionId }; }
  leave() {
    this.generation++;
    this.joining = undefined;
    forgetSession();
    const room = this.room; this.room = undefined;
    this.setStatus('disconnected');
    void room?.leave();
  }
}
