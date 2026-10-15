import { SecurityUI } from './SecurityUI';
import { installGameChat } from './GameChat';
import { prefetchDemoGames } from '../game/demoGames';
import { AuthUI } from './AuthUI';
import { ActivitiesUI } from './ActivitiesUI';
import type { RoomScene } from '../game/RoomScene';
import { LobbyClient, type ConnectionStatus } from '../network/LobbyClient';
import { HALLS, type ChatMessage, type PlayerView } from '../shared/world';
import { getIntoxication } from '../shared/intoxication';

export class SocialUI {
  readonly client: LobbyClient;
  readonly activities: ActivitiesUI;
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
  constructor(private scene: RoomScene, private toast: (message: string) => void) {
    const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
    const catalog = document.createElement('div'); catalog.className = 'catalog-panel'; catalog.id = 'catalog-panel';
    while(sidebar.firstChild) catalog.append(sidebar.firstChild);
    sidebar.append(catalog);
    const tabs = document.createElement('div'); tabs.className = 'social-tabs'; tabs.setAttribute('aria-label','Панели клуба');
    tabs.innerHTML = '<button id="games-tab" type="button" aria-pressed="false">Игры</button>';
    document.querySelector('.panel-tabs')!.append(tabs);
    const chat = document.createElement('section'); chat.className = 'chat-panel'; chat.id = 'chat-panel';
    chat.innerHTML = '<div class="chat-heading"><strong>Общий чат</strong><span id="room-count">0 / 30</span></div><div class="people-list" id="people-list" aria-label="Игроки в клубе"></div><div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Сообщения зала"></div><form id="chat-form" class="chat-form"><label for="chat-input" class="sr-only">Сообщение в общий чат</label><input id="chat-input" maxlength="300" autocomplete="off" placeholder="Напиши что-нибудь…" disabled/><button id="send-chat" type="submit" aria-label="Отправить сообщение" disabled>↵</button></form>';
    const dock=document.createElement('aside');dock.className='chat-dock';dock.setAttribute('aria-label','Общий чат клуба');dock.append(chat);
    document.querySelector('.workspace')!.append(dock);document.querySelector('.workspace')!.classList.add('with-chat');
    installGameChat(dock, document.querySelector<HTMLDialogElement>('#mini-dialog')!);
    catalog.hidden = false;
    this.people = chat.querySelector<HTMLDivElement>('#people-list')!;
    this.list = chat.querySelector<HTMLDivElement>('#chat-log')!;
    this.newMessages = document.createElement('button');
    this.newMessages.type = 'button'; this.newMessages.id = 'new-messages';
    this.newMessages.className = 'new-messages'; this.newMessages.hidden = true;
    this.list.after(this.newMessages);
    this.newMessages.addEventListener('click', () => this.showLatest());
    this.list.addEventListener('scroll', () => this.saveChatPosition());
    new ResizeObserver(()=>this.restoreChatPosition()).observe(this.list);
    this.input = chat.querySelector<HTMLInputElement>('#chat-input')!;
    this.invite = document.createElement('button'); this.invite.className = 'invite-button'; this.invite.id='invite'; this.invite.textContent = 'Пригласить'; this.invite.disabled = true;
    document.querySelector('.room-tools')!.prepend(this.invite);
    this.invite.addEventListener('click', async () => {
      const url = new URL(location.href); url.search = ''; url.searchParams.set('room', this.roomId);
      try { await navigator.clipboard.writeText(url.toString()); this.toast('Ссылка на этот клуб скопирована. Отправь её другу.'); }
      catch { window.prompt('Ссылка для приглашения в этот клуб:', url.toString()); }
    });
    this.auth = new AuthUI(scene, async () => {
      const roomId = new URL(location.href).searchParams.get('room') || undefined;
      await this.client.join(roomId, Boolean(roomId && history.state?.royalJoinedRoom === roomId), this.auth.account?.id);
    }, () => this.client.leave());
    this.dialog = this.auth.dialog; this.error = this.auth.error;
    this.security = new SecurityUI(scene, () => this.auth.showRejoin());
    this.client = new LobbyClient({
      guests: guests => this.scene.syncGuests(guests),
      guards: guards => this.scene.syncGuards(guards),
      mira: mira => this.scene.syncMira(mira),
      security: decision => { this.sanctioned = true; this.security.intervention(decision); this.chatAvailability(); },
      ejected: until => this.security.ejected(until),
      checking: value => { this.checking = value; this.chatAvailability(); },
      status: status => this.connectionStatus(status),
      joined: (roomId, selfId) => {
        document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => {
          if (dialog !== this.dialog) dialog.close();
        });
        this.sanctioned = false; this.scene.setSecurity(false); this.checking = false;
        this.roomId = roomId; this.selfId = selfId;
        this.messages.clear(); this.list.replaceChildren();
        this.showLatest();
        const url = new URL(location.href); url.searchParams.set('room', roomId); history.replaceState({ royalJoinedRoom: roomId }, '', url);
        this.scene.enableOnline({ inputs: inputs => this.client.send('inputs',inputs), move: (x,y) => this.client.send('move',{x,y}), target: (x,y) => this.client.send('target',{x,y}), stop: () => this.client.send('stop'), sit: seat => this.client.send('sit',seat), stand: () => this.client.send('stand'), drink: drink => this.client.send('drink',drink), cabinetPlay: id => this.client.claimCabinet(id), cabinetLeave: () => this.client.releaseCabinet(), cabinetReaction: (id,reaction) => this.client.send('cabinet-reaction',{id,reaction}) });
        this.dialog.close(); this.scene.setLocked(false); prefetchDemoGames();
        document.querySelector('.profile-name')!.firstChild!.textContent = this.auth.account?.name || 'Игрок';
      },
      players: (players, selfId) => this.updatePlayers(players, selfId),
      chat: message => this.addMessage(message),
      history: messages => { messages.forEach(message => this.addMessage(message)); },
      notice: message => this.toast(message),
      activities: state => this.activities.update(state),
      note: note => this.activities.receive(note),
    });
    this.activities = new ActivitiesUI(scene, value=>{
      const type = (value as {type?:string})?.type;
      if (type === 'join' || type === 'leave') this.scene.finishMovement(() => this.client.send('activity',value));
      else this.client.send('activity',value);
    });
    chat.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault(); const text = this.input.value.trim();
      if (!text || this.client.status !== 'connected') return;
      this.showLatest();
      this.client.send('chat', text); this.input.value = ''; this.input.focus();
    });
    this.input.addEventListener('focus', () => this.scene.setTyping(true));
    this.input.addEventListener('blur', () => this.scene.setTyping(false));
    this.input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { this.input.blur(); document.querySelector<HTMLElement>('#game')!.focus(); } });
    document.querySelector('#game')!.addEventListener('pointerdown', () => this.input.blur());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.scene.finishMovement(() => this.client.send('stop')); });
    window.addEventListener('pagehide', () => this.client.leave());
    this.statusLabel.textContent = 'Вход в зал';
    document.querySelector('.npc-count')!.textContent = '';
    this.scene.setLocked(true);
  }
  private connectionStatus(status: ConnectionStatus) {
    if(status==='connected')this.activities?.connected();
    if(status==='disconnected'||status==='reconnecting')this.activities?.disconnected();
    this.statusLabel.textContent = { connecting: 'Подключаемся…', connected: 'В сети', reconnecting: 'Восстанавливаем связь…', disconnected: 'Нет подключения' }[status];
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
    const disabled = this.client.status !== 'connected' || this.checking || this.sanctioned;
    this.input.disabled = disabled;
    this.input.placeholder = this.checking ? 'Охрана проверяет сообщение…' : this.sanctioned ? 'Подожди, охранник обращается к тебе' : 'Напиши что-нибудь…';
    document.querySelector<HTMLButtonElement>('#send-chat')!.disabled = disabled;
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
    document.querySelector('#room-count')!.textContent = `${players.length} / 30`;
    (document.querySelector('.npc-count') as HTMLElement).dataset.players=String(players.filter(p=>p.hall===this.scene.hall).length);
    this.people.replaceChildren();
    for (const player of players) {
      const tag = document.createElement('span'); tag.className = 'person-tag';
      tag.textContent = player.name + ' · ' + HALLS[player.hall].number + (player.id === selfId ? ' (ты)' : '') + (player.ears?' · 🙉':'') + (player.activity==='piano'?' · рояль':player.playing ? ' · играет' : player.action === 'drink' ? ' · пьёт' : player.seat ? ' · сидит' : '');
      const intoxication = getIntoxication(player.soberAt);
      if (intoxication.stage) tag.textContent += ' · ' + intoxication.label.toLowerCase();
      if (!player.connected) tag.classList.add('away');
      this.people.append(tag);
    }
  }
  private addMessage(message: ChatMessage) {
    if (this.messages.has(message.id)) return;
    this.saveChatPosition();
    this.messages.set(message.id, message);
    // Sort by server timestamps because history and new messages can cross in flight.
    const sorted = [...this.messages.values()].sort((a,b) => a.time - b.time).slice(-60);
    this.messages = new Map(sorted.map(m => [m.id,m]));
    const existing = new Map(Array.from(this.list.children, row => [(row as HTMLElement).dataset.messageId!, row]));
    for (const [id, row] of existing) if (!this.messages.has(id)) row.remove();
    for(const item of sorted){
      if (existing.has(item.id)) continue;
      const row = document.createElement('div'); row.className = item.system ? 'chat-system' : 'chat-message';
      row.dataset.messageId = item.id;
      if (item.senderId === 'security') row.classList.add('security-message');
      if (!item.system) {
        const meta = document.createElement('div'); meta.className = 'chat-meta';
        const name = document.createElement('strong'); name.textContent = item.name + (item.senderId === this.selfId ? ' · ты' : '');
        const time = document.createElement('time'); time.textContent = new Date(item.time).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
        meta.append(name,time); row.append(meta);
      }
      const content = document.createElement('p'); content.textContent = item.text; row.append(content); this.list.append(row);
    }
    // Reorder only nodes that moved, keeping the current reading position intact.
    const rows = new Map(Array.from(this.list.children, row => [(row as HTMLElement).dataset.messageId!, row]));
    sorted.forEach((item, index) => {
      const row = rows.get(item.id)!;
      if (this.list.children[index] !== row) this.list.insertBefore(row, this.list.children[index] || null);
    });
    if (!this.followChat) {
      this.unread++;
      this.newMessages.textContent = `Новые сообщения: ${this.unread} ↓`;
      this.newMessages.hidden = false;
    }
    this.restoreChatPosition();
  }
  private saveChatPosition() {
    if (!this.list.clientHeight) return;
    this.followChat = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 45;
    const top = this.list.getBoundingClientRect().top;
    const row = Array.from(this.list.children).find(row => row.getBoundingClientRect().bottom > top);
    this.scrollAnchor = row ? { id: (row as HTMLElement).dataset.messageId!, offset: row.getBoundingClientRect().top - top } : undefined;
    if (this.followChat) { this.unread = 0; this.newMessages.hidden = true; }
  }
  private restoreChatPosition() {
    if (!this.list.clientHeight) return;
    if (this.followChat) this.list.scrollTop = this.list.scrollHeight;
    else if (this.scrollAnchor) {
      const row = Array.from(this.list.children).find(row => (row as HTMLElement).dataset.messageId === this.scrollAnchor!.id);
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
