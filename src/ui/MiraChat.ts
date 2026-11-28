import { language, isUserMessage, t as translateText, tr } from '../i18n/index';
import { DRINKS } from '../shared/world';
import { getIntoxication } from '../shared/intoxication';
import { MiraPortrait } from './MiraPortrait';
import type { MiraAttention } from '../shared/miraRoutine';
import { parseGeneratedAppearance } from '../shared/skinStudio';
import { hasSkinSheet } from '../game/generatedSkinArt';

type Turn = { who: 'Мира' | 'Ты'; message: string };
type Drink = typeof DRINKS[number];
export type MiraPlayerState = { skin: number; appearance?: string; soberAt: number; action: string; drink: string; name?: string };
export type MiraChatOptions = {
  portraitFrame?: (action: 'idle' | 'drink', frame: number) => string;
  playerState?: () => MiraPlayerState;
  onDrink?: (id: string) => boolean;
  onAttention?: (phase: MiraAttention) => void;
};

/** Server pause after a stuck conversation; used only to draw the remaining share of the ring. */
const MIRA_PAUSE_MS = 45000;

export class MiraChat {
  private log = document.createElement('div');
  private history = document.createElement('div');
  private talk = document.createElement('section');
  private menu = document.createElement('section');
  private archive = document.createElement('section');
  private form = document.createElement('form');
  private input = document.createElement('input');
  private send = document.createElement('button');
  private reset = document.createElement('button');
  private status = document.createElement('p');
  private chosen = document.createElement('p');
  private offer = document.createElement('div');
  private offerLabel = document.createElement('strong');
  private offerNote = document.createElement('small');
  private offerGlass = document.createElement('span');
  private offerButton = document.createElement('button');
  private thread = document.createElement('div');
  private replyScroll?: HTMLElement;
  private miraState = document.createElement('span');
  private miraStateText = document.createElement('span');
  private pauseRing = document.createElement('div');
  private pauseSeconds = document.createElement('span');
  private pauseArc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  private pauseTotal = 0;
  private typingTimer?: number;
  private drinkButtons: HTMLButtonElement[] = [];
  private player = document.createElement('figure');
  private playerPicture = document.createElement('img');
  private playerName = document.createElement('strong');
  private playerAction = document.createElement('small');
  private playerLevel = document.createElement('strong');
  private playerRemaining = document.createElement('small');
  private playerGauge = document.createElement('progress');
  private mira = new MiraPortrait();
  private choices: HTMLButtonElement[] = [];
  private turns: Turn[] = [];
  private busy = false;
  private version = 0;
  private controller?: AbortController;
  private cooldownUntil = 0;
  private cooldownTimer?: number;
  private drinkStarted = 0;
  private drinkPendingUntil = 0;
  private drinkFeedback = '';
  private drinkStatusText = '';
  private selectedDrink = '';
  private offeredDrink = '';
  private lastPortraitKey = '';
  private lastStatusSecond = -1;
  private lastSoberAt = -1;
  private roomWasDrinking = false;
  private heading = document.createElement('h2');
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private animationTimer?: number;
  private greetedUntil = 0;
  private lastAttention: MiraAttention = 'closed';
  private attentionAt = 0;

  constructor(private dialog: HTMLDialogElement, private options: MiraChatOptions = {}) {
    const drinks = dialog.querySelector<HTMLElement>('.drink-list') || document.createElement('div');
    const close = dialog.querySelector<HTMLButtonElement>('[data-close]') || document.createElement('button');
    dialog.replaceChildren(); dialog.classList.add('mira-rpg'); dialog.setAttribute('aria-labelledby', 'mira-dialog-title');
    const content = document.createElement('div'); content.className = 'mira-content';
    const header = document.createElement('header'); header.className = 'mira-heading';
    this.heading.id = 'mira-dialog-title'; this.heading.textContent = translateText('Мира');
    const role = document.createElement('small'); role.textContent = translateText('Разговор у стойки');
    close.type = 'button'; close.className = 'mira-leave'; close.setAttribute('aria-label', translateText('Уйти')); close.dataset.close = '';
    close.innerHTML = '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const leaveLabel = document.createElement('span'); leaveLabel.textContent = translateText('Уйти'); close.append(leaveLabel);
    const name = document.createElement('div'); name.className = 'mira-title'; name.append(this.heading, role);
    const tabs = document.createElement('nav'); tabs.className = 'mira-tabs'; tabs.setAttribute('aria-label', translateText('Разделы разговора'));
    for (const [label, view] of [[translateText('Разговор'), 'talk'], [translateText('Напитки'), 'menu'], [translateText('История'), 'history']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.miraView = view;
      button.addEventListener('click', () => this.show(view)); tabs.append(button);
    }
    this.createPlayerPortrait();
    header.append(name, tabs, this.player, close);
    this.talk.className = 'mira-talk';
    this.thread.className = 'mira-thread';
    this.log.className = 'mira-log'; this.log.setAttribute('role', 'log'); this.log.setAttribute('aria-label', translateText('Реплика Миры')); this.log.setAttribute('aria-live', 'polite');
    this.chosen.className = 'mira-chosen';
    const answers = document.createElement('div'); answers.className = 'mira-choices'; answers.setAttribute('aria-label', translateText('Варианты ответа'));
    for (const [label, message] of [[translateText('Как твоя смена?'), translateText('Как твоя смена?')], [translateText('Посоветуй напиток'), translateText('Посоветуй напиток.')], [translateText('Хочу выговориться'), translateText('Можно тебе кое-что рассказать?')]]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `› ${label}`; button.dataset.message = message;
      button.addEventListener('click', () => { this.input.value = button.dataset.message!; void this.submit(); }); answers.append(button); this.choices.push(button);
    }
    this.input.placeholder = translateText('Сказать своё…'); this.input.maxLength = 600; this.input.required = true; this.input.setAttribute('aria-label', translateText('Твоя реплика Мире'));
    this.send.type = 'submit'; this.send.textContent = translateText('Сказать');
    this.form.className = 'mira-answer'; this.form.append(this.input, this.send);
    this.offer.className = 'mira-drink-offer'; this.offer.hidden = true;
    this.offerGlass.className = 'drink-glass'; this.offerGlass.setAttribute('aria-hidden', 'true');
    const offerCopy = document.createElement('span'); offerCopy.className = 'mira-drink-offer-copy';
    this.offerLabel.className = 'mira-drink-offer-name'; this.offerNote.className = 'mira-drink-offer-note'; offerCopy.append(this.offerLabel, this.offerNote);
    this.offerButton.type = 'button'; this.offerButton.className = 'mira-drink-take'; this.offerButton.textContent = translateText('Выпить');
    this.offerButton.addEventListener('click', () => this.consume(this.offeredDrink));
    const offerLater = document.createElement('button'); offerLater.type = 'button'; offerLater.className = 'mira-drink-later'; offerLater.textContent = translateText('Не сейчас');
    offerLater.addEventListener('click', () => this.updateOffer());
    this.offer.append(this.offerGlass, offerCopy, this.offerButton, offerLater);
    const replyScroll = document.createElement('div'); replyScroll.className = 'mira-reply-scroll'; this.replyScroll = replyScroll;
    replyScroll.append(this.thread, this.chosen, this.log, this.offer);
    this.talk.append(replyScroll, answers, this.form);
    this.menu.className = 'mira-menu';
    const menuTitle = document.createElement('p'); menuTitle.textContent = translateText('Выбирай. Всё за счёт клуба.');
    const menuHint = document.createElement('small'); menuHint.className = 'mira-menu-hint'; menuHint.textContent = translateText('Алкоголь меняет походку и управление. Играть можно на любой стадии.');
    drinks.className = 'drink-list'; drinks.replaceChildren();
    for (const drink of DRINKS) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.drink = drink.id; button.style.setProperty('--drink-color', drink.color); button.setAttribute('aria-label', tr`Выпить: ${drink.name}`);
      const glass = document.createElement('span'); glass.className = 'drink-glass'; glass.textContent = '▰'; glass.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = drink.name;
      const description = document.createElement('small'); description.textContent = drink.description;
      const strength = document.createElement('small'); strength.className = 'drink-strength'; strength.textContent = tr`Бесплатно · ${drink.strength === 0 ? translateText('без алкоголя') : drink.strength < .2 ? translateText('лёгкий') : drink.strength < .35 ? translateText('средний') : translateText('крепкий')}`;
      copy.append(title, description, strength);
      const action = document.createElement('span'); action.className = 'drink-action'; action.textContent = translateText('Выпить');
      button.append(glass, copy, action); button.addEventListener('click', () => this.consume(drink.id)); drinks.append(button); this.drinkButtons.push(button);
    }
    this.menu.append(menuTitle, menuHint, drinks);
    this.archive.className = 'mira-archive'; this.history.className = 'mira-history'; this.archive.append(this.history);
    this.status.setAttribute('role', 'status'); this.status.className = 'mira-status';
    const footer = document.createElement('footer'); footer.className = 'mira-footer';
    const memory = document.createElement('small'); memory.className = 'mira-memory-note'; memory.textContent = translateText('Мира помнит разговоры в твоём аккаунте.');
    const settings = document.createElement('details'); settings.className = 'mira-options';
    const summary = document.createElement('summary'); summary.textContent = translateText('Память и данные');
    const settingsTitle = document.createElement('strong'); settingsTitle.textContent = translateText('Память и данные');
    const info = document.createElement('small'); info.textContent = translateText('Мира помнит разговоры в твоём аккаунте. «Начать заново» очищает её память. Реплики обрабатывает внешний сервис ИИ. Не сообщай секреты. Мира не заменяет психолога.');
    this.reset.type = 'button'; this.reset.textContent = translateText('Начать заново');
    const settingsContent = document.createElement('div'); settingsContent.className = 'mira-options-content'; settingsContent.append(settingsTitle, info, this.reset);
    settings.append(summary, settingsContent); footer.append(memory, settings);
    this.createMiraStatus();
    content.append(header, this.talk, this.menu, this.archive, this.status, footer); dialog.append(this.mira.element, content);
    this.greet(); this.show('talk');
    this.form.addEventListener('submit', event => { event.preventDefault(); void this.submit(); });
    this.reset.addEventListener('click', () => void this.startOver());
    const host = document.querySelector<HTMLElement>('.room-panel')!; host.append(dialog);
    new ResizeObserver(() => {
      dialog.classList.toggle('mira-narrow', host.clientWidth <= 700);
      dialog.classList.toggle('mira-compact', host.clientHeight < (host.clientWidth <= 700 ? 480 : 410));
      dialog.classList.toggle('mira-short', host.clientWidth <= 700 && host.clientHeight < 300);
      dialog.classList.toggle('mira-scroll', host.clientWidth <= 700 && host.clientHeight < 230);
      dialog.classList.toggle('mira-tiny', host.clientWidth <= 700 && host.clientHeight < 165);
    }).observe(host);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && dialog.open && !document.querySelector('dialog:modal')) { event.preventDefault(); dialog.close(); }
    });
    window.addEventListener('royal-account', () => { this.version++; this.controller?.abort(); this.cooldownUntil = 0; window.clearInterval(this.cooldownTimer); this.setBusy(false); this.turns = []; this.input.value = ''; this.status.textContent = ''; this.drinkPendingUntil = 0; this.drinkFeedback = ''; this.drinkStatusText = ''; this.roomWasDrinking = false; this.lastPortraitKey = ''; this.greet(); this.show('talk'); });
    dialog.addEventListener('close', () => {
      this.version++; this.controller?.abort(); this.setBusy(false);
      this.releaseAttention(); window.clearInterval(this.cooldownTimer);
    });
    window.addEventListener('royal-account', () => this.releaseAttention());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAttention();
      else if (dialog.open) this.startAnimation();
    });
  }

  open() {
    this.mira.load(); this.mira.stop(); this.greetedUntil=Date.now()+1200;
    this.show('talk'); this.startAnimation(); this.setCooldown(this.cooldownUntil);
    if (!this.busy) void this.resume();
  }
  private startAnimation() {
    window.clearInterval(this.animationTimer);
    this.animate(Date.now());
    this.animationTimer=window.setInterval(()=>this.animate(Date.now()),100);
  }
  private releaseAttention() {
    window.clearInterval(this.animationTimer); this.animationTimer=undefined;
    this.greetedUntil=0; this.finishTyping(); this.mira.stop(); this.lastAttention='closed'; this.attentionAt=0;
    this.options.onAttention?.('closed');
  }

  /** Mira's own state is shown on her portrait: speaking, thinking and the conversation pause. */
  private createMiraStatus() {
    this.miraState.className = 'mira-portrait-state'; this.miraState.hidden = true;
    const bars = document.createElement('span'); bars.className = 'mira-voice'; bars.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) bars.append(document.createElement('i'));
    this.miraState.append(bars, this.miraStateText);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const circle of [track, this.pauseArc]) { circle.setAttribute('cx', '32'); circle.setAttribute('cy', '32'); circle.setAttribute('r', '27'); }
    track.setAttribute('class', 'mira-pause-track'); this.pauseArc.setAttribute('class', 'mira-pause-arc');
    svg.append(track, this.pauseArc);
    const dial = document.createElement('span'); dial.className = 'mira-pause-dial'; dial.append(svg, this.pauseSeconds);
    const pauseLabel = document.createElement('span'); pauseLabel.textContent = translateText('Занялась стаканами');
    this.pauseRing.className = 'mira-pause'; this.pauseRing.setAttribute('role', 'img'); this.pauseRing.hidden = true; this.pauseRing.append(dial, pauseLabel);
    this.mira.element.append(this.miraState, this.pauseRing);
  }

  private updateMiraState(now: number) {
    const paused = this.cooldownUntil > now;
    const text = paused ? '' : this.busy ? translateText('Мира думает…') : this.mira.isSpeaking(now) ? translateText('Мира говорит') : '';
    this.miraState.hidden = !text; this.miraState.dataset.mode = this.busy ? 'think' : 'speak';
    if (this.miraStateText.textContent !== text) this.miraStateText.textContent = text;
    this.pauseRing.hidden = !paused;
    if (paused) {
      const remaining = this.cooldownUntil - now, seconds = Math.ceil(remaining / 1000);
      this.pauseSeconds.textContent = String(seconds);
      this.pauseRing.setAttribute('aria-label', tr`Мира вернётся через ${seconds} сек.`);
      const share = this.pauseTotal > 0 ? Math.max(0, Math.min(1, remaining / this.pauseTotal)) : 1;
      this.pauseArc.style.strokeDashoffset = String(169.65 * (1 - share));
    }
  }

  private createPlayerPortrait() {
    this.player.className = 'mira-player';
    const stage = document.createElement('div'); stage.className = 'mira-player-stage';
    const halo = document.createElement('span'); halo.className = 'mira-player-halo'; halo.setAttribute('aria-hidden', 'true');
    this.playerPicture.className = 'mira-player-avatar'; this.playerPicture.alt = translateText('Твой персонаж в зале'); this.playerPicture.width = 160; this.playerPicture.height = 200;
    const bubbles = document.createElement('span'); bubbles.className = 'mira-player-bubbles'; bubbles.textContent = '· ° ·'; bubbles.setAttribute('aria-hidden', 'true');
    stage.append(halo, this.playerPicture, bubbles);
    const caption = document.createElement('figcaption'); this.playerName.textContent = translateText('Ты'); this.playerAction.textContent = translateText('У стойки'); caption.append(this.playerName, this.playerAction);
    const state = document.createElement('div'); state.className = 'mira-intoxication';
    const label = document.createElement('small'); label.textContent = translateText('Состояние');
    this.playerGauge.max = 1; this.playerGauge.value = 0; this.playerGauge.setAttribute('aria-label', translateText('Степень опьянения'));
    this.playerLevel.className = 'mira-player-level'; this.playerLevel.textContent = translateText('Трезвый');
    this.playerRemaining.className = 'mira-player-remaining'; this.playerRemaining.textContent = translateText('Игры доступны');
    state.append(label, this.playerLevel, this.playerGauge, this.playerRemaining);
    this.player.append(stage, caption, state);
  }

  private playerState(): MiraPlayerState {
    try { return this.options.playerState?.() || { skin: 0, soberAt: 0, action: 'idle', drink: '' }; }
    catch { return { skin: 0, soberAt: 0, action: 'idle', drink: '' }; }
  }

  private animate(now: number) {
    if (!this.dialog.open || document.hidden) return;
    const mood=this.mira.mood();
    const phase: MiraAttention=this.mira.isSpeaking(now)?(mood==='neutral'?'speak':`speak-${mood}`):now<this.greetedUntil?'greet':'listen';
    if(phase!==this.lastAttention||now-this.attentionAt>1500) {
      this.lastAttention=phase;this.attentionAt=now;this.options.onAttention?.(phase);
    }
    this.mira.tick(now);
    const state = this.playerState(), intoxication = getIntoxication(state.soberAt, now);
    const drinking = state.action === 'drink';
    if (drinking) { this.drinkPendingUntil = 0; this.drinkFeedback = ''; }
    else if (this.drinkPendingUntil && now >= this.drinkPendingUntil) {
      this.drinkPendingUntil = 0; this.drinkFeedback = translateText('Напиток не получен. Попробуй ещё раз.');
    }
    const pending = this.drinkPendingUntil > now;
    if (!this.busy) {
      const message = pending ? translateText('Мира готовит напиток…') : this.drinkFeedback;
      if (message) this.status.textContent = message;
      else if (this.status.textContent === this.drinkStatusText) this.status.textContent = '';
      this.drinkStatusText = message;
    }
    if (drinking && !this.roomWasDrinking) this.drinkStarted = now;
    this.roomWasDrinking = state.action === 'drink';
    this.player.dataset.stage = String(intoxication.stage); this.player.classList.toggle('is-drinking', drinking);
    this.player.classList.toggle('mira-motion-reduced', this.reducedMotion.matches);
    this.playerName.textContent = state.name || translateText('Ты');
    this.playerAction.textContent = drinking ? tr`Пьёшь: ${this.drink(state.drink || this.selectedDrink)?.name || translateText('напиток')}` : pending ? translateText('Ждёшь напиток…') : this.drinkFeedback || translateText('У стойки');
    const action = drinking ? 'drink' : 'idle';
    const frame = drinking ? Math.min(5, Math.floor(Math.max(0, now - this.drinkStarted) / 534)) : this.reducedMotion.matches ? 0 : Math.floor(now / 700) % 4;
    const generated = parseGeneratedAppearance(state.appearance ?? '');
    const ready = !generated || hasSkinSheet(generated.skinId);
    const portraitKey = `${state.skin}:${state.appearance ?? ''}:${action}:${frame}:${intoxication.stage}:${ready}`;
    if (portraitKey !== this.lastPortraitKey && this.options.portraitFrame) {
      try {
        const source = this.options.portraitFrame(action, frame);
        if (source) { this.playerPicture.src = source; this.lastPortraitKey = portraitKey; }
      } catch { /* The room supplies its portrait after its textures are ready. */ }
    }
    const second = Math.floor(now / 1000);
    if (second !== this.lastStatusSecond || state.soberAt !== this.lastSoberAt) {
      this.lastStatusSecond = second; this.lastSoberAt = state.soberAt; this.playerLevel.textContent = intoxication.label; this.playerGauge.value = intoxication.level;
      this.playerGauge.setAttribute('aria-valuetext', intoxication.label);
      const minutes = Math.floor(Math.ceil(intoxication.remainingMs / 1000) / 60), seconds = Math.ceil(intoxication.remainingMs / 1000) % 60;
      this.playerRemaining.textContent = intoxication.remainingMs > 0 ? tr`До трезвости ${minutes}:${String(seconds).padStart(2, '0')}` : translateText('Игры доступны');
    }
    this.drinkButtons.forEach(button => button.disabled = drinking || pending || !this.options.onDrink);
    this.offerButton.disabled = drinking || pending || !this.options.onDrink;
    this.updateMiraState(now);
  }

  private drink(id: string): Drink | undefined { return DRINKS.find(drink => drink.id === id); }

  private consume(id: string) {
    if (!this.options.onDrink || !this.drink(id) || this.drinkPendingUntil > Date.now() || this.playerState().action === 'drink') return;
    try {
      if (!this.options.onDrink(id)) { this.drinkFeedback = translateText('Не получилось взять напиток. Попробуй ещё раз.'); }
      else { this.selectedDrink = id; this.drinkPendingUntil = Date.now() + 5000; this.drinkFeedback = ''; this.lastStatusSecond = -1; }
    }
    catch { this.drinkFeedback = translateText('Не получилось взять напиток. Попробуй ещё раз.'); }
    this.animate(Date.now());
  }

  private updateOffer(value?: unknown) {
    this.offeredDrink = typeof value === 'string' && this.drink(value) ? value : '';
    const drink = this.drink(this.offeredDrink);
    this.offer.hidden = !drink; this.offerLabel.textContent = drink ? tr`${drink.name} · угощаю` : '';
    this.offerNote.textContent = drink?.description ?? '';
    if (drink) this.offer.style.setProperty('--drink-color', drink.color); else this.offer.style.removeProperty('--drink-color');
    this.offerButton.title = drink ? tr`Выпить: ${drink.name}` : '';
  }

  private async resume() {
    const version = this.version; this.setBusy(true); this.status.textContent = translateText('Мира смотрит на тебя…');
    try {
      const data = await this.api(''); if (version !== this.version) return;
      if (Array.isArray(data.turns) && data.turns.length) {
        this.turns = data.turns.filter((turn: any) => ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string').map((turn: any) => ({ who: turn.role === 'user' ? 'Ты' : 'Мира', message: turn.content })).slice(-65);
        if (!this.turns.some(turn => turn.who === 'Мира')) this.greet();
        this.renderReply(); this.renderHistory();
      }
      this.updateChoices(data.choices); this.updateOffer(data.drinkOffer); this.mira.react(data.emotion); this.status.textContent = ''; this.setCooldown(data.cooldownUntil);
    } catch (error) { if (version === this.version) this.status.textContent = error instanceof Error ? translateText(error.message) : translateText('Не получилось вспомнить разговор.'); }
    finally { if (version === this.version) this.setBusy(false); }
  }

  private show(view: string) {
    this.talk.hidden = view !== 'talk'; this.menu.hidden = view !== 'menu'; this.archive.hidden = view !== 'history';
    this.heading.textContent = view === 'menu' ? translateText('Мира · напитки') : view === 'history' ? translateText('Мира · разговор') : translateText('Мира');
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-mira-view]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.miraView === view)); });
    this.dialog.querySelectorAll('details').forEach(details => details.open = false);
    if (view === 'history') this.renderHistory();
  }

  private greet() { this.turns = [{ who: 'Мира', message: translateText('Ну? Чем удивишь?') }]; this.offeredDrink = ''; this.updateChoices(); this.updateOffer(); this.mira.react('neutral'); this.renderReply(); }

  /** The newest exchange stays in .mira-chosen and .mira-log; a few earlier turns form the visible thread. */
  private renderReply(speak = false) {
    this.finishTyping();
    let last = -1;
    for (let index = this.turns.length - 1; index >= 0; index--) if (this.turns[index].who === 'Мира') { last = index; break; }
    const message = last >= 0 ? this.turns[last].message : translateText('Ну? Чем удивишь?');
    const chosen = last > 0 && this.turns[last - 1].who === 'Ты' ? last - 1 : -1;
    const earlier = this.turns.slice(Math.max(0, (chosen >= 0 ? chosen : Math.max(last, 0)) - 4), chosen >= 0 ? chosen : Math.max(last, 0));
    this.thread.replaceChildren(...earlier.map(turn => this.bubble(turn)));
    this.thread.hidden = !earlier.length;
    this.setChosen(chosen >= 0 ? this.turns[chosen].message : '');
    const p = document.createElement('p'); p.textContent = translateText(message); this.log.replaceChildren(p);
    if (speak && this.dialog.open && !document.hidden) this.typeReply(p, translateText(message), this.mira.speak(message));
    this.scrollThread();
  }

  private bubble(turn: Turn) {
    const p = document.createElement('p'); p.className = turn.who === 'Мира' ? 'mira-bubble is-mira' : 'mira-bubble is-player';
    const who = document.createElement('span'); who.className = 'mira-visually-hidden'; who.textContent = `${translateText(turn.who)}: `;
    p.append(who, document.createTextNode(turn.who === 'Мира' ? translateText(turn.message) : turn.message));
    return p;
  }

  private setChosen(message: string, pending = false) {
    this.chosen.replaceChildren();
    this.chosen.hidden = !message; this.chosen.classList.toggle('is-pending', pending);
    if (!message) return;
    const who = document.createElement('span'); who.className = 'mira-visually-hidden'; who.textContent = `${translateText('Ты')}: `;
    this.chosen.append(who, document.createTextNode(message));
  }

  private scrollThread() {
    const scroll = this.replyScroll;
    if (scroll) requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }

  /** The full reply is in the DOM at once; the unrevealed tail keeps its space and follows the mouth timing. */
  private typeReply(p: HTMLParagraphElement, text: string, duration: number) {
    if (this.reducedMotion.matches || text.length < 2) return;
    const shown = document.createTextNode(''), rest = document.createElement('span');
    rest.className = 'mira-typing'; rest.setAttribute('aria-hidden', 'true'); rest.textContent = text;
    p.replaceChildren(shown, rest); p.classList.add('is-typing');
    const started = performance.now(), length = Array.from(text).length, characters = Array.from(text);
    const step = () => {
      const count = Math.min(length, Math.ceil((performance.now() - started) / Math.max(1, duration * .92) * length));
      shown.textContent = characters.slice(0, count).join(''); rest.textContent = characters.slice(count).join('');
      if (count >= length) this.finishTyping();
    };
    this.typingTimer = window.setInterval(step, 32);
    step();
  }

  private finishTyping() {
    if (this.typingTimer === undefined) return;
    window.clearInterval(this.typingTimer); this.typingTimer = undefined;
    const p = this.log.querySelector('p');
    if (p) { p.textContent = p.textContent; p.classList.remove('is-typing'); }
  }

  /** While a reply is pending, the previous exchange moves into the thread and the new line comes last. */
  private renderPending(message: string) {
    this.finishTyping();
    this.thread.replaceChildren(...this.turns.slice(-4).map(turn => this.bubble(turn)));
    this.thread.hidden = false;
    this.setChosen(message, true);
    const wait = document.createElement('p'); wait.className = 'mira-waiting'; wait.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) wait.append(document.createElement('i'));
    this.log.replaceChildren(wait);
    this.scrollThread();
  }

  private renderHistory() {
    this.history.replaceChildren();
    for (const turn of this.turns) { const p = document.createElement('p'); const label = document.createElement('strong'); label.textContent = `${translateText(turn.who)}: `; p.append(label, document.createTextNode(turn.message)); this.history.append(p); }
  }

  private updateChoices(value?: unknown) {
    const fallback = [translateText('Как твоя смена?'), translateText('Посоветуй напиток'), translateText('Хочу выговориться')];
    const messages = Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'string' && item.trim()) ? value : fallback;
    this.choices.forEach((button, index) => { button.textContent = `› ${translateText(messages[index])}`; button.title = translateText(messages[index]); button.dataset.message = translateText(messages[index]); });
  }

  private setBusy(value: boolean) { this.busy = value; if (value) { this.drinkFeedback = ''; this.mira.stop(); } this.availability(); }
  private availability() {
    const paused = this.cooldownUntil > Date.now();
    this.send.disabled = this.busy || paused; this.reset.disabled = this.busy; this.input.readOnly = this.busy || paused; this.choices.forEach(button => button.disabled = this.busy || paused);
    this.dialog.classList.toggle('mira-paused', paused);
    if (paused && !this.busy) this.status.textContent = tr`Мира занялась стаканами. Ещё ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)} сек.`;
    this.dialog.classList.toggle('mira-busy', this.busy);
    this.updateMiraState(Date.now());
  }

  private setCooldown(value: unknown) {
    window.clearInterval(this.cooldownTimer);
    const previous = this.cooldownUntil; this.cooldownUntil = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const remaining = this.cooldownUntil - Date.now();
    if (remaining <= 0) this.pauseTotal = 0;
    else if (this.cooldownUntil !== previous || !this.pauseTotal) this.pauseTotal = Math.max(remaining, MIRA_PAUSE_MS);
    if (this.cooldownUntil > Date.now()) this.cooldownTimer = window.setInterval(() => {
      if (this.cooldownUntil <= Date.now()) { window.clearInterval(this.cooldownTimer); if (!this.busy) this.status.textContent = ''; }
      this.availability();
    }, 1000);
    this.availability();
  }

  private async api(path: string, body?: object) {
    this.controller = new AbortController();
    const response = await fetch(`/api/npc/mira${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Accept-Language': language, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(25000)]) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || translateText('Разговор сейчас недоступен.')); return data;
  }

  private async submit() {
    const message = this.input.value.trim(); if (this.busy || this.cooldownUntil > Date.now() || !message) return;
    const version = this.version; this.setBusy(true); this.status.textContent = translateText('Мира отвечает…');
    this.renderPending(message);
    try {
      const data = await this.api('', { message }); if (version !== this.version) return;
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error(translateText('Не получилось расслышать Миру. Попробуй ещё раз.'));
      this.turns.push({ who: 'Ты', message }, { who: 'Мира', message: data.reply }); this.turns = this.turns.slice(-65);
      this.renderReply(true); this.renderHistory(); this.updateChoices(data.choices); this.updateOffer(data.drinkOffer); this.mira.react(data.emotion); this.input.value = ''; this.status.textContent = ''; this.setCooldown(data.cooldownUntil);
    } catch (error) { if (version === this.version) { this.renderReply(); this.status.textContent = error instanceof Error && isUserMessage(error.message) ? translateText(error.message) : translateText('Не получилось связаться с Мирой. Попробуй позже.'); } }
    finally { if (version === this.version) this.setBusy(false); }
  }

  private async startOver() {
    if (this.busy) return;
    const version = this.version; this.setBusy(true);
    try { await this.api('/reset', {}); if (version !== this.version) return; this.setCooldown(0); this.greet(); this.renderHistory(); this.input.value = ''; this.status.textContent = ''; this.show('talk'); }
    catch { if (version === this.version) this.status.textContent = translateText('Не удалось начать заново. Попробуй позже.'); }
    finally { if (version === this.version) this.setBusy(false); }
  }
}
