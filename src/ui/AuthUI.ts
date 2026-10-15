import { gameAudio } from '../game/GameAudio';
import { appearanceFromLegacy } from '../shared/appearance';
import { CharacterEditor } from './CharacterEditor';
import type { Account } from '../../server/accounts';
import type { RoomScene } from '../game/RoomScene';

export class AuthUI {
  readonly dialog = document.createElement('dialog');
  readonly error: HTMLParagraphElement;
  private currentAccount: Account | null = null;
  get account() { return this.currentAccount; }
  set account(value: Account | null) {
    if (this.currentAccount?.id !== value?.id) {
      document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => {
        if (dialog !== this.dialog) dialog.close();
      });
    }
    this.currentAccount = value;
    window.dispatchEvent(new CustomEvent('royal-account', { detail: value?.id ?? null }));
  }
  private entryEditor = new CharacterEditor('entry');
  private settingsEditor = new CharacterEditor('settings');
  private busy = false;
  private inRoom = false;
  private logoutButton = document.createElement('button');
  private renameButton = document.createElement('button');
  private nameDialog = document.createElement('dialog');
  constructor(private scene: RoomScene, private enter: () => Promise<void>, private leave: () => void) {
    this.dialog.id = 'join-dialog'; this.dialog.className = 'join-dialog auth-dialog';
    this.dialog.setAttribute('aria-labelledby', 'join-title');
    this.dialog.innerHTML = `
      <span class="eyebrow">РОЯЛЬ / ТВОЁ МЕСТО В КЛУБЕ</span>
      <h2 id="join-title">Твой вход в клуб</h2>
      <section id="login-step">
        <p class="auth-description">Почта, пароль, и ты с нами. Если заходишь впервые, аккаунт создастся автоматически.</p>
        <form id="login-form">
          <label for="email">Почта</label><input id="email" type="email" name="email" maxlength="254" autocomplete="username" placeholder="you@example.com" required>
          <label for="password">Пароль</label><div class="password-field"><input id="password" type="password" name="password" minlength="8" maxlength="128" autocomplete="current-password" placeholder="Не меньше 8 символов" required><button id="reveal-password" type="button" aria-label="Показать пароль" aria-pressed="false">Показать</button></div>
          <button id="login-button" class="primary-button" type="submit">Продолжить</button>
        </form>
        <small class="auth-hint">Используй свой пароль для этого клуба. Подтверждение почты пока не требуется.</small>
      </section>
      <section id="character-step" hidden>
        <p class="auth-description">Собери своего персонажа. Внешность сохранится в аккаунте, её можно менять в настройках.</p>
        <div class="account-badge"><strong id="account-name"></strong><span id="account-email"></span></div>
        <label for="game-name">Игровое имя</label><input id="game-name" name="nickname" autocomplete="nickname" maxlength="48" required aria-describedby="name-hint" placeholder="Как тебя называть?">
        <small id="name-hint" class="name-hint">От 1 до 24 символов. Можно использовать русский, латиницу, пробелы и эмодзи.</small>
        <div id="character-customization"></div>
        <div class="wardrobe-actions"><button id="join-button" class="primary-button" type="button" disabled>Войти в зал</button>
        <button id="switch-account" class="text-button" type="button">Другой аккаунт</button></div>
      </section>
      <section id="connection-step" hidden>
        <p class="auth-description">Входим в зал с сохранённым персонажем.</p>
        <button id="retry-entry" class="primary-button" type="button">Войти в зал</button>
        <button id="connection-logout" class="text-button" type="button">Другой аккаунт</button>
      </section>
      <p id="join-error" role="alert" hidden></p>
      <button id="new-room" class="text-button" type="button" hidden>Войти в другой зал</button>
      <a class="offline-link" href="/?offline=1">Осмотреться одному</a>`;
    document.body.append(this.dialog);
    this.nameDialog.id = 'name-dialog'; this.nameDialog.className = 'join-dialog auth-dialog';
    this.nameDialog.setAttribute('aria-labelledby','name-title');
    this.nameDialog.innerHTML = `<span class="eyebrow">РОЯЛЬ / ТВОЙ ПРОФИЛЬ</span><h2 id="name-title">Настройки игрока</h2><form id="name-form"><label for="new-game-name">Новое игровое имя</label><input id="new-game-name" name="nickname" autocomplete="nickname" maxlength="48" required><small class="name-hint">От 1 до 24 символов. Имя увидят другие игроки.</small><p class="auth-description">Твой персонаж</p><div id="settings-character-customization"></div><p id="name-error" role="alert" hidden></p><div class="wardrobe-actions"><button class="primary-button" type="submit">Сохранить настройки</button><button id="cancel-name" class="text-button" type="button">Отмена</button></div></form>`;
    this.nameDialog.querySelector('h2')!.after(gameAudio.createSettings());
    document.body.append(this.nameDialog);
    this.nameDialog.querySelector('#cancel-name')!.addEventListener('click', () => this.nameDialog.close());
    this.nameDialog.addEventListener('close', () => { this.settingsEditor.setActive(false); if (this.inRoom) scene.setLocked(Boolean(document.querySelector('dialog[open]'))); });
    this.nameDialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault(); void this.perform(async () => {
        const result = await this.api('/character', { appearance: this.settingsEditor.value, name: this.nameDialog.querySelector<HTMLInputElement>('#new-game-name')!.value });
        this.account = result.account;
        document.querySelector('.profile-name')!.firstChild!.textContent = this.account!.name;
        this.nameDialog.close();
      });
    });
    this.error = this.dialog.querySelector<HTMLParagraphElement>('#join-error')!;
    this.dialog.querySelector('#character-customization')!.append(this.entryEditor.element);
    this.nameDialog.querySelector('#settings-character-customization')!.append(this.settingsEditor.element);
    this.dialog.addEventListener('cancel', event => event.preventDefault());
    this.dialog.addEventListener('close', () => { this.entryEditor.setActive(false); scene.setLocked(false); });
    this.dialog.querySelector('#reveal-password')!.addEventListener('click', () => {
      const input = this.dialog.querySelector<HTMLInputElement>('#password')!; const reveal = input.type === 'password'; input.type = reveal ? 'text' : 'password';
      const button = this.dialog.querySelector<HTMLButtonElement>('#reveal-password')!;
      button.textContent = reveal ? 'Скрыть' : 'Показать'; button.setAttribute('aria-label',reveal ? 'Скрыть пароль' : 'Показать пароль'); button.setAttribute('aria-pressed',String(reveal));
    });
    this.dialog.querySelector('#login-form')!.addEventListener('submit', event => {
      event.preventDefault(); void this.perform(async () => {
        const email = this.dialog.querySelector<HTMLInputElement>('#email')!, password = this.dialog.querySelector<HTMLInputElement>('#password')!;
        const result = await this.api('/login', { email: email.value, password: password.value });
        password.value = ''; this.account = result.account; await this.continueEntry();
      });
    });
    this.dialog.querySelector('#join-button')!.addEventListener('click', () => { void this.perform(async () => {
      const name = this.dialog.querySelector<HTMLInputElement>('#game-name')!;
      if (!name.reportValidity()) return;
      const result = await this.api('/character', { appearance: this.entryEditor.value, name: name.value }); this.account = result.account;
      await this.enter(); this.inRoom = true; this.logoutButton.hidden = false; this.renameButton.hidden = false;
    }); });
    this.dialog.querySelector('#new-room')!.addEventListener('click', () => {
      if (this.busy) return;
      const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null,'',url);
      this.error.hidden = true; this.dialog.querySelector<HTMLElement>('#new-room')!.hidden = true;
      void this.perform(() => this.continueEntry());
    });
    this.dialog.querySelector('#retry-entry')!.addEventListener('click', () => void this.perform(() => this.continueEntry()));
    this.dialog.querySelector('#connection-logout')!.addEventListener('click', () => void this.logout());
    this.dialog.querySelector('#switch-account')!.addEventListener('click', () => void this.logout());
    this.logoutButton.type = 'button'; this.logoutButton.className = 'logout-button'; this.logoutButton.textContent = 'Выйти'; this.logoutButton.hidden = true;
    this.logoutButton.addEventListener('click', () => void this.logout()); document.querySelector('.profile')!.append(this.logoutButton);
    this.renameButton.type = 'button'; this.renameButton.className = 'logout-button'; this.renameButton.textContent = 'Настройки'; this.renameButton.setAttribute('aria-label','Настройки игрока'); this.renameButton.hidden = true;
    this.renameButton.addEventListener('click', () => {
      if (!this.account || this.dialog.open || this.nameDialog.open) return;
      this.nameDialog.querySelector<HTMLInputElement>('#new-game-name')!.value = this.account.name;
      this.settingsEditor.value = this.account.appearance ?? appearanceFromLegacy(this.account.skin); this.renderSelection();
      this.nameDialog.querySelector<HTMLElement>('#name-error')!.hidden = true;
      scene.setLocked(true); this.nameDialog.showModal(); this.settingsEditor.setActive(true); this.nameDialog.querySelector<HTMLElement>('#sound-enabled')!.focus();
    });
    this.logoutButton.before(this.renameButton);
    scene.setLocked(true); this.dialog.showModal();
    this.showConnection();
    void this.perform(async () => { const result = await this.api('/me'); this.account = result.account; await this.continueEntry(); });
  }
  private async api(path: string, body?: object) {
    const response = await fetch(`/api/auth${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type':'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) { if (response.status === 401 && path !== '/login') { this.account = null; this.showLogin(); this.error.textContent = result.error; this.error.hidden = false; } throw new Error(result.error || 'Не удалось выполнить запрос.'); }
    return result as { account: Account | null };
  }
  private async perform(action: () => Promise<void>) {
    if (this.busy) return;
    const errorElement = this.nameDialog.open ? this.nameDialog.querySelector<HTMLParagraphElement>('#name-error')! : this.error;
    this.busy = true; errorElement.hidden = true; this.renderSelection();
    try { await action(); } catch (error) {
      const message = error instanceof Error ? error.message : '';
      errorElement.textContent = /[а-яА-Я]/.test(message) ? message : 'Не удалось подключиться. Проверь интернет или попробуй другой зал.';
      errorElement.hidden = false;
      this.dialog.querySelector<HTMLElement>('#new-room')!.hidden = !this.account || !new URL(location.href).searchParams.has('room');
    } finally { this.busy = false; this.renderSelection(); }
  }
  private renderSelection() {
    this.entryEditor.setBusy(this.busy); this.settingsEditor.setBusy(this.busy);
    this.dialog.querySelector<HTMLButtonElement>('#join-button')!.disabled = this.busy;
    this.dialog.querySelector<HTMLButtonElement>('#login-button')!.disabled = this.busy;
    this.dialog.querySelector<HTMLButtonElement>('#switch-account')!.disabled = this.busy;
    for (const id of ['retry-entry', 'connection-logout', 'new-room']) this.dialog.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = this.busy;
    this.dialog.querySelector('#retry-entry')!.textContent = this.busy ? 'Подключаемся…' : 'Войти в зал';
    this.logoutButton.disabled = this.busy;
    this.renameButton.disabled = this.busy;
    this.nameDialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = this.busy);
  }
  private async continueEntry() {
    if (!this.account) { this.showLogin(); return; }
    if (this.account.skin === null) { this.showCharacter(); return; }
    this.showConnection();
    await this.enter(); this.inRoom = true;
    this.logoutButton.hidden = false; this.renameButton.hidden = false;
  }
  private showConnection() {
    this.entryEditor.setActive(false);
    this.dialog.querySelector('#join-title')!.textContent = 'Вход в зал';
    this.dialog.querySelector<HTMLElement>('#login-step')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('#character-step')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('#connection-step')!.hidden = false;
  }
  private showCharacter() {
    if (!this.account) return;
    this.entryEditor.value = this.account.appearance ?? appearanceFromLegacy(this.account.skin);
    this.entryEditor.setActive(true);
    this.dialog.querySelector('#join-title')!.textContent = 'Создай персонажа';
    this.dialog.querySelector<HTMLElement>('#login-step')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('#character-step')!.hidden = false;
    this.dialog.querySelector<HTMLElement>('#connection-step')!.hidden = true;
    this.dialog.querySelector('#account-name')!.textContent = this.account.name;
    this.dialog.querySelector<HTMLInputElement>('#game-name')!.value = this.account.name;
    this.dialog.querySelector('#account-email')!.textContent = this.account.email;
    this.logoutButton.hidden = false; this.renameButton.hidden = false; this.renderSelection();
  }
  private showLogin() {
    this.entryEditor.setActive(false);
    this.inRoom = false;
    this.logoutButton.hidden = true; this.renameButton.hidden = true; this.nameDialog.close();
    this.dialog.querySelector('#join-title')!.textContent = 'Твой вход в клуб';
    this.dialog.querySelector<HTMLElement>('#login-step')!.hidden = false;
    this.dialog.querySelector<HTMLElement>('#character-step')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('#connection-step')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('#new-room')!.hidden = true;
    document.querySelector('.profile-name')!.firstChild!.textContent = 'Гость';
    if (!this.dialog.open) this.dialog.showModal(); this.scene.setLocked(true);
  }
  private async logout() {
    await this.perform(async () => {
      await this.api('/logout',{});
      const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null,'',url);
      this.leave(); this.account = null; this.showLogin();
    });
  }
  showRejoin() {
    this.inRoom = false; this.nameDialog.close();
    void this.perform(async () => {
      const result = await this.api('/me'); this.account = result.account;
      if (this.account?.skin != null) this.showConnection(); else if (this.account) this.showCharacter(); else this.showLogin();
      if (!this.dialog.open) this.dialog.showModal(); this.scene.setLocked(true);
      this.error.textContent = 'Связь с залом прервалась. Войди снова.'; this.error.hidden = false;
    });
  }
}
