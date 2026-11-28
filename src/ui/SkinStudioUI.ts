import type { Account } from '../../server/accounts';
import type { PlayerControls } from './PlayerControls';
import { SKIN_VARIANTS,SKIN_OFFERS,SKIN_PRICE_UNITS,type SkinOfferId, skinAssetUrl } from '../shared/skinStudio';
import type { SkinDescriptionCard as SkinCard, SkinDescribedSnapshot as SkinStudioSnapshot } from '../shared/skinDescription';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { demoWallet } from '../wallet/WalletClient';
import {toiletMerchantPortrait} from '../game/ToiletMerchant';
import { tailorPortrait, ATELIER_SPRITE } from '../game/atelierArt';
import { SkinFittingRoom } from './SkinFittingRoom';
import './skin-studio.css';
import { t, tr } from '../i18n/index';

const statuses = {
  reserving: '', generating: 'Рисуем два образа…',
  capturing: 'Подтверждаем оплату…', ready: '',
  selected: '', refunding: '', failed: '',
};
type Pending = { id: string; prompt: string; rewardGrantId?:string;offerId?:SkinOfferId };
/** A shop takes new orders at its counter. The wardrobe, opened from the profile, only tries on and equips. */
export type SkinStudioView = SkinOfferId | 'wardrobe';
type Tab = 'order' | 'wardrobe';
const hook = '<svg class="skin-hook" width="30" height="26" viewBox="0 0 34 30" aria-hidden="true"><path d="M12 8 A5 5 0 1 1 17 13 L17 15 L3 27 L31 27 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const scissors = '<svg class="skin-scissors" width="30" height="30" viewBox="0 0 34 34" aria-hidden="true"><circle cx="8" cy="26" r="5" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="26" cy="26" r="5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M11 22 L27 4 M23 22 L7 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
const activeStates = ['reserving', 'generating', 'capturing', 'ready', 'refunding'];
const generatingStates = ['reserving', 'generating', 'capturing'];

export class SkinStudioUI {
  readonly dialog = document.createElement('dialog');
  private button = document.createElement('button');
  private data?: SkinStudioSnapshot;
  private offerId:SkinOfferId='atelier';
  private mode: 'shop' | 'wardrobe' = 'shop';
  private tab: Tab = 'order';
  private tabChosen = false;
  private accountId: string | null = null;
  private epoch = 0;
  private busy = false;
  private selected = '';
  private closetPick = '';
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
  private equip = document.createElement('button');
  private fitting: SkinFittingRoom;
  private trying = '';
  private fittingJob = '';
  private lastJobState = '';
  private requestId = 0;
  constructor(private scene: PlayerControls, private account: () => Account | null, private accountChanged: () => Promise<void>) {
    this.fitting = new SkinFittingRoom(() => this.scene.getReducedMotion?.() ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.button.type = 'button'; this.button.id = 'skin-studio-button'; this.button.className = 'logout-button'; this.button.textContent = t('Гардероб'); this.button.hidden = true;
    this.button.onclick = () => { void this.open('wardrobe'); }; document.querySelector('.profile')!.append(this.button);
    this.scene.onAtelier = () => { void this.open('atelier'); };
    this.scene.onToiletMerchant=()=>{void this.open('janitor');};
    this.dialog.id = 'skin-studio-dialog'; this.dialog.className = 'skin-studio'; this.dialog.setAttribute('aria-labelledby', 'skin-studio-title');
    this.dialog.innerHTML = t(`<div class="skin-studio-heading"><div class="skin-tailor-portrait"></div><div class="skin-heading-text"><span class="eyebrow skin-eyebrow"></span><h2 id="skin-studio-title">Ателье</h2></div>${scissors}<p class="skin-balance" aria-live="polite"></p><button type="button" class="icon-button skin-close" aria-label="Закрыть ателье">×</button></div>
      <p class="skin-disguise-help" hidden>Пока на тебе метка, надетый образ Жоры скрывает тебя от охраны. Новое нарушение раскрывает этот образ.</p>
      <div class="skin-studio-body"><div class="skin-fitting-slot"></div><div class="skin-studio-main">
        <div class="skin-tabs" role="tablist" aria-label="Разделы ателье"><button type="button" role="tab" id="skin-tab-order" data-skin-tab="order" aria-controls="skin-panel-order"><span class="skin-tab-label">Новый образ</span></button><button type="button" role="tab" id="skin-tab-wardrobe" data-skin-tab="wardrobe" aria-controls="skin-panel-wardrobe">Гардероб <span class="skin-count"></span></button></div>
        <div class="skin-status-slot"></div><button type="button" class="text-button skin-refresh" hidden>Проверить статус</button>
        <section class="skin-panel" id="skin-panel-order" role="tabpanel" aria-labelledby="skin-tab-order">
          <form><h3>Что сшить?</h3><p class="skin-lead">Портной нарисует персонажа заново по твоему описанию: лицо, причёску и одежду.</p>
            <label for="skin-prompt">Опиши новый образ</label><div class="skin-prompt-slot"></div>
            <div class="skin-studio-price"><div><span>Цена заказа</span><strong class="skin-price"></strong></div><div><span>Нарисуют</span><strong class="skin-offer">2 варианта · 1 навсегда</strong></div></div>
            <p class="skin-free-generations" aria-live="polite" hidden></p><p class="skin-existing-order" hidden></p><div class="skin-generate-slot"></div>
            <p class="skin-note">Деньги спишутся один раз. Если рисунок не получится, они вернутся на баланс.</p></form>
          <section class="skin-progress" hidden><h3>Заказ у портного</h3><p class="skin-recap"></p><ol class="skin-steps"></ol><p class="skin-note">Можно закрыть окно и погулять по клубу: заказ дождётся тебя.</p></section>
          <section class="skin-results" hidden><h3>Примерь и выбери один образ</h3><p class="skin-lead skin-results-lead">Нажми на вариант, и он сразу окажется на тебе в примерочной.</p><p class="skin-recap"></p><div class="skin-rail"><div class="skin-variants-slot"></div></div><div class="skin-choose-slot"></div></section>
        </section>
        <section class="skin-panel skin-wardrobe" id="skin-panel-wardrobe" role="tabpanel" aria-labelledby="skin-tab-wardrobe"><h3>Твои образы</h3><p class="skin-lead">Нажми на образ, чтобы примерить. Надеть можно любой из сохранённых.</p>
          <p class="skin-empty" hidden>Сохранённых образов пока нет. Новый образ шьёт портной в ателье.</p><div class="skin-rail"><div class="skin-wardrobe-slot"></div></div><div class="skin-equip-slot"></div>
          <div class="skin-goto" hidden><img alt="" width="1188" height="829"><div><strong></strong><span></span></div><button type="button" class="skin-goto-button"></button></div></section>
      </div></div>`);
    this.dialog.querySelector('.skin-tailor-portrait')!.append(tailorPortrait());
    this.dialog.querySelector<HTMLImageElement>('.skin-goto img')!.src = ATELIER_SPRITE;
    this.prompt.id = 'skin-prompt'; this.prompt.maxLength = 1000; this.prompt.rows = 3; this.prompt.required = true;
    this.prompt.placeholder = t('Например: гангстер в бордовом костюме');
    this.prompt.setAttribute('aria-describedby', 'skin-status');
    this.dialog.querySelector('.skin-prompt-slot')!.append(this.prompt);
    this.generate.type = 'submit'; this.generate.className = 'primary-button'; this.generate.textContent = 'Создать за $1';
    this.dialog.querySelector('.skin-generate-slot')!.append(this.generate);
    this.status.id = 'skin-status'; this.status.hidden = true; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.dialog.querySelector('.skin-status-slot')!.append(this.status);
    this.variants.className = 'skin-card-grid'; this.dialog.querySelector('.skin-variants-slot')!.append(this.variants);
    this.wardrobe.className = 'skin-card-grid skin-closet-grid'; this.dialog.querySelector('.skin-wardrobe-slot')!.append(this.wardrobe);
    this.choose.type = 'button'; this.choose.className = 'primary-button skin-choose';
    this.choose.onclick = () => { void this.perform(async () => {
      const job = this.data?.job; if (!job || !this.selected) return;
      await this.send('/choose', { jobId: job.id, skinId: this.selected });
      await this.accountChanged(); this.message = t('Образ сохранён и надет.'); this.tab = 'wardrobe'; this.closetPick = '';
    }); };
    this.dialog.querySelector('.skin-choose-slot')!.append(this.choose);
    this.equip.type = 'button'; this.equip.className = 'primary-button skin-equip';
    this.equip.onclick = () => { const id = this.equip.dataset.equipSkin; if (id) void this.perform(async () => { await this.send('/equip', { skinId: id }); await this.accountChanged(); }); };
    this.dialog.querySelector('.skin-equip-slot')!.append(this.equip);
    this.dialog.querySelector('.skin-fitting-slot')!.append(this.fitting.element);
    this.dialog.querySelector('.skin-close')!.addEventListener('click', () => this.dialog.close());
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-skin-tab]').forEach(tab => tab.addEventListener('click', () => {
      this.tab = tab.dataset.skinTab as Tab; this.tabChosen = true; this.render();
    }));
    this.dialog.querySelector('.skin-tabs')!.addEventListener('keydown', event => {
      const key = (event as KeyboardEvent).key; if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      const tabs = Array.from(this.dialog.querySelectorAll<HTMLButtonElement>('[data-skin-tab]')), next = tabs[(tabs.indexOf(document.activeElement as HTMLButtonElement) + 1) % tabs.length];
      next?.focus(); next?.click();
    });
    this.dialog.querySelector('.skin-goto-button')!.addEventListener('click', () => this.goToAtelier());
    this.dialog.querySelector('.skin-refresh')!.addEventListener('click', () => { void this.perform(() => this.refresh()); });
    this.dialog.addEventListener('close', () => { this.fitting.setActive(false); clearTimeout(this.poll); clearTimeout(this.walletPoll); this.scene.setLocked(Boolean(document.querySelector('dialog[open]'))); });
    this.dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault(); if (this.mode !== 'shop') return;
      void this.perform(async () => {
        const user = this.account(), epoch = this.epoch; if (!user) return;
        if (!this.pending) {
          await this.send('');
          if (epoch !== this.epoch) throw new Error('Аккаунт изменился.');
          const grant=this.offerId==='atelier'?this.data?.freeGenerations?.find(g=>g.remaining>0):undefined;
          const operation:Pending = { id: crypto.randomUUID(), prompt: this.prompt.value.trim(),offerId:this.offerId,...(grant?{rewardGrantId:grant.id}:{}) };
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
      this.epoch++; this.busy = false; this.accountId = id; this.data = undefined; this.pending = undefined; this.selected = ''; this.closetPick = ''; this.prompt.value = '';
      this.trying = ''; this.fittingJob = ''; this.lastJobState = ''; this.fitting.setSkin('', '');
      this.message = ''; this.failedRequest = false; clearTimeout(this.poll); clearTimeout(this.walletPoll); this.dialog.close();
      if (id) try { this.pending = JSON.parse(sessionStorage.getItem(this.key()) || 'null') ?? undefined; } catch { /* No stored request. */ }
    });
  }
  private key() { return 'royal-skin-generation:' + this.accountId; }
  async open(view:SkinStudioView='atelier') {
    const offerId: SkinOfferId = view === 'wardrobe' ? 'atelier' : view;
    if(this.offerId!==offerId){this.epoch++;this.busy=false;this.data=undefined;this.message='';this.failedRequest=false;clearTimeout(this.poll);clearTimeout(this.walletPoll);}
    this.offerId=offerId; this.mode = view === 'wardrobe' ? 'wardrobe' : 'shop';
    this.tab = this.mode === 'wardrobe' ? 'wardrobe' : 'order'; this.tabChosen = false;
    this.dialog.dataset.offer=offerId; this.dialog.dataset.mode=this.mode;
    const janitor=view==='janitor', closet=view==='wardrobe';
    this.dialog.querySelector<HTMLElement>('.skin-disguise-help')!.hidden=!janitor;
    this.dialog.querySelector('#skin-studio-title')!.textContent=t(closet?'Гардероб':janitor?'Жора: образы':'Ателье');
    this.dialog.querySelector('.skin-eyebrow')!.textContent=t(closet?'Профиль · твои образы':janitor?'Туалет · у Жоры':'1 этаж · у портного');
    this.dialog.querySelector('.skin-close')!.setAttribute('aria-label',t(closet?'Закрыть гардероб':janitor?'Закрыть образы Жоры':'Закрыть ателье'));
    const portrait = this.dialog.querySelector('.skin-tailor-portrait')!;
    if (closet) portrait.innerHTML = hook.replace('class="skin-hook"', 'class="skin-portrait-hook"'); else portrait.replaceChildren(janitor?toiletMerchantPortrait():tailorPortrait());
    this.fitting.setScene(janitor ? 'janitor' : 'atelier');
    if (!this.accountId) { this.scene.onNotice?.(t(closet?'Войди в аккаунт, чтобы открыть гардероб.':janitor?'Войди в аккаунт, чтобы заказать образ у Жоры.':'Войди в аккаунт, чтобы заказать образ в ателье.')); return; }
    this.scene.setLocked(true); if (!this.dialog.open) this.dialog.showModal();
    this.render();
    await this.perform(() => this.refresh());
    if (this.mode === 'shop' && !this.prompt.closest<HTMLElement>('form')!.hidden && !this.prompt.disabled) this.prompt.focus();
  }
  /** Closes first: the dialog's close handler unlocks the world, and only then can the walk start. */
  private goToAtelier() {
    if (this.scene.presentation === 'casino') {
      this.dialog.close(); document.querySelector<HTMLButtonElement>('.entry-mode-switcher [data-view-mode="club"]')?.click(); return;
    }
    this.dialog.addEventListener('close', () => { setTimeout(() => this.scene.goToAtelier?.(), 0); }, { once: true });
    this.dialog.close();
  }
  private async send(path: string, body?: unknown) {
    const epoch = this.epoch, id = this.accountId;
    const requestId = ++this.requestId;
    const response = await fetch('/api/skin-studio' + path+(this.offerId==='janitor'?'?offerId=janitor':''), { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(20000),
      headers: { [WALLET_ACCOUNT_HEADER]: id ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (epoch !== this.epoch) throw new Error('Аккаунт изменился.');
    if (requestId !== this.requestId) return;
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
      ? tr`Общий баланс: $${wallet.balance.toFixed(2)}` : t('Обновляем баланс…');
    this.walletPoll = setTimeout(() => { void this.syncWallet(wallet ? 0 : attempt + 1); }, wallet ? 10000 : Math.min(15000, 2000 * (1 + Math.floor(attempt / 5))));
  }
  private schedule() {
    clearTimeout(this.poll);
    const pendingDescription = [...(this.data?.job?.variants ?? []), ...(this.data?.wardrobe ?? [])].some(card => card.descriptionPending);
    const generating = this.data?.job && ['reserving', 'generating', 'capturing', 'refunding'].includes(this.data.job.state);
    if (this.dialog.open && (pendingDescription || generating)) this.poll = setTimeout(() => {
      if (this.busy) { this.schedule(); return; }
      if (generating) void this.perform(() => this.refresh());
      // Caption arrival must preserve the focused selection and never overwrite a later choice response.
      else void this.refresh().catch(() => this.schedule());
    }, 2500);
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
  /** Readable names come from the artwork description; numbering is only the fallback. */
  private cardName(card: SkinCard, index: number, owned: boolean) {
    return card.description?.trim() || (owned ? tr`Образ ${index + 1}` : tr`Вариант ${index + 1}`);
  }
  private render() {
    const job = this.data?.job, shop = this.mode === 'shop';
    const freeCount=(this.offerId==='atelier'?(this.data?.freeGenerations??[]):[]).reduce((n,g)=>n+g.remaining,0);
    const free=this.dialog.querySelector<HTMLElement>('.skin-free-generations')!;
    free.hidden=freeCount===0;free.textContent=tr`Бесплатных генераций за уровни: ${freeCount}`;
    const active = Boolean(job && activeStates.includes(job.state));
    const generating = Boolean(job && generatingStates.includes(job.state));
    const ready = job?.state === 'ready';
    const count = active ? job!.variantCount ?? (job!.variants.length || SKIN_VARIANTS) : this.data?.variantCount ?? SKIN_OFFERS[this.offerId].variantCount;
    const price=this.data?.priceUnits??SKIN_OFFERS[this.offerId].priceUnits;
    const jobPrice=job?.priceUnits??SKIN_PRICE_UNITS;
    const dollars=(units:string)=>String(Number(BigInt(units))/1000000);
    const refunding=tr`Возвращаем $${dollars(jobPrice)}…`;
    const reserving=tr`Резервируем $${dollars(jobPrice)}…`;
    this.dialog.querySelector('.skin-offer')!.textContent = count===1?t('1 образ · навсегда'):tr`${count} варианта · 1 навсегда`;
    this.dialog.querySelector('.skin-price')!.textContent = freeCount>0?t('Бесплатно'):'$'+dollars(price);
    this.dialog.querySelector('.skin-results h3')!.textContent=t(count===1?'Портной сшил образ':count===3?'Портной сшил три варианта':'Портной сшил два варианта');
    this.dialog.querySelector('.skin-results-lead')!.textContent=t(count===1?'Он уже на тебе в примерочной. Походи и сохрани, если нравится.':'Нажми на вариант, и он сразу окажется на тебе в примерочной. Забрать можно один.');
    const previous=this.dialog.querySelector<HTMLElement>('.skin-existing-order')!;
    previous.hidden=!active||(!job?.offerId||job.offerId===this.offerId)&&(job?.priceUnits===undefined||job.priceUnits===price||job.funding==='reward');
    previous.textContent=previous.hidden?'':tr`Ранее принятый заказ: ${t(job?.offerId==='janitor'?'Жора':'Ателье')}, $${dollars(jobPrice)}.`;
    this.dialog.querySelectorAll('.skin-recap').forEach(recap => { recap.textContent = job?.prompt ? t('Заказ: ') + '«' + job.prompt + '»' : ''; (recap as HTMLElement).hidden = !job?.prompt; });
    this.variants.dataset.variantCount = String(count);
    this.prompt.disabled = this.busy || active || !!this.pending;
    this.generate.disabled = this.busy || active || (!this.data?.enabled && !this.pending);
    // Background status requests must not change the label or width of an active generation button.
    this.generate.textContent = generating ? t(count===1?'Создаём образ…':'Создаём образы…') : job?.state === 'refunding' ? refunding
      : this.pending ? t('Проверить отправленный запрос') : this.busy ? t('Проверяем…') : freeCount>0?t('Создать бесплатно'):tr`Создать за $${dollars(price)}`;
    this.status.textContent = this.message || (job?.error && ['failed', 'refunding'].includes(job.state) ? job.error
      : job?.state==='reserving'?reserving:job?.state==='refunding'?refunding:job?.state==='generating'?t(count===1?'Рисуем один образ…':count===3?'Рисуем три образа…':'Рисуем два образа…'):job ? t(statuses[job.state]) : this.data && !this.data.enabled && shop ? t('Генерация временно недоступна.') : '');
    if(!this.message && job?.funding==='reward' && ['reserving','capturing','refunding'].includes(job.state))
      this.status.textContent=t(job.state==='refunding'?'Возвращаем бесплатную генерацию…':job.state==='reserving'?'Используем бесплатную генерацию…':'Подтверждаем бесплатную генерацию…');
    this.status.hidden = !this.status.textContent;
    const refresh = this.dialog.querySelector<HTMLButtonElement>('.skin-refresh')!;
    refresh.hidden = !this.failedRequest; refresh.disabled = this.busy;

    // Tabs: a shop always offers both; the wardrobe shows the order tab only while an order exists.
    if (!shop && ready && !this.tabChosen) this.tab = 'order';
    const tabs = this.dialog.querySelector<HTMLElement>('.skin-tabs')!;
    tabs.hidden = !shop && !active;
    if (tabs.hidden) this.tab = 'wardrobe';
    this.dialog.querySelector('.skin-tab-label')!.textContent = t(shop ? 'Новый образ' : 'Заказ у портного');
    this.dialog.querySelector('.skin-count')!.textContent = String(this.data?.wardrobe.length ?? 0);
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-skin-tab]').forEach(button => {
      const on = button.dataset.skinTab === this.tab; button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1;
    });
    this.dialog.querySelector<HTMLElement>('#skin-panel-order')!.hidden = this.tab !== 'order';
    this.dialog.querySelector<HTMLElement>('#skin-panel-wardrobe')!.hidden = this.tab !== 'wardrobe';
    this.dialog.querySelector('form')!.hidden = !shop || active;
    const progress = this.dialog.querySelector<HTMLElement>('.skin-progress')!;
    progress.hidden = !generating; if (generating) this.renderSteps(job!.state, count, job!.funding === 'reward', dollars(jobPrice));
    const results = this.dialog.querySelector<HTMLElement>('.skin-results')!; results.hidden = !ready;

    // Keep preview controls and keyboard focus stable during polling and selection.
    const variantKey = job?.variants.map(c => c.id).join(',') ?? '';
    if (this.variants.dataset.cards !== variantKey) {
      this.variants.dataset.cards = variantKey; this.variants.replaceChildren(...(job?.variants ?? []).map((card, i) => this.card(card, i, false)));
    }
    if(ready&&job!.variantCount===1&&job!.variants.length===1&&!this.selected)this.selected=job!.variants[0].id;
    const candidates = ready ? job!.variants : [];
    if (ready && this.fittingJob !== job!.id) {
      this.fittingJob = job!.id; this.trying = candidates[0]?.id ?? '';
    }
    const wardrobe = this.data?.wardrobe ?? [];
    const available = [...candidates, ...wardrobe];
    if (!available.some(card => card.id === this.trying)) this.trying = candidates[0]?.id ?? (wardrobe.find(card => card.id === this.data?.equippedId) ?? wardrobe[0])?.id ?? '';
    if (!wardrobe.some(card => card.id === this.closetPick)) this.closetPick = wardrobe.some(card => card.id === this.trying) ? this.trying : (wardrobe.find(card => card.id === this.data?.equippedId) ?? wardrobe[0])?.id ?? '';
    const selectedIndex = candidates.findIndex(card => card.id === this.selected);
    this.choose.disabled = this.busy || !this.selected;
    this.choose.textContent = selectedIndex >= 0 ? t('Забрать «') + this.cardName(candidates[selectedIndex], selectedIndex, false) + '»' : t('Забрать образ');

    const closetKey = wardrobe.map(c => c.id).join(',');
    this.dialog.querySelector<HTMLElement>('.skin-empty')!.hidden = wardrobe.length > 0;
    this.wardrobe.closest<HTMLElement>('.skin-rail')!.hidden = wardrobe.length === 0;
    if (this.wardrobe.dataset.cards !== closetKey) {
      this.wardrobe.dataset.cards = closetKey;
      this.wardrobe.replaceChildren(...wardrobe.map((card, i) => this.card(card, i, true)));
    }
    const pickIndex = wardrobe.findIndex(card => card.id === this.closetPick);
    this.equip.hidden = pickIndex < 0; this.equip.dataset.equipSkin = this.closetPick;
    const worn = this.closetPick === this.data?.equippedId;
    this.equip.disabled = this.busy || worn;
    this.equip.textContent = worn ? t('Сейчас надет') : pickIndex >= 0 ? t('Надеть «') + this.cardName(wardrobe[pickIndex], pickIndex, true) + '»' : '';

    this.dialog.querySelectorAll<HTMLButtonElement>('[data-skin-card]').forEach(button => {
      const owned = button.closest('.skin-closet-grid') !== null, list = owned ? wardrobe : candidates;
      const index = list.findIndex(row => row.id === button.dataset.skinCard), card = list[index];
      button.disabled = this.busy;
      if (!card) return;
      const name = this.cardName(card, index, owned);
      const summary = button.querySelector<HTMLElement>('.skin-card-description')!;
      summary.textContent = name; summary.title = name;
      const detail = button.querySelector<HTMLElement>('.skin-card-prompt')!;
      detail.textContent = owned && card.description ? card.prompt : ''; detail.hidden = !detail.textContent;
      // The short action label stays stable while the visible name (described-by) can arrive later.
      button.setAttribute('aria-label', owned ? tr`Примерить образ ${index + 1}` : tr`Примерить вариант ${index + 1}`);
      button.setAttribute('aria-pressed', String(owned ? card.id === this.closetPick : card.id === this.selected));
      const pill = button.querySelector<HTMLElement>('.skin-pill')!;
      pill.textContent = owned && card.id === this.data?.equippedId ? t('Надет') : card.id === this.trying ? t('На примерке') : '';
      pill.hidden = !pill.textContent; pill.dataset.kind = owned && card.id === this.data?.equippedId ? 'worn' : 'trying';
    });

    const goto = this.dialog.querySelector<HTMLElement>('.skin-goto')!;
    const casino = this.scene.presentation === 'casino';
    goto.hidden = shop || (!casino && !this.scene.goToAtelier);
    if (!goto.hidden) {
      const here = this.scene.hall === 'arcade';
      goto.querySelector('strong')!.textContent = t(casino ? 'Новые образы шьют в клубе' : here ? 'Новый образ шьёт портной' : 'Ателье на 1 этаже');
      goto.querySelector('span')!.textContent = t(casino ? 'В режиме «Сразу к играм» зала нет. Ателье на 1 этаже клуба с персонажем.'
        : here ? 'Ателье здесь, на 1 этаже, слева от двери наверх. Персонаж сам дойдёт до стойки.' : 'Метка на карте покажет дорогу до нужной двери, дальше иди сам.');
      goto.querySelector('button')!.textContent = t(casino ? 'Перейти в клуб' : here ? 'Идти к ателье' : 'Показать дорогу');
    }

    const triedCandidate = candidates.findIndex(card => card.id === this.trying), triedOwned = wardrobe.findIndex(card => card.id === this.trying);
    const label = triedCandidate >= 0 ? this.cardName(candidates[triedCandidate], triedCandidate, false) : triedOwned >= 0 ? this.cardName(wardrobe[triedOwned], triedOwned, true) : '';
    this.fitting.setSkin(this.trying, label, t(shop ? 'Сшитые варианты появятся здесь, на примерке' : 'Сохранённые образы можно примерить здесь'));
    this.fitting.setMood(this.offerId === 'atelier' && generating ? 'working' : 'idle');
    if (ready && this.lastJobState && this.lastJobState !== 'ready') this.fitting.setMood('greet');
    this.lastJobState = job?.state ?? '';
    this.fitting.setActive(this.dialog.open);
  }
  /** A real sequence: accepted, drawing, fitting. Payment wording follows the order's own funding. */
  private renderSteps(state: string, count: number, reward: boolean, price: string) {
    const position = state === 'reserving' ? 0 : state === 'generating' ? 1 : 2;
    const steps: [string, string][] = [
      [t('Заказ принят'), reward ? t('Используется бесплатная генерация за уровень') : tr`$${price} зарезервирован на общем балансе`],
      [t(count === 1 ? 'Рисуем образ' : count === 3 ? 'Рисуем три варианта' : 'Рисуем два варианта'), t('Каждый рисуется целиком: четыре стороны, ходьба и посадка')],
      [t('Примерка'), t(state === 'capturing' ? 'Подтверждаем оплату, варианты почти готовы' : count === 1 ? 'Образ появится на вешалке' : 'Варианты появятся на вешалке')],
    ];
    const list = this.dialog.querySelector('.skin-steps')!;
    if (list.childElementCount !== steps.length) list.replaceChildren(...steps.map(() => {
      const item = document.createElement('li'); item.className = 'skin-step';
      const dot = document.createElement('span'); dot.className = 'skin-step-dot'; dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div'); text.append(document.createElement('strong'), document.createElement('span'));
      item.append(dot, text); return item;
    }));
    Array.from(list.children).forEach((item, index) => {
      const state = index < position ? 'done' : index === position ? 'now' : 'next';
      (item as HTMLElement).dataset.state = state;
      if (state === 'now') item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.querySelector('.skin-step-dot')!.textContent = state === 'done' ? '✓' : String(index + 1);
      item.querySelector('strong')!.textContent = steps[index][0]; item.querySelector('div span')!.textContent = steps[index][1];
    });
  }
  private card(card: SkinCard, index: number, owned: boolean) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'skin-card'; button.dataset.skinCard = card.id;
    if (owned) button.dataset.closetSkin = card.id; else button.dataset.selectSkin = card.id;
    button.insertAdjacentHTML('afterbegin', hook);
    const pill = document.createElement('span'); pill.className = 'skin-pill'; pill.hidden = true;
    const preview = document.createElement('span'); preview.className = 'skin-preview';
    const art = document.createElement('span'); art.className = 'skin-preview-art'; art.style.backgroundImage = `url("${skinAssetUrl(card.id)}")`; preview.append(art);
    const image = new Image(); image.src = skinAssetUrl(card.id); image.onerror = () => { preview.classList.add('skin-image-error'); preview.dataset.error = t('Изображение недоступно'); };
    const description = document.createElement('span'); description.className = 'skin-card-description';
    description.id = `skin-card-name-${owned ? 'owned' : 'variant'}-${card.id}`; button.setAttribute('aria-describedby', description.id);
    const prompt = document.createElement('span'); prompt.className = 'skin-card-prompt'; prompt.hidden = true;
    button.append(pill, preview, description, prompt);
    button.onclick = () => {
      if (owned) this.closetPick = card.id; else this.selected = card.id;
      this.trying = card.id; this.render();
      this.fitting.element.scrollIntoView({ block: 'nearest' });
      this.fitting.element.querySelector('canvas')!.focus({ preventScroll: true });
    };
    return button;
  }
}
