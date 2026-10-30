import { t as translateText, tr, locale, translateMessage } from '../i18n/index';
import { SecurityUI } from './SecurityUI';
import { installGameChat } from './GameChat';
import { ChatMedia } from './ChatMedia';
import { prefetchDemoGames } from '../game/demoGames';
import { AuthUI } from './AuthUI';
import { ActivitiesUI } from './ActivitiesUI';
import { PvpUI } from './PvpUI';
import type { RoomScene } from '../game/RoomScene';
import { LobbyClient, type ConnectionStatus } from '../network/LobbyClient';
import { HALLS, type ChatMessage, type PlayerView } from '../shared/world';
import { getIntoxication } from '../shared/intoxication';
import { CHAT_CONFIRMATION_TIMEOUT_MS, CHAT_PENDING_LIMIT, type ChatResult } from '../shared/chat';
import './chat-delivery.css';

type OutgoingMessage = {
  id: string;
  text: string;
  status: 'sending' | 'queued' | 'published' | 'rejected' | 'cancelled' | 'uncertain';
  message?: string;
  timer?: ReturnType<typeof setTimeout>;
};

export class SocialUI {
  readonly client: LobbyClient;
  readonly activities: ActivitiesUI;
  readonly pvp:PvpUI;
  private security: SecurityUI;
  private checking = false;
  private sanctioned = false;
  private selfId = '';
  private roomId = '';
  private messages = new Map<string, ChatMessage>();
  private dialog: HTMLDialogElement;
  private list: HTMLDivElement;
  private input: HTMLInputElement;
  private people: HTMLDivElement;
  private statusLabel = document.querySelector<HTMLElement>('.local-label')!;
  private auth: AuthUI;
  private error: HTMLParagraphElement;
  private invite: HTMLButtonElement;
  private followChat = true;
  private unread = 0;
  private scrollAnchor?: { id: string; offset: number };
  private newMessages: HTMLButtonElement;
  private media: ChatMedia;
  private outgoing = new Map<string, OutgoingMessage>();
  private outbox = document.createElement('div');
  private deliveryStatus = document.createElement('p');
  constructor(private scene: RoomScene, private toast: (message: string) => void) {
    window.addEventListener('royal-skin-loaded', () => {
      const portrait = document.querySelector<HTMLImageElement>('#player-portrait img');
      if (portrait) portrait.src = scene.getPortraitFrame('idle', 0);
    });
    const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
    const catalog = document.createElement('div'); catalog.className = 'catalog-panel'; catalog.id = 'catalog-panel';
    while(sidebar.firstChild) catalog.append(sidebar.firstChild);
    sidebar.append(catalog);
    const tabs = document.createElement('div'); tabs.className = 'social-tabs'; tabs.setAttribute('aria-label',translateText('Панели клуба'));
    tabs.innerHTML = translateText('<button id="games-tab" type="button" aria-pressed="false">Игры</button>');
    document.querySelector('.panel-tabs')!.append(tabs);
    const chat = document.createElement('section'); chat.className = 'chat-panel'; chat.id = 'chat-panel';
    chat.innerHTML = translateText('<div class="chat-heading"><strong>Общий чат</strong><span id="room-count">0 / 30</span></div><div class="people-list" id="people-list" aria-label="Игроки в клубе"></div><div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Сообщения зала"></div><form id="chat-form" class="chat-form"><label for="chat-input" class="sr-only">Сообщение в общий чат</label><input id="chat-input" maxlength="300" autocomplete="off" placeholder="Напиши что-нибудь…" disabled/><button id="send-chat" type="submit" aria-label="Отправить сообщение" disabled>↵</button></form>');
    const dock=document.createElement('aside');dock.className='chat-dock';dock.setAttribute('aria-label',translateText('Общий чат клуба'));dock.append(chat);
    document.querySelector('.workspace')!.append(dock);document.querySelector('.workspace')!.classList.add('with-chat');
    installGameChat(dock, document.querySelector<HTMLDialogElement>('#mini-dialog')!);
    catalog.hidden = false;
    this.people = chat.querySelector<HTMLDivElement>('#people-list')!;
    this.list = chat.querySelector<HTMLDivElement>('#chat-log')!;
    this.outbox.className = 'chat-outbox'; this.outbox.dataset.chatAnchor = 'outbox'; this.outbox.hidden = true;
    this.list.append(this.outbox);
    this.deliveryStatus.id = 'chat-delivery-status'; this.deliveryStatus.className = 'chat-delivery-status';
    this.deliveryStatus.setAttribute('role', 'status'); this.deliveryStatus.hidden = true;
    this.list.before(this.deliveryStatus);
    this.newMessages = document.createElement('button');
    this.newMessages.type = 'button'; this.newMessages.id = 'new-messages';
    this.newMessages.className = 'new-messages'; this.newMessages.hidden = true;
    this.list.after(this.newMessages);
    this.newMessages.addEventListener('click', () => this.showLatest());
    this.list.addEventListener('scroll', () => this.saveChatPosition());
    new ResizeObserver(()=>this.restoreChatPosition()).observe(this.list);
    this.input = chat.querySelector<HTMLInputElement>('#chat-input')!;
    this.media = new ChatMedia(chat, this.input, text => {
      return this.sendChat(text);
    }, value => this.scene.setTyping(value));
    this.invite = document.createElement('button'); this.invite.className = 'invite-button'; this.invite.id='invite'; this.invite.textContent = translateText('Пригласить'); this.invite.disabled = true;
    document.querySelector('.room-tools')!.prepend(this.invite);
    this.invite.addEventListener('click', async () => {
      const url = new URL(location.href); url.search = ''; url.searchParams.set('room', this.roomId);
      try { await navigator.clipboard.writeText(url.toString()); this.toast(translateText('Ссылка на этот клуб скопирована. Отправь её другу.')); }
      catch { window.prompt(translateText('Ссылка для приглашения в этот клуб:'), url.toString()); }
    });
    this.auth = new AuthUI(scene, async () => {
      const roomId = new URL(location.href).searchParams.get('room') || undefined;
      await this.client.join(roomId, Boolean(roomId && history.state?.royalJoinedRoom === roomId), this.auth.account?.id);
    }, () => this.client.leave());
    this.dialog = this.auth.dialog; this.error = this.auth.error;
    this.security = new SecurityUI(scene, () => this.auth.showRejoin());
    this.client = new LobbyClient({
      npcTime: (simulationAt, guestsAt) => this.scene.syncNpcTime(simulationAt, guestsAt),
      guests: guests => this.scene.syncGuests(guests),
      cat: cat => this.scene.syncCat(cat),
      guards: guards => this.scene.syncGuards(guards),
      mira: mira => this.scene.syncMira(mira),
      security: decision => { this.sanctioned = true; this.security.intervention(decision); this.chatAvailability(); },
      ejected: until => this.security.ejected(until),
      checking: value => { this.checking = value; this.chatAvailability(); },
      status: status => this.connectionStatus(status),
      joined: (roomId, selfId) => {
        this.pvp?.client.setAccount(this.auth.account?.id??null);
        document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => {
          if (dialog !== this.dialog) dialog.close();
        });
        this.sanctioned = false; this.scene.setSecurity(false); this.checking = false;
        this.roomId = roomId; this.selfId = selfId;
        this.messages.clear(); this.list.replaceChildren(this.outbox); this.media.prune(); this.media.close(false);
        this.showLatest();
        const url = new URL(location.href); url.searchParams.set('room', roomId); history.replaceState({ royalJoinedRoom: roomId }, '', url);
        this.scene.enableOnline({ inputs: inputs => this.client.send('inputs',inputs), move: (x,y) => this.client.send('move',{x,y}), target: (x,y) => this.client.send('target',{x,y}), stop: () => this.client.send('stop'), sit: seat => this.client.send('sit',seat), stand: () => this.client.send('stand'), drink: drink => this.client.send('drink',drink), cat: action => this.client.send('cat',action), cabinetPlay: id => this.client.claimCabinet(id), cabinetLeave: () => this.client.releaseCabinet(), cabinetReaction: (id,reaction) => this.client.send('cabinet-reaction',{id,reaction}) });
        this.dialog.close(); this.scene.setLocked(false); prefetchDemoGames();
        document.querySelector('.profile-name')!.firstChild!.textContent = this.auth.account?.name || translateText('Игрок');
      },
      players: (players, selfId) => this.updatePlayers(players, selfId),
      chat: message => this.addMessage(message),
      delivery: result => this.chatResult(result),
      history: messages => { messages.forEach(message => this.addMessage(message)); },
      notice: message => this.toast(message),
      activities: state => this.activities.update(state),
      pvp:value=>this.pvp?.client.receive(value),
      pvpResult:value=>this.pvp?.client.rejected(value),
      note: note => this.activities.receive(note),
    });
    this.activities = new ActivitiesUI(scene, value=>{
      const type = (value as {type?:string})?.type;
      if (type === 'join' || type === 'leave') this.scene.finishMovement(() => this.client.send('activity',value));
      else this.client.send('activity',value);
    });
    this.pvp=new PvpUI(scene,this.activities,value=>this.client.send('pvp',value));
    this.pvp.client.setAccount(this.auth.account?.id??null);
    chat.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault(); const text = this.input.value.trim();
      if (this.sendChat(text)) { this.input.value = ''; this.input.dispatchEvent(new Event('input', { bubbles: true })); this.input.focus(); }
    });
    this.input.addEventListener('input', () => this.chatAvailability());
    this.input.addEventListener('focus', () => this.scene.setTyping(true));
    this.input.addEventListener('blur', () => this.scene.setTyping(false));
    this.input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { this.input.blur(); document.querySelector<HTMLElement>('#game')!.focus(); } });
    document.querySelector('#game')!.addEventListener('pointerdown', () => this.input.blur());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.scene.finishMovement(() => this.client.send('stop')); });
    // Page teardown closes the socket; keep its recovery token for a reload.
    window.addEventListener('pagehide', () => this.client.send('stop'));
    this.statusLabel.textContent = translateText('Вход в зал');
    document.querySelector('.npc-count')!.textContent = '';
    this.scene.setLocked(true);
  }
  private connectionStatus(status: ConnectionStatus) {
    this.pvp?.client.setConnected(status==='connected');
    if (status !== 'connected') {
      this.checking = false;
      for (const entry of this.outgoing.values()) if (entry.status === 'sending' || entry.status === 'queued') {
        clearTimeout(entry.timer); entry.timer = undefined; entry.status = 'uncertain';
        entry.message = translateText('Связь прервалась. Доставка не подтверждена. Текст сохранён.');
      }
      this.renderOutbox();
    }
    if(status==='connected')this.activities?.connected();
    if(status==='disconnected'||status==='reconnecting')this.activities?.disconnected();
    this.statusLabel.textContent = { connecting: translateText('Подключаемся…'), connected: translateText('В сети'), reconnecting: translateText('Восстанавливаем связь…'), disconnected: translateText('Нет подключения') }[status];
    this.statusLabel.dataset.status = status;
    this.chatAvailability();
    this.invite.disabled = status !== 'connected';
    if (status === 'reconnecting' || status === 'disconnected') { this.scene.cancelMovement(); this.scene.setLocked(true); }
    if (status === 'connected' && !document.querySelector('dialog[open]')) this.scene.setLocked(false);
    if (status === 'disconnected' && this.roomId && !this.dialog.open && !this.security.active) {
      document.querySelector<HTMLDialogElement>('#mini-dialog')?.close();
      this.auth.showRejoin(); this.scene.setLocked(true);
    }
  }
  private chatAvailability() {
    const disabled = this.client.status !== 'connected' || this.sanctioned;
    this.input.disabled = disabled;
    this.media?.setDisabled(disabled);
    this.input.placeholder = this.sanctioned ? translateText('Подожди, охранник обращается к тебе') : translateText('Напиши что-нибудь…');
    const waiting = this.pendingChatCount();
    document.querySelector<HTMLButtonElement>('#send-chat')!.disabled = disabled || waiting >= CHAT_PENDING_LIMIT || !this.input.value.trim();
    const checking = [...this.outgoing.values()].filter(entry => entry.status === 'sending' || entry.status === 'queued').length;
    const uncertain = [...this.outgoing.values()].some(entry => entry.status === 'uncertain');
    this.deliveryStatus.textContent = waiting >= CHAT_PENDING_LIMIT ? translateText('Сохранены 3 сообщения. Дождись ответа или убери неподтверждённое.') : checking ? tr`На проверке: ${checking}. Можно писать дальше.` : uncertain ? translateText('Доставка не подтверждена. Проверь историю перед повторной отправкой.') : this.checking ? translateText('Охрана проверяет сообщение. Можно писать дальше.') : '';
    this.deliveryStatus.hidden = !this.deliveryStatus.textContent;
    for (const button of Array.from(this.outbox.querySelectorAll<HTMLButtonElement>('[data-chat-retry]'))) button.disabled = disabled || waiting >= CHAT_PENDING_LIMIT;
  }
  private pendingChatCount() {
    return [...this.outgoing.values()].filter(entry => entry.status === 'sending' || entry.status === 'queued' || entry.status === 'uncertain').length;
  }
  private sendChat(text: string): boolean {
    text = text.trim();
    if (!text || this.input.disabled || this.client.status !== 'connected' || this.sanctioned) return false;
    if (this.pendingChatCount() >= CHAT_PENDING_LIMIT) {
      this.toast(translateText('Сначала дождись ответа на сохранённые сообщения.')); return false;
    }
    if ([...this.outgoing.values()].some(entry => entry.text === text && entry.status !== 'rejected' && entry.status !== 'cancelled')) {
      this.toast(translateText('Это сообщение ещё не подтверждено. Проверь историю перед повтором.')); return false;
    }
    const id = crypto.randomUUID();
    const entry: OutgoingMessage = { id, text, status: 'sending' };
    this.outgoing.set(id, entry);
    entry.timer = setTimeout(() => {
      if (entry.status !== 'sending' && entry.status !== 'queued') return;
      entry.timer = undefined; entry.status = 'uncertain'; this.checking = false;
      entry.message = translateText('Ответ задерживается. Доставка не подтверждена. Текст сохранён.');
      this.renderOutbox();
    }, CHAT_CONFIRMATION_TIMEOUT_MS);
    this.showLatest(); this.renderOutbox();
    try {
      if (this.client.sendChat({ id, text })) return true;
      clearTimeout(entry.timer); this.outgoing.delete(id); this.renderOutbox();
      this.toast(translateText('Нет подключения. Текст остался в поле.')); return false;
    } catch {
      clearTimeout(entry.timer); entry.timer = undefined; entry.status = 'uncertain';
      entry.message = translateText('Не удалось подтвердить отправку. Текст сохранён.');
      this.renderOutbox(); return false;
    }
  }
  private chatResult(result: ChatResult) {
    const entry = this.outgoing.get(result.id);
    if (!entry) return;
    // A delayed queue acknowledgement cannot undo a final result or restart its deadline.
    if (result.status === 'queued') {
      if (entry.status === 'sending') entry.status = 'queued';
    } else {
      clearTimeout(entry.timer); entry.timer = undefined;
      entry.status = result.status; entry.message = result.message;
      if (![...this.outgoing.values()].some(item => item.status === 'sending' || item.status === 'queued')) this.checking = false;
      if (result.status === 'published') { try { this.client.send('history'); } catch { /* The published result remains valid while history reconnects. */ } }
    }
    this.renderOutbox();
  }
  private removeOutgoing(id: string) {
    const entry = this.outgoing.get(id);
    if (!entry) return;
    clearTimeout(entry.timer); this.outgoing.delete(id);
    if (![...this.outgoing.values()].some(item => item.status === 'sending' || item.status === 'queued')) this.checking = false;
    this.renderOutbox();
  }
  private restoreDraft(entry: OutgoingMessage) {
    if (this.input.value.trim()) { this.toast(translateText('В поле уже есть черновик. Он сохранён без изменений.')); return; }
    this.input.value = entry.text;
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.focus({ preventScroll: true });
    if (entry.status === 'uncertain') this.toast(translateText('Доставка не подтверждена. Проверь историю перед повторной отправкой.'));
  }
  private renderOutbox() {
    this.saveChatPosition(); this.outbox.replaceChildren();
    for (const entry of this.outgoing.values()) {
      const row = document.createElement('div'); row.className = 'chat-message chat-outgoing';
      row.dataset.requestId = entry.id; row.dataset.delivery = entry.status;
      const status = document.createElement('strong'); status.className = 'chat-outgoing-status';
      status.textContent = {
        sending: translateText('Отправляем на проверку…'), queued: translateText('Охрана проверяет…'),
        published: translateText('Опубликовано. Обновляем историю…'), rejected: translateText('Не опубликовано'),
        cancelled: translateText('Отправка отменена'), uncertain: translateText('Доставка не подтверждена'),
      }[entry.status];
      row.append(status, this.media.content(entry.text));
      if (entry.message) { const detail = document.createElement('p'); detail.className = 'chat-outgoing-detail'; detail.textContent = entry.message; row.append(detail); }
      if (entry.status === 'rejected' || entry.status === 'cancelled' || entry.status === 'uncertain') {
        const actions = document.createElement('div'); actions.className = 'chat-outgoing-actions';
        const restore = document.createElement('button'); restore.type = 'button'; restore.dataset.chatRestore = entry.id;
        restore.textContent = translateText('Вернуть в поле'); restore.addEventListener('click', () => this.restoreDraft(entry)); actions.append(restore);
        if (entry.status !== 'uncertain') {
          const retry = document.createElement('button'); retry.type = 'button'; retry.dataset.chatRetry = entry.id;
          retry.textContent = translateText('Повторить');
          retry.addEventListener('click', () => { if (this.sendChat(entry.text)) this.removeOutgoing(entry.id); }); actions.append(retry);
        }
        const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.chatDismiss = entry.id;
        remove.textContent = translateText('Убрать'); remove.addEventListener('click', () => this.removeOutgoing(entry.id)); actions.append(remove);
        row.append(actions);
      }
      this.outbox.append(row);
    }
    this.outbox.hidden = !this.outgoing.size;
    this.media?.prune(); this.chatAvailability(); this.restoreChatPosition();
  }
  private updatePlayers(players: PlayerView[], selfId: string) {
    this.scene.syncPlayers(players, selfId);
    const self = players.find(player => player.id === selfId);
    if (self) { this.sanctioned = Boolean(self.security); this.chatAvailability(); }
    const portrait = document.querySelector<HTMLImageElement>('#player-portrait img');
    if (self && portrait && portrait.dataset.appearance !== `${self.skin}:${self.appearance ?? ''}`) {
      portrait.src = this.scene.getPortraitFrame('idle', 0);
      portrait.dataset.appearance = `${self.skin}:${self.appearance ?? ''}`;
    }
    this.activities.updatePlayers(players,selfId);
    this.pvp.updatePlayers(players,selfId);
    document.querySelector('#room-count')!.textContent = `${players.length} / 30`;
    (document.querySelector('.npc-count') as HTMLElement).dataset.players=String(players.filter(p=>p.hall===this.scene.hall).length);
    const tags=new Map(Array.from(this.people.querySelectorAll<HTMLElement>('[data-player-id]'),tag=>[tag.dataset.playerId!,tag]));
    for (const player of players) {
      const tag = tags.get(player.id)??document.createElement(player.id===selfId?'span':'button'); tag.className = 'person-tag';tag.dataset.playerId=player.id;tags.delete(player.id);
      if(tag instanceof HTMLButtonElement){tag.type='button';tag.disabled=!player.connected;tag.title=translateText('Действия с игроком');tag.onclick=()=>this.pvp.openPlayer(player.id);}
      tag.textContent = player.name + ' · ' + HALLS[player.hall].number + (player.id === selfId ? translateText(' (ты)') : '') + (player.ears?' · 🙉':'') + (player.activity==='piano'?translateText(' · рояль'):player.playing ? translateText(' · играет') : player.action === 'drink' ? translateText(' · пьёт') : player.seat ? translateText(' · сидит') : '');
      const intoxication = getIntoxication(player.soberAt);
      if (intoxication.stage) tag.textContent += ' · ' + intoxication.label.toLowerCase();
      if (!player.connected) tag.classList.add('away');
      if(!tag.parentElement)this.people.append(tag);
    }
    for(const tag of tags.values())tag.remove();
  }
  private addMessage(message: ChatMessage) {
    if (message.requestId) this.removeOutgoing(message.requestId);
    if (this.messages.has(message.id)) return;
    this.saveChatPosition();
    this.messages.set(message.id, message);
    // Sort by server timestamps because history and new messages can cross in flight.
    const sorted = [...this.messages.values()].sort((a,b) => a.time - b.time).slice(-60);
    this.messages = new Map(sorted.map(m => [m.id,m]));
    const existing = new Map(Array.from(this.list.querySelectorAll<HTMLElement>(':scope > [data-message-id]'), row => [row.dataset.messageId!, row]));
    for (const [id, row] of existing) if (!this.messages.has(id)) row.remove();
    for(const item of sorted){
      if (existing.has(item.id)) continue;
      const row = document.createElement('div'); row.className = item.system ? 'chat-system' : 'chat-message';
      row.dataset.messageId = item.id;
      if (item.senderId === 'security') row.classList.add('security-message');
      if (!item.system) {
        const meta = document.createElement('div'); meta.className = 'chat-meta';
        const name = document.createElement('strong'); name.textContent = item.name + (item.senderId === this.selfId ? translateText(' · ты') : '');
        const time = document.createElement('time'); time.textContent = new Date(item.time).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'});
        meta.append(name,time); row.append(meta);
      }
      row.append(this.media.content(item.system ? translateMessage(item.text) : item.text, item.system)); this.list.insertBefore(row, this.outbox);
    }
    // Reorder only nodes that moved, keeping the current reading position intact.
    const rows = new Map(Array.from(this.list.querySelectorAll<HTMLElement>(':scope > [data-message-id]'), row => [row.dataset.messageId!, row]));
    sorted.forEach((item, index) => {
      const row = rows.get(item.id)!;
      if (this.list.children[index] !== row) this.list.insertBefore(row, this.list.children[index] || null);
    });
    this.media.prune();
    if (!this.followChat) {
      this.unread++;
      this.newMessages.textContent = tr`Новые сообщения: ${this.unread} ↓`;
      this.newMessages.hidden = false;
    }
    this.restoreChatPosition();
  }
  private saveChatPosition() {
    if (!this.list.clientHeight) return;
    this.followChat = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 45;
    const top = this.list.getBoundingClientRect().top;
    const row = Array.from(this.list.children).find(row => row.getBoundingClientRect().bottom > top);
    this.scrollAnchor = row ? { id: (row as HTMLElement).dataset.messageId || (row as HTMLElement).dataset.chatAnchor!, offset: row.getBoundingClientRect().top - top } : undefined;
    if (this.followChat) { this.unread = 0; this.newMessages.hidden = true; }
  }
  private restoreChatPosition() {
    if (!this.list.clientHeight) return;
    if (this.followChat) this.list.scrollTop = this.list.scrollHeight;
    else if (this.scrollAnchor) {
      const row = Array.from(this.list.children).find(row => ((row as HTMLElement).dataset.messageId || (row as HTMLElement).dataset.chatAnchor) === this.scrollAnchor!.id);
      if (row) this.list.scrollTop += row.getBoundingClientRect().top - this.list.getBoundingClientRect().top - this.scrollAnchor.offset;
      else this.list.scrollTop = 0;
    }
  }
  private showLatest() {
    this.followChat = true; this.unread = 0; this.newMessages.hidden = true;
    this.restoreChatPosition();
  }
  setPlaying(playing: boolean) { this.scene.finishMovement(() => { if (playing) this.client.send('playing',true); else this.client.releaseCabinet(); }); }
}
