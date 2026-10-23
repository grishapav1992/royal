import { serializeAppearance } from '../src/shared/appearance';
import type { CharacterAppearance } from '../src/shared/skinStudio';
import { Room, type Client, type AuthContext, ServerError } from '@colyseus/core';
import { Guards } from './guards';
import { Bartender } from './bartender';
import { AmbientGuests } from './ambientGuests';
import { RoomCat } from './cat';
import { chatModerator } from './moderation';
import { chatSpam } from './chatSpam';
import { chatQueue } from './chatQueue';
import { guardBumps } from './guardBumps';
import { blockedByGuard } from '../src/shared/guardCollision';
import type { SecurityDecision } from '../src/shared/security';
import type { ChatResult } from '../src/shared/chat';
import { randomUUID } from 'node:crypto';
import { accounts, allowedOrigin, cookieToken, type Account } from './accounts';
type RoomAuth = { account: Account; hash: string };
import { LobbyState, Player } from './state';
import { movementFacing, type Facing } from '../src/shared/movement';
import { MovementInputs } from './movementInputs';
import { Activities } from './activities';
import { PvpRoom } from './pvp/room';
import { cabinetHall, cabinetsInHall, type Cabinet } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { findPath, walkable, type Point } from '../src/game/navigation';
import { PLAYER_SPEED, PLAYER_SPRINT_SPEED, ROOM_CAPACITY, hallObstacles, hallLinkAt, inHallDoor, SEATS, DRINKS, atBar, type ChatMessage, type HallId } from '../src/shared/world';
import { intoxicatedMovement } from '../src/shared/intoxication';
import type { DrinkingState } from './intoxicationStore';

type Control = { dx: number; dy: number; at: number; path: Point[]; lastTarget: number; chatRevision: number; inputs: MovementInputs; predicted: boolean; afterMovement?: () => void };
const CHAT_REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type ProfileRevision = { name: number; skin: number; appearance: number };
type Access = { active: boolean; banUntil: number; drinking: DrinkingState; revision: number; profileRevision: ProfileRevision; pendingDrink: boolean; pendingEject: boolean };
const pendingDrinks = new Set<string>();
const CABINET_REACTION_MS = 2400;
const CABINET_REACTION_INTERVAL_MS = 450;
const CABINET_PLAY_DISTANCE = 90;
export class LobbyRoom extends Room<{ state: LobbyState }> {
  state = new LobbyState();
  maxClients = ROOM_CAPACITY;
  maxMessagesPerSecond = 80;
  private activities = new Activities(id => this.state.players.get(id), id => this.stop(id), (type,value,hall) => this.broadcastActivity(type,value,hall), (id,text) => this.clients.find(c=>c.sessionId===id)?.send('notice',text));
  private pvp=new PvpRoom({roomId:()=>this.roomId,activities:this.activities,
    people:()=>[...this.state.players].flatMap(([sessionId,p])=>{const accountId=this.playerAccounts.get(sessionId);return accountId?[{sessionId,accountId,name:p.name,hall:p.hall,x:p.x,y:p.y,connected:p.connected,available:!p.playing&&!p.activity&&!p.seat&&p.action!=='drink'}]:[];}),
    send:(id,type,value)=>this.clients.find(c=>c.sessionId===id)?.send(type,value)});
  private guards = new Guards(this.state, (id, decision) => {
    if (decision.kind !== 'ejecting') return;
    const client = this.clients.find(c => c.sessionId === id);
    client?.send('ejected', { until: decision.until });
    this.clock.setTimeout(() => client?.leave(4003), 200);
  },Math.random,id=>{
    const client=this.clients.find(c=>c.sessionId===id);if(!client)return 0;
    const account=(client.auth as RoomAuth).account.id,count=guardBumps.record(account);
    if(count>=10)void this.ejectForCollision(client);
    return count;
  });
  private securityListener = (accountId: string, decision: SecurityDecision) => {
    chatQueue.cancel(accountId);
    for (const client of this.clients) if ((client.auth as RoomAuth)?.account.id === accountId) {
      const access = this.access.get(client.sessionId);
      if (access) { access.revision++; if (decision.kind === 'ejecting') access.banUntil = decision.until; }
      const p = this.state.players.get(client.sessionId);
      if (!p || p.security === 'ejecting') continue;
      const control = this.controls.get(client.sessionId); if (control) control.chatRevision++;
      this.activities.leave(client.sessionId); this.releaseCabinet(client.sessionId); this.stop(client.sessionId); this.stand(client.sessionId); p.playing = false;
      this.guards.enqueue(client.sessionId, decision);
      client.send('security', decision);
      this.publish({ id: randomUUID(), senderId: 'security', name: 'ОХРАНА', time: Date.now(),
        text: decision.kind === 'warning' ? p.name + ', первое предупреждение за ' + (decision.reason === 'spam' ? 'спам' : 'оскорбления') + '. Повтор в течение суток: выход на 10 минут.' : p.name + (decision.reason==='collision'?', десять толчков охранника. Вход закрыт на 10 минут.':', повторное нарушение. Вход закрыт на 10 минут.') });
    }
  };
  private controls = new Map<string, Control>();
  private chatPending = new Map<Control, number>();
  private chatResults = new Map<Control, Map<string, ChatResult>>();
  private cabinetReactionAt = new Map<string, number>();
  private activityProtocols = new Set<string>();
  private access = new Map<string, Access>();
  private joiningAccounts = new Set<string>();
  private playerAccounts = new Map<string, string>();
  private refreshingAccess = false;
  private disposed = false;
  private bartender = new Bartender(this.state);
  private guests=new AmbientGuests(this.state);
  private cat=new RoomCat(this.state);
  private history: ChatMessage[] = [];
  private nextSpawn = 0;
  private logoutListener = (hash: string) => {
    for (const client of this.clients) if ((client.auth as RoomAuth)?.hash === hash) {
      const access = this.access.get(client.sessionId);
      if (access) { access.active = false; access.revision++; }
      this.cancelChat(client);
      const player = this.state.players.get(client.sessionId); if (player) player.connected = false;
      this.releaseCabinet(client.sessionId); this.stop(client.sessionId); client.leave(4001);
    }
  };
  private drinkingListener = (id: string, state: DrinkingState) => {
    for (const client of this.clients) if ((client.auth as RoomAuth)?.account.id === id) {
      const access = this.access.get(client.sessionId); if (access) { access.drinking = state; access.revision++; }
      const player = this.state.players.get(client.sessionId);
      if (player) player.soberAt = state.soberAt;
    }
  };
  private nameListener = (id: string, name: string) => {
    for (const client of this.clients) if ((client.auth as RoomAuth)?.account.id === id) {
      const access = this.access.get(client.sessionId); if (access) access.profileRevision.name++;
      (client.auth as RoomAuth).account.name = name;
      const player = this.state.players.get(client.sessionId); if (player) player.name = name;
    }
  };
  private skinListener = (id: string, skin: number) => {
    for (const client of this.clients) if ((client.auth as RoomAuth)?.account.id === id) {
      const access = this.access.get(client.sessionId); if (access) access.profileRevision.skin++;
      (client.auth as RoomAuth).account.skin = skin;
      const player = this.state.players.get(client.sessionId); if (player) player.skin = skin;
    }
  };
  private appearanceListener = (id: string, appearance: CharacterAppearance | null) => {
    for (const client of this.clients) if ((client.auth as RoomAuth)?.account.id === id) {
      const access = this.access.get(client.sessionId); if (access) access.profileRevision.appearance++;
      (client.auth as RoomAuth).account.appearance = appearance;
      const player = this.state.players.get(client.sessionId); if (player) player.appearance = serializeAppearance(appearance);
    }
  };
  onCreate() {
    this.state.serverNow = Date.now();
    accounts.events.on('security', this.securityListener);
    accounts.events.on('logout', this.logoutListener);
    accounts.events.on('name', this.nameListener);
    accounts.events.on('skin', this.skinListener);
    accounts.events.on('appearance', this.appearanceListener);
    accounts.events.on('drinking', this.drinkingListener);
    this.clock.setInterval(() => { void this.refreshAccess().catch(() => console.error('Room access refresh failed')); }, 60000);
    this.clock.setInterval(()=>this.pvp.tick(),1000);
    this.setPatchRate(50);
    let hallElapsed=0;
    this.setSimulationInterval(delta => {
      this.state.serverNow = Date.now();
      const dt=Math.min(delta,100)/1000;
      this.activities.tick(dt);this.guards.tick(dt);this.bartender.tick(dt);this.guests.tick(dt);this.cat.tick(dt);hallElapsed+=dt;
      while(hallElapsed>=.05){this.tick(.05);hallElapsed-=.05;}
    }, 1000/60);
    const movementActions = new Set(['move', 'target', 'stop', 'playing', 'cabinet-play', 'stand', 'sit', 'drink', 'activity', 'cat']);
    const hugBlockedActions = new Set([...movementActions,'inputs','cabinet-reaction']);
    const listen = (type: string, handler: (client: Client, value: any) => void | Promise<void>) => this.onMessage(type, (client, value) => {
      const apply = () => {
        const p = this.state.players.get(client.sessionId);
        if (!p?.connected || p.security || !this.accessAllowed(client)) return;
        if (this.cat.isHugging(client.sessionId) && hugBlockedActions.has(type) && type!=='cat' && type!=='stop') {
          if(type==='cabinet-play') {
            const request=value as {id?:unknown;requestId?:unknown};
            if(typeof request?.id==='string'&&request.id.length<=100&&Number.isSafeInteger(request.requestId)&&(request.requestId as number)>=0)
              client.send('cabinet-play-result',{id:request.id,requestId:request.requestId,accepted:false,reason:'Сначала отпусти Кошку.'});
          }
          return;
        }
        const result = handler(client, value);
        if (result) return result.catch(() => client.send('notice', 'Не удалось подтвердить действие. Попробуй ещё раз.'));
      };
      const control = this.controls.get(client.sessionId);
      // UI actions must start at the end of already accepted movement, not discard it.
      if (movementActions.has(type) && control?.inputs.pendingCount) control.afterMovement = () => { void apply(); };
      else return apply();
    });
    listen('activity', (client,value:unknown)=>this.activities.handle(client.sessionId,value));
    listen('pvp',async(client,value:unknown)=>{await this.pvp.command(client.sessionId,value);});
    listen('cat', (client, value: unknown) => {
      const message = this.cat.handle(client.sessionId, value);
      if(this.cat.isHugging(client.sessionId)) {
        this.stop(client.sessionId);
        const player=this.state.players.get(client.sessionId);if(player)player.facing='down';
      }
      if (message) client.send('notice', message);
    });
    this.onMessage('activities', client=>client.send('activities',this.activities.snapshot()));
    listen('inputs', (client, data: unknown) => {
      const p = this.state.players.get(client.sessionId), c = this.controls.get(client.sessionId);
      if (!p || !c || !p.connected || p.playing) return;
      const packet=data as {revision?:number;inputs?:unknown};
      if(!packet||packet.revision!==p.hallRevision)return;
      if (c.inputs.accept(p, packet.inputs,Date.now(),[...this.state.guards.values()],()=>this.guards.contact(client.sessionId))) {
        p.inputSeq = c.inputs.sequence;
        if (p.security) return;
        c.afterMovement = undefined;
        c.predicted = true; c.path = []; c.dx = c.dy = 0; c.at = Date.now();
        this.enterDoor(client.sessionId);
      }
    });
    listen('move', (client, data: unknown) => {
      const control = this.controls.get(client.sessionId);
      if (!control || (data as {revision?:number})?.revision!==this.state.players.get(client.sessionId)?.hallRevision || this.state.players.get(client.sessionId)?.playing || !data || typeof data !== 'object') return;
      const { x, y } = data as { x?: unknown; y?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
      this.stop(client.sessionId);
      if (x || y) this.stand(client.sessionId);
      control.predicted = false;
      control.dx = Math.max(-1, Math.min(1, x)); control.dy = Math.max(-1, Math.min(1, y));
      control.at = Date.now(); control.path = [];
    });
    listen('target', (client, data: unknown) => {
      const p = this.state.players.get(client.sessionId), control = this.controls.get(client.sessionId);
      if (!p || (data as {revision?:number})?.revision!==p.hallRevision || !control || !data || typeof data !== 'object' || p.playing || Date.now() - control.lastTarget < 150) return;
      const { x, y } = data as { x?: unknown; y?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
      this.stop(client.sessionId);
      this.stand(client.sessionId);
      control.predicted = false;
      control.lastTarget = Date.now(); control.dx = control.dy = 0;
      control.path = findPath(p, { x, y }, hallObstacles(p.hall));
    });
    listen('stop', client => this.stop(client.sessionId));
    listen('playing', (client, value: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.activity || typeof value !== 'boolean') return;
      if (value) {
        const cabinet = p.cabinet ? cabinetsInHall(p.hall).find(c => c.id === p.cabinet)
          : cabinetsInHall(p.hall).filter(c => c.playable).sort((a, b) => this.cabinetDistance(p, a) - this.cabinetDistance(p, b))[0];
        if (!cabinet) return;
        const reason = this.claimCabinet(client.sessionId, cabinet.id);
        if (reason) client.send('notice', reason);
      } else {
        this.releaseCabinet(client.sessionId); p.playing = false; this.stop(client.sessionId);
      }
    });
    listen('cabinet-play', (client, value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const { id, requestId } = value as { id?: unknown; requestId?: unknown };
      if (typeof id !== 'string' || id.length > 100 || !Number.isSafeInteger(requestId) || (requestId as number) < 0) return;
      const reason = this.claimCabinet(client.sessionId, id);
      client.send('cabinet-play-result', { id, requestId, accepted: !reason, ...(reason ? { reason } : {}) });
    });
    listen('cabinet-reaction', (client, value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const { id, reaction } = value as { id?: unknown; reaction?: unknown };
      const p = this.state.players.get(client.sessionId), now = Date.now();
      if (!p?.playing || !p.cabinet || id !== p.cabinet || (reaction !== 'win' && reaction !== 'lose')) return;
      const last = this.cabinetReactionAt.get(client.sessionId);
      if (last !== undefined && now - last < CABINET_REACTION_INTERVAL_MS) return;
      this.cabinetReactionAt.set(client.sessionId, now);
      p.gameReaction = reaction; p.gameReactionUntil = now + CABINET_REACTION_MS;
    });
    listen('stand', client => this.stand(client.sessionId));
    listen('sit', (client, id: unknown) => {
      const p = this.state.players.get(client.sessionId), seat = SEATS.find(s => s.id === id);
      if (!p || !seat || p.hall!==(seat.hall??'arcade') || p.playing || p.action === 'drink') return;
      if (Math.hypot(p.x-seat.entry.x,p.y-seat.entry.y)>60) return;
      if ([...this.state.players.values()].some(other => other !== p && other.seat === id)) { client.send('notice','Это место уже занято. Выбери соседнее.'); return; }
      this.stop(client.sessionId); p.seat = seat.id; p.action = 'sit'; p.x = seat.x; p.y = seat.y; p.facing = seat.facing;
    });
    listen('drink', async (client, id: unknown) => {
      const p = this.state.players.get(client.sessionId), control = this.controls.get(client.sessionId), access = this.access.get(client.sessionId);
      if (!p || !control || !access || access.pendingDrink || !this.canDrink(p, id)) return;
      const accountId = (client.auth as RoomAuth).account.id, chatRevision = control.chatRevision, hallRevision = p.hallRevision;
      if (pendingDrinks.has(accountId) || Date.now() < access.drinking.lastDrinkAt + 3200) return;
      pendingDrinks.add(accountId); access.pendingDrink = true;
      const valid = () => !this.cat.isHugging(client.sessionId) && this.currentAction(client, p, control, chatRevision, hallRevision) && this.canDrink(p, id);
      try {
        const active = await accounts.active((client.auth as RoomAuth).hash);
        if (!active) { this.logoutListener((client.auth as RoomAuth).hash); return; }
        if (!valid()) return;
        const current = await accounts.drinking.read(accountId);
        if (!valid() || Date.now() < current.lastDrinkAt + 3200) return;
        // Reserve the accepted sip before its persisted dose completes.
        this.stop(client.sessionId); p.action = 'drink'; p.drink = id as string; p.actionUntil = Date.now()+3200;
        if (!p.seat) p.facing = 'down';
        const drinking = await accounts.drinking.consume(accountId, id as string, Date.now());
        if (!this.currentAction(client, p, control, chatRevision, hallRevision)) return;
        access.drinking = drinking; p.soberAt = drinking.soberAt;
      } catch (error) {
        if (this.currentAction(client, p, control, chatRevision, hallRevision) && p.action === 'drink' && p.drink === id) {
          p.action = p.seat ? 'sit' : 'idle'; p.drink = ''; p.actionUntil = 0;
        }
        throw error;
      } finally { access.pendingDrink = false; pendingDrinks.delete(accountId); }
    });
    this.onMessage('chat', async (client, value: unknown) => {
      const object = value && typeof value === 'object' && !Array.isArray(value) ? value as { id?: unknown; text?: unknown } : undefined;
      const requestId = object && typeof object.id === 'string' && object.id.length === 36 && CHAT_REQUEST_ID.test(object.id) ? object.id : undefined;
      if (typeof value !== 'string' && !requestId) { client.send('notice', 'Неверный формат сообщения.'); return; }
      const player = this.state.players.get(client.sessionId), control = this.controls.get(client.sessionId);
      const records = control ? this.chatResults.get(control) ?? new Map<string, ChatResult>() : undefined;
      if (control && records) this.chatResults.set(control, records);
      const previous = requestId && records?.get(requestId);
      if (previous) { client.send('chat-result', previous); return; }
      let accepted = false, finished = false;
      const result = (status: ChatResult['status'], message?: string) => {
        if (!requestId) return;
        const value: ChatResult = { id: requestId, status, ...(message ? { message } : {}) };
        records?.set(requestId, value);
        if (records && records.size > 32) for (const [id, item] of records) {
          if (records.size <= 32) break;
          if (item.status !== 'queued') records.delete(id);
        }
        client.send('chat-result', value);
      };
      const finish = (status: Exclude<ChatResult['status'], 'queued'>, message?: string) => {
        if (finished) return;
        finished = true; result(status, message);
        if (message) client.send('notice', message);
        if (accepted && control) {
          const remaining = Math.max(0, (this.chatPending.get(control) ?? 1) - 1);
          if (remaining) this.chatPending.set(control, remaining);
          else { this.chatPending.delete(control); client.send('chat-check', false); }
        }
      };
      const raw = typeof value === 'string' ? value : object?.text;
      const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
      if (!text || text.length > 300) { finish('rejected', 'Сообщение должно содержать от 1 до 300 символов.'); return; }
      if (!player || !control || !player.connected || player.security || !this.accessAllowed(client)) {
        finish('cancelled', 'Сообщение не отправлено. Дождись подключения к залу.'); return;
      }
      const id = (client.auth as RoomAuth).account.id, chatRevision = control.chatRevision;
      // Public room chat follows the connection, independent of movement between floors.
      const current = () => !this.disposed && this.state.players.get(client.sessionId) === player
        && this.controls.get(client.sessionId) === control && control.chatRevision === chatRevision
        && player.connected && !player.security && this.accessAllowed(client);
      const spam = chatSpam.check(id, text);
      if (spam === 'spam') {
        control.chatRevision++; chatQueue.cancel(id);
        finish('rejected', 'Сообщение отклонено за спам.');
        try {
          if (!await accounts.active((client.auth as RoomAuth).hash)) { this.logoutListener((client.auth as RoomAuth).hash); return; }
          const decision = await accounts.moderation.record(id);
          accounts.events.emit('security', id, { ...decision, reason: 'spam' });
        } catch { client.send('notice', 'Не удалось подтвердить действие. Попробуй ещё раз.'); }
        return;
      }
      if (spam === 'slow') { finish('rejected', 'Слишком быстро. Продолжение спама вызовет охранника.'); return; }
      const queued = chatQueue.enqueue(id, async cancelled => {
        const valid = () => !cancelled() && current();
        let checkingProvider = false;
        try {
          if (!valid()) { finish('cancelled', 'Проверка сообщения отменена.'); return; }
          if (!await accounts.active((client.auth as RoomAuth).hash)) { this.logoutListener((client.auth as RoomAuth).hash); return; }
          if (!valid()) { finish('cancelled', 'Проверка сообщения отменена.'); return; }
          checkingProvider = true;
          const violation = await chatModerator.check(id, text);
          checkingProvider = false;
          if (!valid()) { finish('cancelled', 'Проверка сообщения отменена.'); return; }
          if (!await accounts.active((client.auth as RoomAuth).hash)) { this.logoutListener((client.auth as RoomAuth).hash); return; }
          if (!valid()) { finish('cancelled', 'Проверка сообщения отменена.'); return; }
          if (violation) {
            chatSpam.clear(id);
            control.chatRevision++;
            finish('rejected', 'Сообщение отклонено за оскорбление другого человека.');
            chatQueue.cancel(id);
            const decision = await accounts.moderation.record(id);
            accounts.events.emit('security', id, { ...decision, reason: 'insult' });
          } else if (violation === false) {
            this.publish({ id: randomUUID(), senderId: client.sessionId, name: player.name, text, time: Date.now(), ...(requestId ? { requestId } : {}) });
            finish('published');
          } else {
            finish('rejected', 'Проверка не завершена. Сообщение не отправлено. Попробуй ещё раз.');
          }
        } catch (error) {
          finish('rejected', checkingProvider && error instanceof Error ? error.message : 'Не удалось подтвердить сообщение. Оно не отправлено. Попробуй ещё раз.');
        } finally { if (!finished) finish('cancelled', 'Проверка сообщения отменена.'); }
      }, () => finish('cancelled', 'Проверка сообщения отменена.'), control);
      if (!queued) { finish('rejected', 'Очередь проверки заполнена. Повтори сообщение через несколько секунд.'); return; }
      accepted = true;
      this.chatPending.set(control, (this.chatPending.get(control) ?? 0) + 1);
      result('queued'); client.send('chat-check', true);
      await queued;
    });
    this.onMessage('history', client => client.send('history', this.history));
  }
  async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    if (!allowedOrigin(context.headers.get('origin') || undefined)) throw new ServerError(403, 'Недопустимый источник подключения.');
    const auth = await accounts.session(cookieToken(context.headers.get('cookie') || undefined));
    if (!auth) throw new ServerError(401, 'Сначала войди по почте и паролю.');
    const until = await accounts.moderation.banUntil(auth.account.id);
    if (until) throw new ServerError(403, 'Охрана закрыла вход за нарушение правил клуба. Осталось '+Math.ceil((until-Date.now())/60000)+' мин.');
    if (auth.account.skin === null) throw new ServerError(400, 'Сначала выбери персонажа.');
    return auth;
  }
  async onJoin(client: Client, options: unknown, auth: RoomAuth) {
    const duplicate = () => new ServerError(409, 'Этот аккаунт уже находится в зале. Закрой другую вкладку или подожди 20 секунд.');
    // Dropped clients leave this.clients before their reserved player is removed.
    if (this.joiningAccounts.has(auth.account.id) || [...this.playerAccounts.values()].includes(auth.account.id)) throw duplicate();
    this.joiningAccounts.add(auth.account.id);
    const access: Access = { active: true, banUntil: 0, drinking: { soberAt: 0, lastDrink: '', lastDrinkAt: 0 }, revision: 0, profileRevision: { name: 0, skin: 0, appearance: 0 }, pendingDrink: false, pendingEject: false };
    this.access.set(client.sessionId, access);
    try {
      const revision = access.revision, profileRevision = { ...access.profileRevision };
      const [active, until, drinking, profile] = await Promise.all([
        accounts.active(auth.hash), accounts.moderation.banUntil(auth.account.id), accounts.drinking.read(auth.account.id), accounts.currentAccount(auth.account.id),
      ]);
      if (this.disposed || this.access.get(client.sessionId) !== access || !active || !access.active) throw new ServerError(401, 'Войди в аккаунт ещё раз.');
      access.banUntil = Math.max(until, access.banUntil);
      if (access.banUntil > Date.now()) throw new ServerError(403, 'Вход временно закрыт охраной.');
      if (revision === access.revision) access.drinking = drinking;
      this.applyProfile(auth, access, profile, profileRevision);
      if (auth.account.skin === null) throw new ServerError(401, 'Выбери персонажа и войди в зал ещё раз.');
      const others = this.clients.filter(other => other !== client && (other.auth as RoomAuth)?.account.id === auth.account.id);
      const activeOthers = await Promise.all(others.map(other => accounts.active((other.auth as RoomAuth).hash)));
      if (this.disposed || this.access.get(client.sessionId) !== access || !access.active) throw new ServerError(401, 'Войди в аккаунт ещё раз.');
      if (access.banUntil > Date.now()) throw new ServerError(403, 'Вход временно закрыт охраной.');
      if (activeOthers.some(Boolean)) throw duplicate();
      const p = new Player(); p.name = auth.account.name; p.soberAt = access.drinking.soberAt;
      const index = this.nextSpawn++;
      p.x = 420 + index % 8 * 40; p.y = 570 + Math.floor(index % 24 / 8) * 25; p.skin = auth.account.skin!; p.appearance = serializeAppearance(auth.account.appearance);
      this.playerAccounts.set(client.sessionId, auth.account.id);
      this.state.players.set(client.sessionId, p);
      this.controls.set(client.sessionId, { dx: 0, dy: 0, at: 0, path: [], lastTarget: 0, chatRevision: 0, inputs: new MovementInputs(), predicted: false });
      if((options as {activityProtocol?:unknown}|null)?.activityProtocol===1)this.activityProtocols.add(client.sessionId);
      this.system(p.name+' заходит в зал');
    } catch (error) { if (this.access.get(client.sessionId) === access) this.access.delete(client.sessionId); throw error; }
    finally { this.joiningAccounts.delete(auth.account.id); }
  }
  onDrop(client: Client) {
    this.cancelChat(client);
    this.activities.leave(client.sessionId);
    this.stop(client.sessionId);
    const control = this.controls.get(client.sessionId); if (control) control.chatRevision++;
    const p = this.state.players.get(client.sessionId); if (p) p.connected = false;
    if (!p || !this.accessAllowed(client)) return;
    // Refused joins, expired reservations and shutdown must not reject outside the room lifecycle.
    void this.allowReconnection(client, this.pvp.locked(client.sessionId)?60:20).catch(() => {});
  }
  onDispose() {
    this.pvp.stop();
    for (const client of this.clients) this.cancelChat(client);
    this.chatPending.clear(); this.chatResults.clear();
    for (const id of this.state.players.keys()) this.releaseCabinet(id);
    this.disposed = true;
    accounts.events.off('security', this.securityListener); accounts.events.off('logout', this.logoutListener);
    accounts.events.off('name', this.nameListener); accounts.events.off('skin', this.skinListener); accounts.events.off('appearance', this.appearanceListener); accounts.events.off('drinking', this.drinkingListener);
  }
  async onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId), access = this.access.get(client.sessionId);
    if (!p || !access) { client.leave(4001); return; }
    const auth = client.auth as RoomAuth;
    try {
      const revision = access.revision, profileRevision = { ...access.profileRevision };
      const [active, until, drinking, profile] = await Promise.all([
        accounts.active(auth.hash), accounts.moderation.banUntil(auth.account.id), accounts.drinking.read(auth.account.id), accounts.currentAccount(auth.account.id),
      ]);
      if (this.disposed || this.access.get(client.sessionId) !== access || this.state.players.get(client.sessionId) !== p || !active || !access.active) { client.leave(4001); return; }
      access.banUntil = Math.max(until, access.banUntil);
      if (access.banUntil > Date.now()) { client.leave(4003); return; }
      if (revision === access.revision) { access.drinking = drinking; p.soberAt = drinking.soberAt; }
      this.applyProfile(auth, access, profile, profileRevision);
      if (auth.account.skin === null) { client.leave(4001); return; }
      p.name = auth.account.name; p.skin = auth.account.skin; p.appearance = serializeAppearance(auth.account.appearance);
      p.connected = true;
      const control = this.controls.get(client.sessionId);
      client.send('chat-check', Boolean(control && this.chatPending.get(control)));
      if (control) for (const result of this.chatResults.get(control)?.values() ?? []) if (result.status !== 'queued') client.send('chat-result', result);
    } catch { client.leave(4001); }
  }
  private applyProfile(auth: RoomAuth, access: Access, profile: Account | undefined, captured: ProfileRevision) {
    if (!profile) throw new ServerError(401, 'Войди в аккаунт ещё раз.');
    auth.account = { ...profile,
      name: captured.name === access.profileRevision.name ? profile.name : auth.account.name,
      skin: captured.skin === access.profileRevision.skin ? profile.skin : auth.account.skin,
      appearance: captured.appearance === access.profileRevision.appearance ? profile.appearance : auth.account.appearance,
    };
  }
  onLeave(client: Client) {
    this.cancelChat(client);
    const chatControl = this.controls.get(client.sessionId);
    if (chatControl) { this.chatPending.delete(chatControl); this.chatResults.delete(chatControl); }
    this.playerAccounts.delete(client.sessionId);
    this.activities.leave(client.sessionId);
    this.releaseCabinet(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId); this.controls.delete(client.sessionId); this.access.delete(client.sessionId);this.activityProtocols.delete(client.sessionId);
    if (p) this.system(p.name+' покидает зал');
  }
  private cancelChat(client: Client) {
    const control = this.controls.get(client.sessionId), account = (client.auth as RoomAuth)?.account.id;
    if (control && account) chatQueue.cancel(account, control);
  }
  private accessAllowed(client: Client, allowPendingEject = false) {
    const access = this.access.get(client.sessionId);
    return !!access?.active && access.banUntil <= Date.now() && (allowPendingEject || !access.pendingEject);
  }
  private currentAction(client: Client, player: Player, control: Control, chatRevision: number, hallRevision: number, allowPendingEject = false) {
    return !this.disposed && this.state.players.get(client.sessionId) === player && this.controls.get(client.sessionId) === control
      && control.chatRevision === chatRevision && player.hallRevision === hallRevision && player.connected && !player.security && this.accessAllowed(client, allowPendingEject);
  }
  private canDrink(player: Player, id: unknown) {
    return player.hall === 'arcade' && atBar(player) && !player.playing && player.action !== 'drink' && DRINKS.some(drink => drink.id === id);
  }
  private async ejectForCollision(client: Client) {
    const player = this.state.players.get(client.sessionId), control = this.controls.get(client.sessionId), access = this.access.get(client.sessionId);
    if (!player || !control || !access || access.pendingEject || !this.accessAllowed(client)) return;
    const accountId = (client.auth as RoomAuth).account.id, chatRevision = control.chatRevision, hallRevision = player.hallRevision;
    access.pendingEject = true; this.stop(client.sessionId);
    try {
      const active = await accounts.active((client.auth as RoomAuth).hash);
      if (!active) { this.logoutListener((client.auth as RoomAuth).hash); return; }
      if (!this.currentAction(client, player, control, chatRevision, hallRevision, true)) return;
      const decision = await accounts.moderation.eject(accountId);
      if (this.currentAction(client, player, control, chatRevision, hallRevision, true)) this.stop(client.sessionId);
      accounts.events.emit('security', accountId, decision);
    } catch { if (this.state.players.get(client.sessionId) === player) client.send('notice', 'Охрана проверяет нарушение. Подожди немного.'); }
    finally { access.pendingEject = false; }
  }
  private async refreshAccess() {
    if (this.refreshingAccess || this.disposed) return;
    this.refreshingAccess = true;
    try {
      await Promise.all(this.clients.map(async client => {
        const access = this.access.get(client.sessionId), player = this.state.players.get(client.sessionId);
        if (!access || !player) return;
        const revision = access.revision, auth = client.auth as RoomAuth;
        const [active, until, drinking] = await Promise.all([accounts.active(auth.hash), accounts.moderation.banUntil(auth.account.id), accounts.drinking.read(auth.account.id)]);
        if (this.disposed || this.access.get(client.sessionId) !== access || this.state.players.get(client.sessionId) !== player || access.revision !== revision) return;
        access.active = active; access.banUntil = until; access.drinking = drinking; player.soberAt = drinking.soberAt;
        if (!active || until > Date.now()) { player.connected = false; this.releaseCabinet(client.sessionId); this.stop(client.sessionId); client.leave(active ? 4003 : 4001); }
      }));
    } finally { this.refreshingAccess = false; }
  }
  private system(text: string) { this.publish({ id: randomUUID(), senderId: '', name: '', text, time: Date.now(), system: true }); }
  private publish(message: ChatMessage) { this.history.push(message); if (this.history.length > 60) this.history.shift(); this.broadcast('chat', message); }
  private stop(id: string) {
    const c = this.controls.get(id); if (c) { c.dx = c.dy = 0; c.path = []; c.predicted = false; c.afterMovement = undefined; c.inputs.cancel(); }
    const p = this.state.players.get(id); if (p) { p.moving = false; if (c) p.inputSeq = c.inputs.sequence; }
  }
  private cabinetDistance(player: Player, cabinet: Cabinet) {
    const { entry } = cabinetSeat(cabinet);
    return Math.hypot(player.x - entry.x, player.y - entry.y);
  }
  private claimCabinet(id: string, cabinetId: string): string | undefined {
    if(this.cat.isHugging(id))return 'Сначала отпусти Кошку.';
    const p = this.state.players.get(id);
    const cabinet = p && cabinetsInHall(p.hall).find(c => c.id === cabinetId && c.playable);
    if (!p || !cabinet) return 'Этот автомат недоступен в этом зале.';
    if (p.activity || p.action === 'drink' || (p.playing && p.cabinet !== cabinetId)) return 'Сначала заверши текущее занятие.';
    if (p.cabinet === cabinetId && p.playing) return;
    if (this.cabinetDistance(p, cabinet) > CABINET_PLAY_DISTANCE) return 'Сначала подойди ближе к автомату.';
    // Disconnected avatars keep their claim until their reconnection reservation expires.
    if ([...this.state.players.values()].some(other => other !== p && other.cabinet === cabinetId)) return 'Этот автомат уже занят. Выбери другой или подожди.';
    this.stop(id); this.stand(id);
    const seat = cabinetSeat(cabinet);
    p.playing = true; p.cabinet = cabinetId; p.seat = 'cabinet:' + cabinetId;
    p.action = 'sit'; p.x = seat.x; p.y = seat.y; p.facing = 'up';
    p.gameReaction = ''; p.gameReactionUntil = 0; this.cabinetReactionAt.delete(id);
  }
  private releaseCabinet(id: string) {
    const p = this.state.players.get(id);
    this.cabinetReactionAt.delete(id);
    if (!p) return;
    if (p.cabinet) {
      const cabinet = cabinetsInHall(p.hall).find(c => c.id === p.cabinet && cabinetHall(c) === p.hall);
      if (cabinet) { const { entry } = cabinetSeat(cabinet); p.x = entry.x; p.y = entry.y; }
      p.cabinet = ''; p.playing = false;
      if (p.seat.startsWith('cabinet:')) { p.seat = ''; p.action = 'idle'; p.drink = ''; p.actionUntil = 0; }
    }
    p.gameReaction = ''; p.gameReactionUntil = 0;
  }
  private stand(id: string) {
    const p = this.state.players.get(id); if (!p || p.activity || p.cabinet) return;
    const seat = SEATS.find(s => s.id === p.seat);
    if (seat) { p.x = seat.entry.x; p.y = seat.entry.y; }
    p.seat = ''; p.action = 'idle'; p.drink = ''; p.actionUntil = 0;
  }
  private broadcastActivity(type:string,value:unknown,hall:HallId){
    const listeners=this.clients.filter(client=>{
      const player=this.state.players.get(client.sessionId);
      return player?.connected&&player.hall===hall;
    });
    const modern=listeners.filter(client=>type!=='activities'||this.activityProtocols.has(client.sessionId));
    // Room.broadcast encodes one shared packet for each group of recipients.
    if(modern.length)this.broadcast(type,value,{except:this.clients.filter(client=>!modern.includes(client))});
    const legacy=type==='activities'?listeners.filter(client=>!this.activityProtocols.has(client.sessionId)):[];
    // Already open pages can keep using full snapshots during a rollout.
    if(legacy.length)this.broadcast(type,this.activities.snapshot(),{except:this.clients.filter(client=>!legacy.includes(client))});
  }
  private enterDoor(id:string){
    const p=this.state.players.get(id),c=this.controls.get(id);
    if(!p?.connected||p.security||!c||this.cat.isHugging(id)||p.playing||p.seat||p.action==='drink'||!inHallDoor(p))return false;
    this.activities.leave(id);this.releaseCabinet(id);this.stop(id);this.stand(id);
    const link=hallLinkAt(p)!;const hall=link.target,door=link.arrival;
    p.hall=hall;p.hallRevision++;p.x=door.arrival.x;p.y=door.arrival.y;p.facing=door.facing;c.lastTarget=0;
    this.clients.find(client=>client.sessionId===id)?.send('activities',this.activities.snapshot());
    return true;
  }
  private tick(dt: number) {
    for (const [id, p] of this.state.players) {
      if(this.enterDoor(id))continue;
      const c = this.controls.get(id)!;
      if (p.gameReaction && Date.now() >= p.gameReactionUntil) { p.gameReaction = ''; p.gameReactionUntil = 0; }
      if (p.action === 'drink' && Date.now() >= p.actionUntil) { p.action = p.seat ? 'sit' : 'idle'; p.drink = ''; p.actionUntil = 0; }
      if (p.security || !p.connected || p.playing || this.cat.isHugging(id)) { p.moving = false; continue; }
      if (c.predicted) {
        c.inputs.advance(p, Date.now(), [...this.state.guards.values()], () => this.guards.contact(id));
        p.inputSeq = c.inputs.sequence;
        if (this.enterDoor(id)) continue;
        if (!c.inputs.pendingCount) {
          const action = c.afterMovement; c.afterMovement = undefined; action?.();
          if (Date.now()-c.at > 250) p.moving = false;
        }
        continue;
      }
      if (p.seat || p.action === 'drink') { p.moving = false; continue; }
      let dx = c.dx, dy = c.dy;
      if (Date.now() - c.at > 450) dx = dy = 0;
      if (!dx && !dy && !c.path.length) { p.moving = false; continue; }
      let remaining = (c.path.length ? PLAYER_SPRINT_SPEED : PLAYER_SPEED) * (c.inputs.sequence ? c.inputs.takeDuration(dt*1000)/1000 : dt)
        * intoxicatedMovement(p.soberAt, { x: dx, y: dy, ms: dt * 1000 }, Date.now() / 50).speedMultiplier;
      const beforeX = p.x, beforeY = p.y;
      while (remaining > 0) {
        const target = c.path[0];
        if (target) {
          dx = target.x - p.x; dy = target.y - p.y;
          if (Math.hypot(dx, dy) < .1) { c.path.shift(); if (!c.path.length) break; continue; }
        }
        const length = Math.hypot(dx, dy);
        if (!length) break;
        const distance = target ? Math.min(remaining, length) : remaining;
        // Keep click routes on their collision-checked path so every approach stays reachable.
        const steering = target ? { x: dx / length, y: dy / length }
          : intoxicatedMovement(p.soberAt, { x: dx, y: dy, ms: dt * 1000 }, Date.now() / 50);
        const segmentX = p.x, segmentY = p.y;
        let guardBlocked = false;
        // Small substeps prevent crossing a thin obstacle between ticks.
        for (let step = 0; step < 3; step++) {
          const mx = steering.x * distance / 3, my = steering.y * distance / 3;
          const guards=[...this.state.guards.values()];
          if (walkable(p.x + mx, p.y, hallObstacles(p.hall))) {if(blockedByGuard(p,p.x+mx,p.y,guards)){guardBlocked=true;this.guards.contact(id);}else p.x+=mx;}
          if(p.security)break;
          if (walkable(p.x, p.y + my, hallObstacles(p.hall))) {if(blockedByGuard(p,p.x,p.y+my,guards)){guardBlocked=true;this.guards.contact(id);}else p.y+=my;}
          if(p.security)break;
        }
        remaining -= distance;
        if (!target) break;
        if (Math.hypot(p.x-segmentX, p.y-segmentY) < .01) {
          // A passing patrol or a tiny time budget must not erase the destination.
          if (distance >= .01 && !guardBlocked) c.path = [];
          break;
        }
        if (Math.hypot(target.x-p.x, target.y-p.y) < .1) c.path.shift();
        if (!c.path.length) break;
      }
      const mx = p.x - beforeX, my = p.y - beforeY;
      p.moving = !p.security && Math.hypot(mx, my) > .01;
      if (p.moving) p.facing = movementFacing(mx, my, p.facing as Facing);
    }
  }
}
