import { t as translateText, tr } from '../i18n/index';
import type { RoomScene } from '../game/RoomScene';
import type { CasinoApiProGame, CasinoApiProStatus } from '../shared/casinoApiPro';
import { demoWallet } from '../wallet/WalletClient';
import {providerCoins} from '../shared/demoWallet';
import '../demo-library.css';
import '../casino-api-pro.css';

type EmbeddedProvider = {host:HTMLElement; gameId?:string; gameName?:string; onCatalogue:()=>void; setTitle?:(title:string)=>void};

export class CasinoApiProUI {
  private disposed = false;
  private lifetime = new AbortController();
  private dialog: HTMLElement;
  private modal?: HTMLDialogElement;
  private opened = false;
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
  constructor(private scene: Pick<RoomScene, 'setLocked' | 'approach'>, private onPlaying: (playing: boolean) => void = () => {}, private onClosed: () => void = () => {}, navigation = true, private embedded?:EmbeddedProvider) {
    this.dialog = embedded ? document.createElement('section') : (this.modal = document.createElement('dialog'));
    this.dialog.id='casinoapipro-dialog'; this.dialog.className=embedded ? 'capro-embedded' : 'capro-dialog'; this.dialog.setAttribute('aria-labelledby','capro-title');
    this.dialog.innerHTML=translateText('<div class="capro-heading"><div><span class="eyebrow">CASINO API PRO / ТЕСТ</span><h2 id="capro-title">Игры на демобаланс</h2></div><button class="icon-button" id="capro-close" aria-label="Вернуться из Casino Api Pro в зал">×</button></div><div class="capro-toolbar"><button type="button" id="capro-catalogue" class="primary-button">Все игры</button><button type="button" id="capro-wallet" class="text-button" aria-label="Демокошелёк в Casino Api Pro">Демобаланс: …</button></div><p id="capro-connection" role="status"></p><div class="capro-stage"><p id="capro-message" role="status"></p><section class="demo-library" aria-label="Тестовые игры Casino Api Pro" hidden><div class="demo-library-intro"><h3>Выбери игру</h3></div><div class="demo-library-filters"><label>Поиск<input type="search" aria-label="Поиск игр Casino Api Pro" placeholder="Название игры"></label><label>Категория<select aria-label="Категория Casino Api Pro"><option value="">Все категории</option></select></label></div><p class="demo-library-count"></p><div class="demo-library-grid"></div></section></div><div class="capro-footer"><span>Тестовый режим · Без реальных платежей и вывода</span><button type="button" id="capro-retry" class="text-button">Обновить</button></div><details id="capro-setup" hidden><summary>Настройка тестового доступа</summary><p>В кабинете поставщика проверь соединение нашего кошелька для этого игрока:</p><code id="capro-player"></code><p>До подтверждённого запроса баланса запуск игр закрыт.</p></details>');
    this.stage=this.dialog.querySelector('.capro-stage')!; this.message=this.dialog.querySelector('#capro-message')!;
    this.catalogue=this.dialog.querySelector('.demo-library')!; this.grid=this.dialog.querySelector('.demo-library-grid')!;
    this.search=this.dialog.querySelector('input')!; this.category=this.dialog.querySelector('select')!; this.count=this.dialog.querySelector('.demo-library-count')!;
    this.search.oninput=()=>this.renderGames(); this.category.onchange=()=>this.renderGames();
    this.dialog.querySelector<HTMLButtonElement>('#capro-close')!.onclick=()=>this.close();
    this.dialog.querySelector<HTMLButtonElement>('#capro-catalogue')!.onclick=()=>{if(this.embedded)this.embedded.onCatalogue();else void this.library();};
    this.dialog.querySelector<HTMLButtonElement>('#capro-retry')!.onclick=()=>{void (this.selected ? this.launch(this.selected) : this.initialView());};
    this.dialog.querySelector<HTMLButtonElement>('#capro-wallet')!.onclick=()=>window.dispatchEvent(new Event('royal-open-wallet'));
    this.modal?.addEventListener('close',()=>this.finishClose());
    window.addEventListener('royal-account',()=>{if(this.opened && this.account !== demoWallet.accountId) this.close();},{signal:this.lifetime.signal});
    if(navigation)window.addEventListener('royal-open-casinoapipro',()=>this.scene.approach('casinoapipro'),{signal:this.lifetime.signal});
    if(embedded)embedded.host.replaceChildren(this.dialog);else document.body.append(this.dialog);
  }
  private close() {
    if(this.modal)this.modal.close();else this.finishClose();
  }
  private finishClose() {
    if(this.disposed || !this.opened)return;
    this.opened=false;
    if(this.atCabinet && !this.embedded)this.onPlaying(false);
    this.atCabinet=false;this.stop();clearInterval(this.poll);this.account=null;void demoWallet.refresh();
    if(!this.embedded){this.scene.setLocked(!!document.querySelector('dialog[open]'));document.getElementById('game')?.focus({preventScroll:true});}
    this.onClosed();
  }
  private stop() {
    this.version++; this.abort?.abort(); this.abort=new AbortController(); clearTimeout(this.timer); this.frame?.remove(); this.frame=undefined;
  }
  open(atCabinet = false) {
    if (this.disposed || this.opened) return;
    this.account=demoWallet.accountId; this.status=undefined; this.opened=true; if(this.modal){this.scene.setLocked(true);this.modal.showModal();}
    this.atCabinet=atCabinet && !this.embedded;
    this.dialog.querySelector('#capro-wallet')!.textContent=translateText('Демобаланс: …');
    this.dialog.querySelector('#capro-connection')!.textContent='';
    this.dialog.querySelector<HTMLElement>('#capro-setup')!.hidden=true;
    void this.initialView();
    this.poll=setInterval(()=>{if(this.opened && this.account) {void this.refreshStatus(); void demoWallet.refresh();}},3000);
  }
  destroy() {
    if(this.disposed)return;
    if(this.embedded && this.opened)void demoWallet.refresh();
    this.disposed=true;this.lifetime.abort();this.atCabinet=false;
    this.stop();clearInterval(this.poll);
    this.opened=false;this.modal?.close();this.dialog.remove();
  }
  private async initialView() {
    if(!this.embedded?.gameId){await this.library();return;}
    this.stop();const version=this.version;
    this.message.textContent=translateText('Проверяем подключение игры…');
    await this.refreshStatus();
    if(version!==this.version || !this.opened)return;
    if(!this.status?.configured || !this.status.walletConnected){
      this.message.textContent=this.status?.configured ? translateText('Ожидаем подтверждение подключения нашего кошелька.') : translateText('Тестовый доступ поставщика ещё не настроен.');return;
    }
    try {
      const result:{games:CasinoApiProGame[]}=await this.request('games');
      if(version!==this.version || !this.opened)return;
      const game=result.games.find(game=>game.id===this.embedded!.gameId);
      if(!game)throw Error(translateText('Игра больше недоступна. Выбери другую в каталоге.'));
      await this.launch(game);
    }catch(error){if(version===this.version && this.opened)this.message.textContent=translateText((error as Error).message);}
  }
  private async request(path: string, body?: unknown) {
    const response=await fetch(`/api/casinoapipro/${path}`,{method:body === undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([this.abort!.signal,AbortSignal.timeout(25000)])});
    const result=await response.json(); if (!response.ok) throw new Error(result.error || translateText('Не удалось подключиться к тестовым играм.')); return result;
  }
  private async refreshStatus() {
    const account=this.account, version=this.version, read=++this.statusRead;
    try {
      const status: CasinoApiProStatus=await this.request('status',{});
      if (!this.opened || account !== this.account || version !== this.version || read!==this.statusRead) return;
      this.status=status;
      this.dialog.querySelector('#capro-wallet')!.textContent=tr`Демобаланс: ${providerCoins(status.balance)}`;
      this.dialog.querySelector('#capro-connection')!.textContent=status.configured ? status.walletConnected ? '' : translateText('Ожидаем подтверждение подключения нашего кошелька.') : translateText('Тестовый доступ поставщика ещё не настроен.');
      this.dialog.querySelector<HTMLElement>('#capro-setup')!.hidden=status.walletConnected;
      this.dialog.querySelector('#capro-player')!.textContent=status.playerId;
      this.grid.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{button.disabled=!status.walletConnected;});
    } catch (error) {
      if(this.opened && account===this.account && version===this.version && read===this.statusRead) this.dialog.querySelector('#capro-connection')!.textContent=translateText((error as Error).message);
    }
  }
  private async library() {
    this.stop(); const version=this.version; this.selected=undefined; this.catalogue.hidden=true; this.message.hidden=false;
    this.dialog.querySelector('#capro-title')!.textContent=translateText('Игры на демобаланс'); this.message.textContent=translateText('Загружаем тестовый каталог…');
    if(!this.account) {this.message.textContent=translateText('Войди в онлайн-зал, чтобы играть на свой демобаланс.');return;}
    await this.refreshStatus(); if(version!==this.version || !this.opened) return;
    if(!this.status?.configured) {this.message.textContent=translateText('Для запуска игр нужны тестовые ключи Casino Api Pro. После настройки здесь появятся игры, доступные аккаунту поставщика.');return;}
    try {
      const result=await this.request('games'); if(version!==this.version || !this.opened) return;
      this.games=result.games; this.category.replaceChildren(new Option(translateText('Все категории'),''));
      for(const category of new Set(this.games.map(game=>game.category))) this.category.add(new Option(({SLOTS:translateText('Слоты'),CRASH:'Crash',INSTANT:translateText('Быстрые игры')} as Record<string,string>)[category]||category,category));
      this.renderGames(); this.message.hidden=true; this.catalogue.hidden=false; this.catalogue.scrollTop=0;
    } catch(error) {if(version===this.version) this.message.textContent=translateText((error as Error).message);}
  }
  private renderGames() {
    const query=this.search.value.trim().toLocaleLowerCase();
    const games=this.games.filter(game=>(!this.category.value || game.category===this.category.value)&&game.name.toLocaleLowerCase().includes(query));
    this.count.textContent=tr`Показано ${games.length} из ${this.games.length}`; this.grid.replaceChildren();
    for(const game of games) {
      const button=document.createElement('button');button.type='button';button.className='demo-library-card';button.setAttribute('aria-label',tr`Тестовая игра ${game.name}`);button.disabled=!this.status?.walletConnected;
      const art=document.createElement('span');art.className='demo-library-art'; const placeholder=document.createElement('span');placeholder.className='demo-library-placeholder';placeholder.textContent='◈';art.append(placeholder);
      if(game.thumbnailUrl){const image=document.createElement('img');image.alt=tr`Обложка ${game.name}`;image.loading='lazy';image.referrerPolicy='no-referrer';image.src=game.thumbnailUrl;image.onerror=()=>image.remove();art.append(image);}
      const name=document.createElement('strong');name.textContent=game.name;const limit=document.createElement('small');limit.textContent=tr`Ставка от ${game.minBet} · ${this.status?.currency}`;
      button.append(art,name,limit);button.onclick=()=>{void this.launch(game);};this.grid.append(button);
    }
    if(!games.length){const empty=document.createElement('p');empty.textContent=translateText('Нет доступных игр. Проверь название, категорию и настройки каталога поставщика.');empty.className='demo-library-empty';this.grid.append(empty);}
  }
  private async launch(game: CasinoApiProGame) {
    this.stop();const version=this.version;this.selected=game;this.catalogue.hidden=true;this.message.hidden=false;
    this.message.textContent=translateText('Открываем игру с нашим демобалансом…');this.dialog.querySelector('#capro-title')!.textContent=game.name;this.embedded?.setTitle?.(game.name);
    try {
      if(demoWallet.pending) throw new Error(translateText('Сначала проверь неподтверждённую операцию в демокошельке.'));
      const result=await this.request('sessions',{gameId:game.id});if(version!==this.version || !this.opened) return;
      const url=new URL(result.launchUrl);
      if(url.origin!=='https://games.casinoapipro.com' || url.pathname!=='/play' || url.username || url.password) throw new Error(translateText('Получен недопустимый адрес игры.'));
      const frame=document.createElement('iframe');frame.title=tr`${game.name}: тестовая игра Casino Api Pro`;frame.allow='autoplay; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.onload=()=>{if(version===this.version){clearTimeout(this.timer);this.message.hidden=true;}};
      frame.src=url.href;this.frame=frame;this.stage.append(frame);
      this.timer=setTimeout(()=>{if(version===this.version){frame.remove();this.frame=undefined;this.message.hidden=false;this.message.textContent=translateText('Игра не загрузилась. Попробуй открыть её ещё раз или выбери другую.');}},30000);
    }catch(error){if(version===this.version) this.message.textContent=translateText((error as Error).message);}
  }
}
