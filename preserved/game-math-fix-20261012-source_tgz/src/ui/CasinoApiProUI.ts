import type { RoomScene } from '../game/RoomScene';
import type { CasinoApiProGame, CasinoApiProStatus } from '../shared/casinoApiPro';
import { coins, demoWallet } from '../wallet/WalletClient';
import '../demo-library.css';
import '../casino-api-pro.css';

export class CasinoApiProUI {
  private dialog = document.createElement('dialog');
  private frame?: HTMLIFrameElement;
  private games: CasinoApiProGame[] = [];
  private status?: CasinoApiProStatus;
  private version = 0;
  private statusRead = 0;
  private account: string | null = null;
  private abort?: AbortController;
  private poll?: ReturnType<typeof setInterval>;
  private timer?: ReturnType<typeof setTimeout>;
  private selected?: CasinoApiProGame;
  private message: HTMLElement;
  private stage: HTMLElement;
  private catalogue: HTMLElement;
  private grid: HTMLElement;
  private search: HTMLInputElement;
  private category: HTMLSelectElement;
  private count: HTMLElement;
  private atCabinet = false;
  constructor(private scene: RoomScene, private onPlaying: (playing: boolean) => void = () => {}) {
    this.dialog.id='casinoapipro-dialog'; this.dialog.className='capro-dialog'; this.dialog.setAttribute('aria-labelledby','capro-title');
    this.dialog.innerHTML='<div class="capro-heading"><div><span class="eyebrow">CASINO API PRO / ТЕСТ</span><h2 id="capro-title">Игры на демобаланс</h2></div><button class="icon-button" id="capro-close" aria-label="Вернуться из Casino Api Pro в зал">×</button></div><div class="capro-toolbar"><button type="button" id="capro-catalogue" class="primary-button">Все игры</button><button type="button" id="capro-wallet" class="text-button" aria-label="Демокошелёк в Casino Api Pro">Демобаланс: …</button></div><p id="capro-connection" role="status"></p><div class="capro-stage"><p id="capro-message" role="status"></p><section class="demo-library" aria-label="Тестовые игры Casino Api Pro" hidden><div class="demo-library-intro"><h3>Выбери игру</h3></div><div class="demo-library-filters"><label>Поиск<input type="search" aria-label="Поиск игр Casino Api Pro" placeholder="Название игры"></label><label>Категория<select aria-label="Категория Casino Api Pro"><option value="">Все категории</option></select></label></div><p class="demo-library-count"></p><div class="demo-library-grid"></div></section></div><div class="capro-footer"><span>Тестовый режим · Без реальных платежей и вывода</span><button type="button" id="capro-retry" class="text-button">Обновить</button></div><details id="capro-setup" hidden><summary>Настройка тестового доступа</summary><p>В кабинете поставщика проверь соединение нашего кошелька для этого игрока:</p><code id="capro-player"></code><p>До подтверждённого запроса баланса запуск игр закрыт.</p></details>';
    this.stage=this.dialog.querySelector('.capro-stage')!; this.message=this.dialog.querySelector('#capro-message')!;
    this.catalogue=this.dialog.querySelector('.demo-library')!; this.grid=this.dialog.querySelector('.demo-library-grid')!;
    this.search=this.dialog.querySelector('input')!; this.category=this.dialog.querySelector('select')!; this.count=this.dialog.querySelector('.demo-library-count')!;
    this.search.oninput=()=>this.renderGames(); this.category.onchange=()=>this.renderGames();
    this.dialog.querySelector<HTMLButtonElement>('#capro-close')!.onclick=()=>this.dialog.close();
    this.dialog.querySelector<HTMLButtonElement>('#capro-catalogue')!.onclick=()=>{void this.library();};
    this.dialog.querySelector<HTMLButtonElement>('#capro-retry')!.onclick=()=>{void (this.selected ? this.launch(this.selected) : this.library());};
    this.dialog.querySelector<HTMLButtonElement>('#capro-wallet')!.onclick=()=>window.dispatchEvent(new Event('royal-open-wallet'));
    this.dialog.addEventListener('close',()=>{
      if(this.atCabinet) this.onPlaying(false); this.atCabinet=false;
      this.stop(); clearInterval(this.poll); this.account=null; void demoWallet.refresh(); scene.setLocked(!!document.querySelector('dialog[open]'));
      document.getElementById('game')?.focus({preventScroll:true});
    });
    window.addEventListener('royal-account',()=>{if(this.dialog.open && this.account !== demoWallet.accountId) this.dialog.close();});
    window.addEventListener('royal-open-casinoapipro',()=>this.open());
    document.body.append(this.dialog);
  }
  private stop() {
    this.version++; this.abort?.abort(); this.abort=new AbortController(); clearTimeout(this.timer); this.frame?.remove(); this.frame=undefined;
  }
  open(atCabinet = false) {
    if (this.dialog.open) return;
    this.account=demoWallet.accountId; this.status=undefined; this.scene.setLocked(true); this.dialog.showModal();
    this.atCabinet=atCabinet; if(atCabinet) this.onPlaying(true);
    this.dialog.querySelector('#capro-wallet')!.textContent='Демобаланс: …';
    this.dialog.querySelector('#capro-connection')!.textContent='';
    this.dialog.querySelector<HTMLElement>('#capro-setup')!.hidden=true;
    void this.library();
    this.poll=setInterval(()=>{if(this.dialog.open && this.account) {void this.refreshStatus(); void demoWallet.refresh();}},3000);
  }
  private async request(path: string, body?: unknown) {
    const response=await fetch(`/api/casinoapipro/${path}`,{method:body === undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([this.abort!.signal,AbortSignal.timeout(25000)])});
    const result=await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось подключиться к тестовым играм.'); return result;
  }
  private async refreshStatus() {
    const account=this.account, version=this.version, read=++this.statusRead;
    try {
      const status: CasinoApiProStatus=await this.request('status',{});
      if (!this.dialog.open || account !== this.account || version !== this.version || read!==this.statusRead) return;
      this.status=status;
      this.dialog.querySelector('#capro-wallet')!.textContent=`Демобаланс: ${coins(Number(status.balance))}`;
      this.dialog.querySelector('#capro-connection')!.textContent=status.configured ? status.walletConnected ? '' : 'Ожидаем подтверждение подключения нашего кошелька.' : 'Тестовый доступ поставщика ещё не настроен.';
      this.dialog.querySelector<HTMLElement>('#capro-setup')!.hidden=status.walletConnected;
      this.dialog.querySelector('#capro-player')!.textContent=status.playerId;
      this.grid.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{button.disabled=!status.walletConnected;});
    } catch (error) {
      if(this.dialog.open && account===this.account && version===this.version && read===this.statusRead) this.dialog.querySelector('#capro-connection')!.textContent=(error as Error).message;
    }
  }
  private async library() {
    this.stop(); const version=this.version; this.selected=undefined; this.catalogue.hidden=true; this.message.hidden=false;
    this.dialog.querySelector('#capro-title')!.textContent='Игры на демобаланс'; this.message.textContent='Загружаем тестовый каталог…';
    if(!this.account) {this.message.textContent='Войди в онлайн-зал, чтобы играть на свой демобаланс.';return;}
    await this.refreshStatus(); if(version!==this.version || !this.dialog.open) return;
    if(!this.status?.configured) {this.message.textContent='Для запуска игр нужны тестовые ключи Casino Api Pro. После настройки здесь появятся игры, доступные аккаунту поставщика.';return;}
    try {
      const result=await this.request('games'); if(version!==this.version || !this.dialog.open) return;
      this.games=result.games; this.category.replaceChildren(new Option('Все категории',''));
      for(const category of new Set(this.games.map(game=>game.category))) this.category.add(new Option(({SLOTS:'Слоты',CRASH:'Crash',INSTANT:'Быстрые игры'} as Record<string,string>)[category]||category,category));
      this.renderGames(); this.message.hidden=true; this.catalogue.hidden=false; this.catalogue.scrollTop=0;
    } catch(error) {if(version===this.version) this.message.textContent=(error as Error).message;}
  }
  private renderGames() {
    const query=this.search.value.trim().toLocaleLowerCase();
    const games=this.games.filter(game=>(!this.category.value || game.category===this.category.value)&&game.name.toLocaleLowerCase().includes(query));
    this.count.textContent=`Показано ${games.length} из ${this.games.length}`; this.grid.replaceChildren();
    for(const game of games) {
      const button=document.createElement('button');button.type='button';button.className='demo-library-card';button.setAttribute('aria-label',`Тестовая игра ${game.name}`);button.disabled=!this.status?.walletConnected;
      const art=document.createElement('span');art.className='demo-library-art'; const placeholder=document.createElement('span');placeholder.className='demo-library-placeholder';placeholder.textContent='◈';art.append(placeholder);
      if(game.thumbnailUrl){const image=document.createElement('img');image.alt=`Обложка ${game.name}`;image.loading='lazy';image.referrerPolicy='no-referrer';image.src=game.thumbnailUrl;image.onerror=()=>image.remove();art.append(image);}
      const name=document.createElement('strong');name.textContent=game.name;const limit=document.createElement('small');limit.textContent=`Ставка от ${game.minBet} · ${this.status?.currency}`;
      button.append(art,name,limit);button.onclick=()=>{void this.launch(game);};this.grid.append(button);
    }
    if(!games.length){const empty=document.createElement('p');empty.textContent='Нет доступных игр. Проверь название, категорию и настройки каталога поставщика.';empty.className='demo-library-empty';this.grid.append(empty);}
  }
  private async launch(game: CasinoApiProGame) {
    this.stop();const version=this.version;this.selected=game;this.catalogue.hidden=true;this.message.hidden=false;
    this.message.textContent='Открываем игру с нашим демобалансом…';this.dialog.querySelector('#capro-title')!.textContent=game.name;
    try {
      if(demoWallet.pending) throw new Error('Сначала проверь неподтверждённую операцию в демокошельке.');
      const result=await this.request('sessions',{gameId:game.id});if(version!==this.version || !this.dialog.open) return;
      const url=new URL(result.launchUrl);
      if(url.origin!=='https://games.casinoapipro.com' || url.pathname!=='/play' || url.username || url.password) throw new Error('Получен недопустимый адрес игры.');
      const frame=document.createElement('iframe');frame.title=`${game.name}: тестовая игра Casino Api Pro`;frame.allow='autoplay; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.onload=()=>{if(version===this.version){clearTimeout(this.timer);this.message.hidden=true;}};
      frame.src=url.href;this.frame=frame;this.stage.append(frame);
      this.timer=setTimeout(()=>{if(version===this.version){frame.remove();this.frame=undefined;this.message.hidden=false;this.message.textContent='Игра не загрузилась. Попробуй открыть её ещё раз или выбери другую.';}},30000);
    }catch(error){if(version===this.version) this.message.textContent=(error as Error).message;}
  }
}
