import type { Account } from '../../server/accounts';
import type { RoomScene } from '../game/RoomScene';
import { SKIN_VARIANTS, skinAssetUrl, type SkinCard, type SkinStudioSnapshot } from '../shared/skinStudio';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { demoWallet } from '../wallet/WalletClient';
import { tailorPortrait } from '../game/atelierArt';
import './skin-studio.css';

const statuses = {
  reserving: 'Резервируем $10…', generating: 'Рисуем два образа…',
  capturing: 'Подтверждаем оплату…', ready: '',
  selected: '', refunding: 'Возвращаем $10…', failed: '',
};
type Pending = { id: string; prompt: string };
export class SkinStudioUI {
  readonly dialog = document.createElement('dialog');
  private button = document.createElement('button');
  private data?: SkinStudioSnapshot;
  private accountId: string | null = null;
  private epoch = 0;
  private busy = false;
  private selected = '';
  private pending?: Pending;
  private poll?: ReturnType<typeof setTimeout>;
  private walletPoll?: ReturnType<typeof setTimeout>;
  private message = '';
  private failedRequest = false;
  private status = document.createElement('p');
  private variants = document.createElement('div');
  private wardrobe = document.createElement('div');
  private prompt = document.createElement('textarea');
  private generate = document.createElement('button');
  private choose = document.createElement('button');
  constructor(private scene: RoomScene, private account: () => Account | null, private accountChanged: () => Promise<void>) {
    this.button.type = 'button'; this.button.className = 'logout-button'; this.button.textContent = 'Образы'; this.button.hidden = true;
    this.button.onclick = () => { void this.open(); }; document.querySelector('.profile')!.append(this.button);
    this.scene.onAtelier = () => { void this.open(); };
    this.dialog.id = 'skin-studio-dialog'; this.dialog.className = 'skin-studio'; this.dialog.setAttribute('aria-labelledby', 'skin-studio-title');
    this.dialog.innerHTML = `<div class="skin-studio-heading"><div class="skin-studio-identity"><div class="skin-tailor-portrait"></div><div><h2 id="skin-studio-title">Ателье</h2><span class="eyebrow">Южный парк</span></div></div><button type="button" class="icon-button" aria-label="Закрыть ателье">×</button></div>
      <form><label for="skin-prompt">Опиши новый образ</label><div class="skin-prompt-slot"></div><div class="skin-studio-price"><span class="skin-offer">2 варианта · 1 навсегда</span><p class="skin-balance" aria-live="polite"></p></div><div class="skin-generate-slot"></div></form>
      <div class="skin-status-slot"></div><button type="button" class="text-button skin-refresh" hidden>Проверить статус</button><section class="skin-results" hidden><h3>Выбери один образ</h3><div class="skin-variants-slot"></div><div class="skin-choose-slot"></div></section>
      <section class="skin-wardrobe" hidden><h3>Гардероб</h3><div class="skin-wardrobe-slot"></div></section>`;
    this.dialog.querySelector('.skin-tailor-portrait')!.append(tailorPortrait());
    this.prompt.id = 'skin-prompt'; this.prompt.maxLength = 1000; this.prompt.rows = 3; this.prompt.required = true;
    this.prompt.placeholder = 'Например: гангстер в бордовом костюме';
    this.prompt.setAttribute('aria-describedby', 'skin-status');
    this.dialog.querySelector('.skin-prompt-slot')!.append(this.prompt);
    this.generate.type = 'submit'; this.generate.className = 'primary-button'; this.generate.textContent = 'Создать за $10';
    this.dialog.querySelector('.skin-generate-slot')!.append(this.generate);
    this.status.id = 'skin-status'; this.status.hidden = true; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.dialog.querySelector('.skin-status-slot')!.append(this.status);
    this.variants.className = 'skin-card-grid'; this.dialog.querySelector('.skin-variants-slot')!.append(this.variants);
    this.wardrobe.className = 'skin-card-grid skin-closet-grid'; this.dialog.querySelector('.skin-wardrobe-slot')!.append(this.wardrobe);
    this.choose.type = 'button'; this.choose.className = 'primary-button'; this.choose.textContent = 'Сохранить образ';
    this.choose.onclick = () => { void this.perform(async () => {
      const job = this.data?.job; if (!job || !this.selected) return;
      await this.send('/choose', { jobId: job.id, skinId: this.selected });
      await this.accountChanged(); this.message = 'Образ сохранён и надет.';
    }); };
    this.dialog.querySelector('.skin-choose-slot')!.append(this.choose);
    this.dialog.querySelector('.icon-button')!.addEventListener('click', () => this.dialog.close());
    this.dialog.querySelector('.skin-refresh')!.addEventListener('click', () => { void this.perform(() => this.refresh()); });
    this.dialog.addEventListener('close', () => { clearTimeout(this.poll); clearTimeout(this.walletPoll); this.scene.setLocked(Boolean(document.querySelector('dialog[open]'))); });
    this.dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault(); void this.perform(async () => {
        const user = this.account(), epoch = this.epoch; if (!user) return;
        if (!this.pending) {
          await this.send('');
          if (epoch !== this.epoch) throw new Error('Аккаунт изменился.');
          const operation = { id: crypto.randomUUID(), prompt: this.prompt.value.trim() };
          // Persist before sending so a lost HTTP response cannot charge another generation.
          sessionStorage.setItem(this.key(), JSON.stringify(operation)); this.pending = operation;
        }
        await this.send('/generations', this.pending);
        this.pending = undefined; sessionStorage.removeItem(this.key());
      });
    });
    document.body.append(this.dialog);
    window.addEventListener('royal-account', () => {
      const id = this.account()?.id ?? null;
      this.button.hidden = !id || this.account()?.skin === null;
      if (id === this.accountId) return;
      this.epoch++; this.busy = false; this.accountId = id; this.data = undefined; this.pending = undefined; this.selected = ''; this.prompt.value = '';
      this.message = ''; this.failedRequest = false; clearTimeout(this.poll); clearTimeout(this.walletPoll); this.dialog.close();
      if (id) try { this.pending = JSON.parse(sessionStorage.getItem(this.key()) || 'null') ?? undefined; } catch { /* No stored request. */ }
    });
  }
  private key() { return 'royal-skin-generation:' + this.accountId; }
  async open() {
    if (!this.accountId) { this.scene.onNotice?.('Войди в аккаунт, чтобы заказать образ в ателье.'); return; }
    this.scene.setLocked(true); if (!this.dialog.open) this.dialog.showModal();
    await this.perform(() => this.refresh()); this.prompt.focus();
  }
  private async send(path: string, body?: unknown) {
    const epoch = this.epoch, id = this.accountId;
    const response = await fetch('/api/skin-studio' + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(20000),
      headers: { [WALLET_ACCOUNT_HEADER]: id ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (epoch !== this.epoch) throw new Error('Аккаунт изменился.');
    if (!response.ok) {
      if (path === '/generations' && [400, 401, 403, 409, 413, 429].includes(response.status)) {
        this.pending = undefined; sessionStorage.removeItem(this.key());
      }
      throw new Error(result.error || 'Не удалось проверить образ.');
    }
    if (!result.theme || !Array.isArray(result.wardrobe)) throw new Error('Не удалось прочитать гардероб.');
    this.data = result as SkinStudioSnapshot;
    if (this.pending?.id === this.data.job?.id) { this.pending = undefined; sessionStorage.removeItem(this.key()); }
    if (!this.data.job?.variants.some(card => card.id === this.selected)) this.selected = '';
    this.render(); this.schedule(); void this.syncWallet();
  }
  private async refresh() {
    await this.send('');
  }
  private async syncWallet(attempt = 0) {
    clearTimeout(this.walletPoll);
    const epoch = this.epoch;
    if (!this.dialog.open || demoWallet.accountId !== this.accountId) return;
    await demoWallet.refresh();
    if (epoch !== this.epoch || !this.dialog.open) return;
    const wallet = demoWallet.wallet;
    this.dialog.querySelector('.skin-balance')!.textContent = wallet
      ? `Общий баланс: $${wallet.balance.toFixed(2)}` : 'Обновляем баланс…';
    this.walletPoll = setTimeout(() => { void this.syncWallet(wallet ? 0 : attempt + 1); }, wallet ? 10000 : Math.min(15000, 2000 * (1 + Math.floor(attempt / 5))));
  }
  private schedule() {
    clearTimeout(this.poll);
    if (this.dialog.open && this.data?.job && ['reserving', 'generating', 'capturing', 'refunding'].includes(this.data.job.state))
      this.poll = setTimeout(() => { void this.perform(() => this.refresh()); }, 2500);
  }
  private async perform(action: () => Promise<void>) {
    if (this.busy) return;
    const epoch = this.epoch; this.busy = true; this.message = ''; this.failedRequest = false; this.render();
    try { await action(); }
    catch (error) {
      if (epoch === this.epoch) {
        this.failedRequest = true;
        this.message = error instanceof Error && /[а-я]/i.test(error.message) ? error.message : 'Нет ответа. Повторной оплаты не будет.';
      }
    } finally { if (epoch === this.epoch) { this.busy = false; this.render(); this.schedule(); } }
  }
  private render() {
    const job = this.data?.job;
    const active = job && ['reserving', 'generating', 'capturing', 'ready', 'refunding'].includes(job.state);
    const generating = job && ['reserving', 'generating', 'capturing'].includes(job.state);
    const count = active ? job.variantCount ?? (job.variants.length || SKIN_VARIANTS) : this.data?.variantCount ?? SKIN_VARIANTS;
    this.dialog.querySelector('.skin-offer')!.textContent = `${count} варианта · 1 навсегда`;
    this.variants.dataset.variantCount = String(count);
    this.prompt.disabled = this.busy || !!active || !!this.pending;
    this.generate.disabled = this.busy || !!active || (!this.data?.enabled && !this.pending);
    // Background status requests must not change the label or width of an active generation button.
    this.generate.textContent = generating ? 'Создаём образы…' : job?.state === 'refunding' ? statuses.refunding
      : this.pending ? 'Проверить отправленный запрос' : this.busy ? 'Проверяем…' : 'Создать за $10';
    this.status.textContent = this.message || (job?.error && ['failed', 'refunding'].includes(job.state) ? job.error
      : job?.state === 'generating' && count === 3 ? 'Рисуем три образа…' : job ? statuses[job.state] : this.data && !this.data.enabled ? 'Генерация временно недоступна.' : '');
    this.status.hidden = !this.status.textContent;
    const refresh = this.dialog.querySelector<HTMLButtonElement>('.skin-refresh')!;
    refresh.hidden = !this.failedRequest; refresh.disabled = this.busy;
    const results = this.dialog.querySelector<HTMLElement>('.skin-results')!; results.hidden = job?.state !== 'ready';
    // Keep preview controls and keyboard focus stable during polling and selection.
    const variantKey = job?.variants.map(c => c.id).join(',') ?? '';
    if (this.variants.dataset.cards !== variantKey) {
      this.variants.dataset.cards = variantKey; this.variants.replaceChildren(...(job?.variants ?? []).map((card, i) => this.card(card, i, false)));
    }
    this.variants.querySelectorAll<HTMLButtonElement>('[data-select-skin]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.selectSkin === this.selected)); button.disabled = this.busy;
    });
    this.choose.disabled = this.busy || !this.selected;
    const closetKey = (this.data?.wardrobe.map(c => c.id).join(',') ?? '') + ':' + this.data?.equippedId;
    this.dialog.querySelector<HTMLElement>('.skin-wardrobe')!.hidden = !this.data?.wardrobe.length;
    if (this.wardrobe.dataset.cards !== closetKey) {
      this.wardrobe.dataset.cards = closetKey;
      this.wardrobe.replaceChildren(...(this.data?.wardrobe ?? []).map((card, i) => this.card(card, i, true)));
    }
    this.wardrobe.querySelectorAll<HTMLButtonElement>('[data-equip-skin]').forEach(b => { b.disabled = this.busy || b.dataset.equipSkin === this.data?.equippedId; });
  }
  private card(card: SkinCard, index: number, owned: boolean) {
    const article = document.createElement('article'); article.className = 'skin-card';
    const title = document.createElement('h4'); title.textContent = owned ? `Образ ${index + 1}` : `Вариант ${index + 1}`;
    const preview = document.createElement('div'); preview.className = 'skin-preview';
    const art = document.createElement('div'); art.className = 'skin-preview-art'; art.style.backgroundImage = `url("${skinAssetUrl(card.id)}")`;
    art.setAttribute('role', 'img'); art.setAttribute('aria-label', title.textContent + ', спереди'); preview.append(art);
    const image = new Image(); image.src = skinAssetUrl(card.id); image.onerror = () => { preview.classList.add('skin-image-error'); art.setAttribute('aria-label', 'Изображение недоступно. Обнови ателье.'); };
    const turn = document.createElement('select'); turn.setAttribute('aria-label', `Поворот: ${title.textContent}`);
    for (const [row, label] of ['Спереди', 'Слева', 'Справа', 'Сзади'].entries()) turn.add(new Option(label, String(row)));
    turn.onchange = () => { art.style.backgroundPositionY = `${Number(turn.value) * 100 / 3}%`; art.setAttribute('aria-label', title.textContent + ', ' + turn.selectedOptions[0].text); };
    const action = document.createElement('select'); action.setAttribute('aria-label', `Поза: ${title.textContent}`);
    for (const [col, label] of ['Стоит', 'Шаг левой', 'Шаг правой', 'Сидит'].entries()) action.add(new Option(label, String(col)));
    action.onchange = () => { art.style.backgroundPositionX = `${Number(action.value) * 100 / 3}%`; };
    const controls = document.createElement('div'); controls.className = 'skin-preview-controls'; controls.append(turn, action);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'skin-select';
    if (owned) {
      button.dataset.equipSkin = card.id; button.textContent = card.id === this.data?.equippedId ? 'Сейчас надет' : 'Надеть';
      button.onclick = () => { void this.perform(async () => { await this.send('/equip', { skinId: card.id }); await this.accountChanged(); }); };
      const description = document.createElement('p'); description.className = 'skin-card-description'; description.textContent = card.prompt; description.title = card.prompt;
      article.append(title, preview, controls, description, button);
    } else {
      button.dataset.selectSkin = card.id; button.textContent = `Выбрать вариант ${index + 1}`; button.setAttribute('aria-pressed', 'false');
      button.onclick = () => { this.selected = card.id; this.render(); };
      article.append(title, preview, controls, button);
    }
    return article;
  }
}
