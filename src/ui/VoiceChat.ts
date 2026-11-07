import { language, locale } from '../i18n/index';
import { LocationVoice } from '../network/LocationVoice';
import { HALLS, type PlayerView } from '../shared/world';
import './voice-chat.css';

const editable = 'input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"]),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
const byName = new Intl.Collator(locale);
const english = {
  'Голосовой чат': 'Voice chat',
  'Голос вкл.': 'Voice on',
  'Голос выкл.': 'Voice off',
  'Выключить голосовой чат': 'Turn off voice chat',
  'Включить голосовой чат': 'Turn on voice chat',
  'Включить звук голосового чата': 'Enable voice playback',
  'Говорить · G': 'Talk · G',
  'Удерживай, чтобы говорить': 'Hold to talk',
  'В эфире': 'Live',
  'Игроки в голосовом чате': 'Players in voice chat',
  'Игроки': 'Players',
  'В голосовой зоне пока никого нет.': 'Nobody else is in this voice zone.',
  'в эфире': 'live',
  'Заглушить': 'Mute',
  'Вернуть звук': 'Unmute',
  'Проверь доступ к микрофону и снова нажми G.': 'Check microphone permissions and press G again.',
  'Подключаем голос…': 'Connecting voice…',
  'Связь с голосовым чатом прервалась. Восстанавливаем…': 'Voice connection lost. Reconnecting…',
};
const t = (text: keyof typeof english) => language === 'en' ? english[text] : text;

export class VoiceChat {
  readonly voice: LocationVoice;
  private readonly panel = document.createElement('section');
  private readonly controls = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private readonly microphone = document.createElement('button');
  private readonly listToggle = document.createElement('button');
  private readonly details = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly list = document.createElement('ul');
  private readonly listen = document.createElement('button');
  private readonly empty = document.createElement('p');
  private readonly muteButtons = new Map<string, HTMLButtonElement>();
  private players: PlayerView[] = [];
  private self?: PlayerView;
  private input?: 'keyboard' | 'pointer';
  private mutePointer?: number;
  private listKey = '';

  constructor(chat: HTMLElement, transport: ConstructorParameters<typeof LocationVoice>[0]) {
    this.voice = new LocationVoice(transport, () => this.render());
    this.panel.className = 'voice-chat';
    this.panel.setAttribute('aria-label', t('Голосовой чат'));
    this.controls.className = 'voice-chat-controls';
    this.details.id = 'voice-chat-details';
    this.details.hidden = true;
    this.status.setAttribute('role', 'status');
    this.list.setAttribute('aria-label', t('Игроки в голосовом чате'));
    this.listen.textContent = t('Включить звук голосового чата');
    this.empty.textContent = t('В голосовой зоне пока никого нет.');
    this.listToggle.textContent = t('Игроки');
    this.listToggle.setAttribute('aria-controls', this.details.id);
    this.listToggle.setAttribute('aria-expanded', 'false');
    this.microphone.setAttribute('aria-label', t('Удерживай, чтобы говорить'));
    for (const button of [this.toggle, this.microphone, this.listToggle, this.listen]) button.type = 'button';
    this.controls.append(this.toggle, this.microphone, this.listToggle);
    this.details.append(this.list, this.empty);
    this.panel.append(this.controls, this.listen, this.status, this.details);
    chat.querySelector('.chat-heading')!.after(this.panel);
    this.toggle.onclick = () => { this.release(); this.voice.toggleEnabled(); };
    this.listToggle.onclick = () => {
      this.details.hidden = !this.details.hidden;
      this.listToggle.setAttribute('aria-expanded', String(!this.details.hidden));
      this.renderList();
    };
    this.listen.onclick = () => this.voice.unlockPlayback();
    this.list.addEventListener('pointerdown', event => { this.mutePointer = event.pointerId; });
    const finishMuteClick = (event: PointerEvent) => {
      if (event.pointerId !== this.mutePointer) return;
      setTimeout(() => { this.mutePointer = undefined; this.renderList(); }, 0);
    };
    window.addEventListener('pointerup', finishMuteClick, true);
    window.addEventListener('pointercancel', finishMuteClick, true);
    this.microphone.onpointerdown = event => {
      if (event.button !== 0 || this.input || !this.voice.press()) return;
      this.input = 'pointer';
      this.microphone.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    this.microphone.onpointerup = this.microphone.onpointercancel = this.microphone.onlostpointercapture = () => {
      if (this.input === 'pointer') this.release();
    };
    window.addEventListener('keydown', event => {
      if (this.voice.needsPlayback) this.voice.unlockPlayback();
      if (event.code !== 'KeyG' || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
        || (event.target instanceof Element && event.target.closest(editable))
        || this.input || !this.voice.press()) return;
      this.input = 'keyboard';
      event.preventDefault();
      event.stopPropagation();
    }, true);
    window.addEventListener('keyup', event => {
      if (event.code === 'KeyG' && this.input === 'keyboard') this.release();
    }, true);
    window.addEventListener('pointerdown', () => {
      if (this.voice.needsPlayback) this.voice.unlockPlayback();
    }, true);
    window.addEventListener('blur', () => this.release());
    window.addEventListener('pagehide', () => { this.release(); this.voice.setHall(undefined); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    document.addEventListener('focusin', event => {
      if (this.input === 'keyboard' && event.target instanceof Element && event.target.closest(editable)) this.release();
    });
    this.render();
  }

  updatePlayers(players: PlayerView[], selfId: string, inClub: boolean) {
    const self = players.find(player => player.id === selfId);
    this.self = inClub && self?.connected && !self.security ? self : undefined;
    this.players = this.self ? players.filter(player => player.id !== selfId && player.connected && player.hall === self?.hall) : [];
    this.voice.setHall(this.self?.hall);
    this.render();
  }

  clear() {
    this.release();
    this.updatePlayers([], '', false);
  }

  private release() {
    this.input = undefined;
    this.voice.release();
  }

  private render() {
    if (!this.voice.holding) this.input = undefined;
    this.panel.hidden = !this.voice.available || !this.self;
    this.toggle.textContent = t(this.voice.enabled ? 'Голос вкл.' : 'Голос выкл.');
    this.toggle.setAttribute('aria-label', t(this.voice.enabled ? 'Выключить голосовой чат' : 'Включить голосовой чат'));
    this.toggle.setAttribute('aria-pressed', String(this.voice.enabled));
    this.microphone.textContent = t(this.voice.transmitting ? 'В эфире' : 'Говорить · G');
    this.microphone.disabled = !this.voice.canTalk;
    this.microphone.dataset.transmitting = String(this.voice.transmitting);
    this.listToggle.disabled = !this.voice.enabled;
    if (!this.voice.enabled) {
      this.details.hidden = true;
      this.listToggle.setAttribute('aria-expanded', 'false');
    }
    this.listen.hidden = !this.voice.enabled || !this.voice.needsPlayback;
    const caption = this.voice.micError ? t('Проверь доступ к микрофону и снова нажми G.')
      : this.voice.status === 'connecting' ? t('Подключаем голос…')
      : this.voice.status === 'error' ? t('Связь с голосовым чатом прервалась. Восстанавливаем…') : '';
    if (caption !== this.status.textContent) this.status.textContent = caption;
    this.status.hidden = !caption;
    if (this.self) this.panel.setAttribute('aria-label', t('Голосовой чат') + ' · ' + HALLS[this.self.hall].name);
    this.renderList();
  }

  private renderList() {
    if (this.details.hidden || this.mutePointer !== undefined) return;
    const names = new Map(this.players.map(player => [player.id, player.name]));
    const peers = this.voice.peers.flatMap(peer => {
      const name = names.get(peer.playerId);
      return name ? [{ ...peer, name, muted: this.voice.isMuted(peer.muteKey) }] : [];
    }).sort((a, b) => Number(b.speaking) - Number(a.speaking) || byName.compare(a.name, b.name));
    const key = JSON.stringify(peers);
    if (key === this.listKey) return;
    this.listKey = key;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.voiceMute;
    this.muteButtons.clear();
    this.list.replaceChildren(...peers.map(peer => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = peer.name + (peer.speaking ? ' · ' + t('в эфире') : '');
      name.dataset.speaking = String(peer.speaking);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = t(peer.muted ? 'Вернуть звук' : 'Заглушить');
      button.setAttribute('aria-label', button.textContent + ' · ' + peer.name);
      button.dataset.voiceMute = peer.muteKey;
      button.onclick = () => this.voice.toggleMute(peer.muteKey);
      this.muteButtons.set(peer.muteKey, button);
      row.append(name, button);
      return row;
    }));
    this.empty.hidden = peers.length > 0;
    if (focused) (this.muteButtons.get(focused) ?? this.listToggle).focus({ preventScroll: true });
  }
}
