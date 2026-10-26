import type { GuardView, SecurityDecision } from '../shared/security';
import type { MiraView } from '../shared/miraRoutine';
import type { AmbientGuestView } from '../shared/ambientGuests';
import { Client, ErrorCode, type Room } from '@colyseus/sdk';
import type { LobbyState } from '../../server/state';
import type { PlayerView, ChatMessage } from '../shared/world';
import { mergeActivities, mergePianoNote, type ActivitiesMessage, type ActivitiesState, type PianoNote } from '../shared/activities';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export class LobbyClient {
  private client = new Client(import.meta.env.VITE_SERVER_URL || `${location.origin}${import.meta.env.DEV ? '/multiplayer' : ''}`);
  private room?: Room<LobbyState>;
  private revision=0;
  private activities?:ActivitiesState;
  status: ConnectionStatus = 'disconnected';
  constructor(private events: {
    guards: (guards: GuardView[]) => void;
    guests: (guests: AmbientGuestView[]) => void;
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
  }) {}
  async join(roomId?: string, returningToRoom = false) {
    this.activities=undefined;
    this.setStatus('connecting');
    try {
      try {
        this.room = roomId ? await this.client.joinById<LobbyState>(roomId, {activityProtocol:1}) : await this.client.joinOrCreate<LobbyState>('lobby', {activityProtocol:1});
      } catch (error) {
        // Empty rooms can disappear while this tab reloads. Explicit invitations still show an error.
        if (!returningToRoom || (error as { code?: number }).code !== ErrorCode.MATCHMAKE_INVALID_ROOM_ID) throw error;
        this.room = await this.client.joinOrCreate<LobbyState>('lobby', {activityProtocol:1});
      }
      const room = this.room;
      // Recover even when the connection drops just after entering the room.
      room.reconnection.minUptime = 0;
      let banUntil = 0;
      room.onMessage('security', (decision: SecurityDecision) => { if(decision.kind === 'ejecting') banUntil = decision.until; this.events.security(decision); });
      room.onMessage('ejected', (value: {until: number}) => { banUntil = value.until; this.events.ejected(value.until); });
      room.onMessage('chat-check', value => this.events.checking(Boolean(value)));
      room.onMessage('chat', message => this.events.chat(message as ChatMessage));
      room.onMessage('history', messages => this.events.history(messages as ChatMessage[]));
      room.onMessage('notice', message => this.events.notice(String(message)));
      room.onMessage('activities', (message:ActivitiesMessage) => {
        // Patches received before the initial snapshot cannot establish a baseline.
        if('patch' in message&&!this.activities)return;
        this.activities=this.activities?mergeActivities(this.activities,message):message as ActivitiesState;
        this.events.activities(this.activities);
      });
      room.onMessage('piano-note', (note:PianoNote) => {
        // A snapshot can include a short note that never reaches the batched activities patch.
        if(this.activities){
          const next=mergePianoNote(this.activities,note);
          if(next!==this.activities){this.activities=next;this.events.activities(next);}
        }
        this.events.note(note);
      });
      room.onStateChange(state => {
        const players: PlayerView[] = [];
        const serverNow = state.serverNow || Date.now(), localNow = Date.now();
        state.players?.forEach((p, id) => players.push({ id, security: p.security, hall: p.hall as PlayerView['hall'], hallRevision: p.hallRevision, name: p.name, x: p.x, y: p.y, skin: p.skin, appearance: p.appearance, facing: p.facing as PlayerView['facing'], moving: p.moving, connected: p.connected, playing: p.playing, activity: p.activity, ears: p.ears, seat: p.seat, action: p.action as PlayerView['action'], drink: p.drink, actionUntil: p.actionUntil, soberAt: p.soberAt > serverNow ? localNow + p.soberAt - serverNow : 0, inputSeq: p.inputSeq }));
        this.revision=players.find(p=>p.id===room.sessionId)?.hallRevision??0;
        const guards: GuardView[] = []; state.guards?.forEach(g => guards.push({hall:g.hall as GuardView['hall'],x:g.x,y:g.y,facing:g.facing,phase:g.phase,target:g.target,progress:g.progress,speech:g.speech,routine:g.routine,reply:g.reply}));
        this.events.guards(guards);
        this.events.players(players, room.sessionId);
        const guests:AmbientGuestView[]=[];
        state.guests?.forEach(guest=>guests.push({id:guest.id,name:guest.name,hall:guest.hall as AmbientGuestView['hall'],x:guest.x,y:guest.y,skin:guest.skin,facing:guest.facing as AmbientGuestView['facing'],moving:guest.moving,mood:guest.mood as AmbientGuestView['mood'],drink:guest.drink,seat:guest.seat,destination:guest.destination}));
        this.events.guests(guests);
        if (state.mira) this.events.mira({ x: state.mira.x, y: state.mira.y, facing: state.mira.facing as MiraView['facing'], action: state.mira.action as MiraView['action'], progress: state.mira.progress });
      });
      room.onDrop(() => this.setStatus('reconnecting'));
      room.onReconnect(() => { this.activities=undefined; this.setStatus('connected'); room.send('stop'); room.send('history'); room.send('activities'); });
      room.onLeave(code => { if(code===4003) this.events.ejected(banUntil || Date.now()+600000); if (this.room === room) { this.room = undefined; this.setStatus('disconnected'); } });
      room.onError((_code, message) => this.events.notice(message || 'Ошибка подключения к залу.'));
      this.events.joined(room.roomId, room.sessionId);
      this.setStatus('connected');
      room.send('history');
      room.send('activities');
    } catch (error) {
      this.setStatus('disconnected');
      throw error;
    }
  }
  private setStatus(status: ConnectionStatus) { this.status = status; this.events.status(status); }
  send(type: string, data?: unknown) { if (this.status === 'connected') this.room?.send(type, type==='inputs'?{revision:this.revision,inputs:data}:type==='target'||type==='move'?{...data as object,revision:this.revision}:data); }
  getState() { return { status: this.status, roomId: this.room?.roomId, selfId: this.room?.sessionId }; }
  leave() { this.room?.leave(); }
}
