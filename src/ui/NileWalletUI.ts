import type { RoomScene } from '../game/RoomScene';
import { NILE_WALLET_SCOPE, formatNileUnits, type NileWallet } from '../shared/nileWallet';
import { nilePlay, nileInviteCode } from '../wallet/NilePlayClient';
import type { NilePlayWallet } from '../shared/nilePlay';
import '../nile-wallet.css';

export class NileWalletUI {
  private button = document.createElement('button');
  private dialog = document.createElement('dialog');
  private accountId: string | null = null;
  private version = 0;
  private wallet?: NileWallet | NilePlayWallet;
  private poll?: ReturnType<typeof setInterval>;
  constructor(private scene: RoomScene) {
    this.button.type = 'button'; this.button.id = 'nile-wallet-button'; this.button.className = 'wallet-button'; this.button.hidden = true;
    this.button.textContent = 'Тестовый USDT · Nile'; this.button.setAttribute('aria-label', 'Открыть тестовый кошелёк Nile');
    this.button.onclick = () => this.show();
    document.querySelector('.profile')!.prepend(this.button);
    this.dialog.id = 'nile-wallet-dialog'; this.dialog.className = 'wallet-dialog'; this.dialog.setAttribute('aria-labelledby', 'nile-wallet-title');
    this.dialog.innerHTML = `<div class="wallet-heading"><div><span class="eyebrow">ТЕСТОВАЯ СЕТЬ NILE</span><h2 id="nile-wallet-title">Тестовый USDT</h2></div><button class="icon-button" id="nile-wallet-close" aria-label="Закрыть тестовый кошелёк">×</button></div>
      <p id="nile-wallet-description" class="wallet-description">Это бесплатные тестовые токены. Они не имеют денежной стоимости. Ставки, переводы и вывод этого баланса пока недоступны.</p>
      <button id="nile-wallet-deposit" type="button" class="primary-button" hidden>Получить адрес пополнения</button>
      <form id="nile-wallet-claim" hidden><label for="nile-wallet-code">Код подключения тестового кошелька</label><input id="nile-wallet-code" autocomplete="off" spellcheck="false" maxlength="43" required><button type="submit" class="primary-button">Подключить тестовый кошелёк</button></form>
      <p id="nile-wallet-message" role="status">Загрузка…</p>
      <section id="nile-wallet-content" hidden><p class="wallet-total"><strong id="nile-wallet-balance"></strong><span>USDT в тестовой сети Nile</span></p>
        <label for="nile-wallet-address">Твой адрес для тестового пополнения</label><input id="nile-wallet-address" readonly spellcheck="false" autocomplete="off"><button id="nile-wallet-copy" class="text-button">Скопировать адрес</button>
        <p class="wallet-note">Используй только USDT из крана Nile. Адрес имеет такой же формат, как в основной сети TRON: реальные USDT сюда отправлять нельзя.</p>
        <a class="text-button" href="https://nileex.io/join/getJoinPage" target="_blank" rel="noopener noreferrer">Получить тестовые USDT</a>
        <p id="nile-wallet-updated" class="wallet-description"></p><h3>Подтверждённые поступления</h3><ol id="nile-wallet-history"></ol>
        <section id="nile-wallet-rounds-section" hidden><h3>Royal Coins: последние ставки</h3><ol id="nile-wallet-rounds"></ol></section></section>
      <button id="nile-wallet-refresh" class="primary-button">Обновить тестовый баланс</button>`;
    document.body.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('#nile-wallet-close')!.onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => { clearInterval(this.poll); this.version++; scene.setLocked(!!document.querySelector('dialog[open]')); });
    this.dialog.querySelector<HTMLButtonElement>('#nile-wallet-deposit')!.onclick=()=>{void this.refresh(true);};
    nilePlay.addEventListener('change',()=>{const wallet=nilePlay.wallet;this.button.textContent=wallet?.state==='assigned'&&wallet.ready?formatNileUnits(wallet.balanceUnits)+' USDT · Nile':'Тестовый USDT · Nile';});
    this.dialog.querySelector<HTMLButtonElement>('#nile-wallet-refresh')!.onclick = () => { void this.refresh(); };
    this.dialog.querySelector<HTMLFormElement>('#nile-wallet-claim')!.onsubmit = event => {
      event.preventDefault(); const version=this.version,account=this.accountId,button=this.dialog.querySelector<HTMLButtonElement>('#nile-wallet-claim button')!;
      button.disabled=true;
      void nilePlay.claim(this.dialog.querySelector<HTMLInputElement>('#nile-wallet-code')!.value.trim()).then(()=>{if(version===this.version&&account===this.accountId)void this.refresh();}).catch(e=>{if(version===this.version&&account===this.accountId)this.message((e as Error).message);}).finally(()=>{button.disabled=false;});
    };
    this.dialog.querySelector<HTMLButtonElement>('#nile-wallet-copy')!.onclick = async () => {
      if (this.wallet?.state !== 'assigned') return;
      const accountId = this.accountId, version = this.version;
      try { await navigator.clipboard.writeText(this.wallet.address); if (accountId === this.accountId && version === this.version) this.message('Адрес скопирован. Используй только тестовую сеть Nile.'); }
      catch { if (accountId === this.accountId && version === this.version) this.message('Выдели адрес в поле и скопируй его вручную.'); }
    };
    window.addEventListener('royal-account', event => {
      this.version++; this.accountId = (event as CustomEvent<string | null>).detail; this.wallet = undefined;
      nilePlay.setAccount(this.accountId);
      this.button.hidden = !this.accountId; this.clear(); this.dialog.close();
    });
    window.addEventListener('royal-open-nile-wallet',()=>this.show());
    window.addEventListener('focus',()=>{void nilePlay.refresh();});
  }
  private show(){if(!this.accountId)return;this.scene.setLocked(true);if(!this.dialog.open)this.dialog.showModal();clearInterval(this.poll);this.poll=setInterval(()=>{if(!nilePlay.busy)void this.refresh(false,true);},10000);void this.refresh(true);}
  private message(text: string) { this.dialog.querySelector('#nile-wallet-message')!.textContent = text; }
  private clear() {
    this.dialog.querySelector<HTMLElement>('#nile-wallet-content')!.hidden = true;
    this.dialog.querySelector<HTMLInputElement>('#nile-wallet-address')!.value = '';
    this.dialog.querySelector('#nile-wallet-balance')!.textContent = '';
    this.dialog.querySelector('#nile-wallet-history')!.replaceChildren();
    this.dialog.querySelector('#nile-wallet-rounds')!.replaceChildren();
    this.dialog.querySelector<HTMLElement>('#nile-wallet-deposit')!.hidden=true;
    this.dialog.querySelector<HTMLElement>('#nile-wallet-claim')!.hidden=true;
    this.dialog.querySelector<HTMLElement>('#nile-wallet-rounds-section')!.hidden=true;
  }
  private async refresh(ensureAddress=false,quiet=false) {
    if (!this.accountId || !this.dialog.open) return;
    const version = ++this.version; if(!quiet){this.wallet = undefined; this.clear(); this.message('Проверяем тестовый баланс…');}
    try {
      await nilePlay.refresh();if(version!==this.version||!this.dialog.open)return;
      if(nilePlay.error)throw new Error(nilePlay.error);
      if(ensureAddress&&nilePlay.wallet?.state==='unassigned'&&!nileInviteCode()){await nilePlay.deposit();if(version!==this.version||!this.dialog.open)return;}
      const play=nilePlay.wallet;
      if(play&&play.state!=='disabled'){
        this.dialog.querySelector('#nile-wallet-description')!.textContent='Пополняй баланс тестовыми USDT в сети Nile. Поступления зачисляются автоматически после подтверждения. Токены бесплатны, вывод недоступен.';
        if(play.state==='unassigned'){
          this.dialog.querySelector<HTMLElement>('#nile-wallet-claim')!.hidden=!nileInviteCode();
          this.dialog.querySelector<HTMLElement>('#nile-wallet-deposit')!.hidden=!!nileInviteCode();
          this.dialog.querySelector<HTMLInputElement>('#nile-wallet-code')!.value=nileInviteCode();
          this.message('Нажми «Получить адрес пополнения» и отправь на него тестовый USDT из сети Nile.');return;
        }
        if(!play.ready)throw new Error('Подтверждение баланса временно недоступно. Обнови кошелёк позже.');
        this.clear();this.wallet=play;this.dialog.querySelector<HTMLElement>('#nile-wallet-content')!.hidden=false;
        this.dialog.querySelector('#nile-wallet-balance')!.textContent=formatNileUnits(play.balanceUnits);
        this.dialog.querySelector<HTMLInputElement>('#nile-wallet-address')!.value=play.address;
        this.dialog.querySelector('#nile-wallet-updated')!.textContent='Игровой баланс. Подтверждено: '+new Date(play.updatedAt).toLocaleString('ru-RU')+(play.reserveAllocatedUnits!=='0'?` · В резерв выплат выделено ${formatNileUnits(play.reserveAllocatedUnits)} USDT (Nile).`:'');
        for(const entry of play.deposits){
          const row=document.createElement('li'),amount=document.createElement('strong'),detail=document.createElement('small');
          amount.textContent='+'+formatNileUnits(entry.playerUnits)+' USDT (Nile) на игровой баланс';
          detail.textContent=`Блок ${entry.height} · ${entry.txId}`+(entry.reserveUnits!=='0'?` · ${formatNileUnits(entry.reserveUnits)} USDT выделено в резерв`: '');row.append(amount,detail);this.dialog.querySelector('#nile-wallet-history')!.append(row);
        }
        this.dialog.querySelector<HTMLElement>('#nile-wallet-rounds-section')!.hidden=false;
        const history=this.dialog.querySelector('#nile-wallet-rounds')!;
        for(const round of play.rounds){const row=document.createElement('li'),amount=document.createElement('strong'),detail=document.createElement('small');amount.textContent=`Ставка ${formatNileUnits(round.stakeUnits)} · Начислено ${formatNileUnits(round.payoutUnits)} USDT (Nile)`;detail.textContent=new Date(round.createdAt).toLocaleString('ru-RU')+' · '+round.id;row.append(amount,detail);history.append(row);}
        if(!play.rounds.length){const row=document.createElement('li');row.textContent='Ставок пока нет.';history.append(row);}
        this.message('Баланс подтверждён. Игры на USDT пока недоступны.');return;
      }
      const response = await fetch('/api/nile-wallet', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const wallet = await response.json() as NileWallet & { error?: string };
      if (version !== this.version || !this.dialog.open) return;
      if (!response.ok) throw new Error(wallet.error || 'Тестовый кошелёк временно недоступен.');
      if (Object.entries(NILE_WALLET_SCOPE).some(([key, value]) => (wallet as any)[key] !== value)) throw new Error('Некорректный ответ тестового кошелька.');
      if (wallet.state !== 'assigned') { this.message(wallet.state === 'unassigned' ? 'Тестовый кошелёк ещё не привязан к этому аккаунту. Привязку выполняет администратор.' : 'Тестовый кошелёк пока не подключён.'); return; }
      this.wallet = wallet;
      this.dialog.querySelector<HTMLElement>('#nile-wallet-content')!.hidden = false;
      this.dialog.querySelector('#nile-wallet-balance')!.textContent = formatNileUnits(wallet.balanceUnits);
      this.dialog.querySelector<HTMLInputElement>('#nile-wallet-address')!.value = wallet.address;
      this.dialog.querySelector('#nile-wallet-updated')!.textContent = 'Обновлено: ' + new Date(wallet.updatedAt).toLocaleString('ru-RU');
      const history = this.dialog.querySelector('#nile-wallet-history')!;
      for (const entry of wallet.deposits) {
        const row = document.createElement('li'), amount = document.createElement('strong'), detail = document.createElement('small');
        amount.textContent = '+' + formatNileUnits(entry.amountUnits) + ' USDT (Nile)';
        detail.textContent = `Блок ${entry.height} · ${entry.txId}`; row.append(amount, detail); history.append(row);
      }
      if (!wallet.deposits.length) { const row = document.createElement('li'); row.textContent = 'Подтверждённых поступлений пока нет.'; history.append(row); }
      this.message('Баланс подтверждён. Показаны последние 50 поступлений.');
    } catch (error) { if (version === this.version && this.dialog.open) { this.wallet = undefined; this.clear();this.dialog.querySelector<HTMLElement>('#nile-wallet-deposit')!.hidden=nilePlay.wallet?.state!=='unassigned'; this.message(error instanceof Error ? error.message : 'Не удалось загрузить тестовый кошелёк.'); } }
  }
}
