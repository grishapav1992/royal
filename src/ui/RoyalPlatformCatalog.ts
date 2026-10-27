import { t, language } from '../i18n/index';
import { ARCADE_GITHUB_GAMES, collectionGames, type CabinetCollection } from '../shared/arcadeCatalog';
import { GAME_CABINETS, type Cabinet } from '../shared/cabinets';
import { isStudioGame, STUDIO_INFO } from '../shared/studioGames';
import { CARIBBEAN_GAME } from '../shared/caribbeanTreasures';
import type { CasinoApiProGame, CasinoApiProStatus } from '../shared/casinoApiPro';
import { demoWallet, coins } from '../wallet/WalletClient';
import { FIRST_FLOOR_ART, FIRST_FLOOR_GAME_THEMES } from './FirstFloorGameArt';
const studioCatalogName=(id:import('../shared/studioGames').StudioGameId)=>({'studio-cosmic-escape':'Cosmic Escape','studio-caramel-carnival':'Caramel Carnival','studio-velvet-reign':'Velvet Reign'} as Record<string,string>)[id]??STUDIO_INFO[id].name;
import { royalCatalogArtwork } from './RoyalCatalogArtwork';
import './royal-platform.css';

export type PlatformChoice = {gameId:string; providerGame?:CasinoApiProGame};
type Source = 'royal' | 'casinoapipro' | 'github';
type Entry = PlatformChoice & {name:string; subtitle:string; kind:string; source:Source; art:string; keywords:string};
const github = new Set<string>(ARCADE_GITHUB_GAMES);
export function platformGameCabinet(id: string, seat: Cabinet): Cabinet {
  if (id === 'casinoapipro') return {...seat, id, name:'Casino API Pro', subtitle:'', demo:false, provider:false, wallet:true, github:false, defaultGameId:undefined,collection:undefined};
  const studio = isStudioGame(id) ? STUDIO_INFO[id] : undefined;
  const existing = GAME_CABINETS.find(c => c.id === id);
  return {...seat, id, name:studio ? studioCatalogName(studio.id) : existing?.name ?? 'Casino API Pro',
    subtitle:studio?.subtitle ?? existing?.subtitle ?? '', demo:false, provider:false, wallet:!!studio || !!existing?.wallet,
    github:!studio && id !== 'studio-flooded-temple' && id !== CARIBBEAN_GAME && id !== 'casinoapipro', defaultGameId:undefined,collection:undefined};
}
const kindNames: Record<string,string> = {
  all:t('Все жанры'), slot:t('Слоты'), crash:t('Крэш'), flight:t('Полёт'), keno:t('Кено'),
  plinko:t('Плинко'), dice:t('Кости'), wheel:t('Колесо'), mines:t('Мины'), tower:t('Башня'), instant:t('Быстрые игры'),
};
const classicKinds: Record<string,string> = {'royal-fruits':'slot','royal-dice':'dice','royal-limbo':'instant','royal-mines':'mines','royal-plinko':'plinko','royal-keno':'keno','github-craps':'dice','github-tower':'tower','github-diamonds':'instant','github-crash':'crash','github-sic-bo':'dice','original-cr-vs-leo':'instant'};
const sourceNames: Record<Source,string> = {royal:'RoyalGames',casinoapipro:'Casino API Pro',github:t('GitHub-игры')};
function localEntry(id: string): Entry {
  const game = platformGameCabinet(id, {id, name:id, subtitle:'', x:0,y:0,color:0,playable:true});
  const studio = isStudioGame(id) ? STUDIO_INFO[id] : undefined;
  const theme = github.has(id) && Object.hasOwn(FIRST_FLOOR_GAME_THEMES,id) ? FIRST_FLOOR_ART[FIRST_FLOOR_GAME_THEMES[id as keyof typeof FIRST_FLOOR_GAME_THEMES]] : undefined;
  return {gameId:id, name:game.name, subtitle:theme?.title[language === 'en' ? 1 : 0] ?? game.subtitle,
    kind:id===CARIBBEAN_GAME?'slot':studio?.kind ?? (id==='studio-flooded-temple'?'slot':classicKinds[id]), source:github.has(id) ? 'github' : 'royal', art:id===CARIBBEAN_GAME?'/assets/caribbean-treasures/harbor.webp':royalCatalogArtwork(id),
    keywords:`${studio?.sourceReferenceId ?? ''} ${theme?.title.join(' ') ?? ''}`};
}

/** The host owns this catalogue; choosing a game never changes its physical seat. */
export class RoyalPlatformCatalog {
  private lifetime = new AbortController();
  private providerRequest?: AbortController;
  private entries:Entry[] = [];
  private source: Source | 'all' = 'all';
  private providerStatus?: CasinoApiProStatus;
  private providerMessage = t('Загружаем каталог Casino API Pro…');
  private disposed = false;
  private grid: HTMLElement;
  private search: HTMLInputElement;
  private genre: HTMLSelectElement;
  private updateBalance = () => {
    this.host.querySelector('[data-platform-wallet]')!.textContent = demoWallet.wallet ? `${coins(demoWallet.wallet.balance)} USDT · Демо` : 'USDT · Демо';
  };
  constructor(private host: HTMLElement, private select: (choice:PlatformChoice)=>void, private collection:CabinetCollection, private selected?:PlatformChoice) {
    this.entries=collectionGames(collection).filter(id=>id!=='casinoapipro').map(localEntry);
    this.source=collection;
    const title={royal:t('Игры Royal'),github:t('Доработанные GitHub-игры'),casinoapipro:'Casino API PRO'}[collection];
    host.dataset.collection=collection;
    host.innerHTML = `<section class="royal-platform" aria-label="${t('Каталог игр Рояль')}"><header class="rp-heading"><div><span>ROYAL PLATFORM</span><h3>${title}</h3></div><button type="button" data-platform-wallet></button></header><p class="rp-intro">${t('Выбирай игру и оставайся за своим автоматом. Чат и сохранённые партии всегда рядом.')}</p><nav class="rp-sources" aria-label="${t('Коллекция игр')}">${([collection] as const).map(source=>`<button type="button" data-source="${source}" aria-pressed="${source===this.source}">${sourceNames[source]}<span></span></button>`).join('')}</nav><div class="rp-tools"><label>${t('Найти игру')}<input type="search" aria-label="${t('Найти игру')}" placeholder="${t('Название или тема')}"></label><label>${t('Жанр')}<select aria-label="${t('Жанр')}">${Object.entries(kindNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label></div><p class="rp-count" role="status"></p><div class="rp-provider-status" role="status" hidden><span></span><button type="button" data-provider-retry>${t('Обновить')}</button></div><div class="rp-grid"></div><p class="rp-empty" role="status" hidden>${t('Игры не найдены. Измени поиск или жанр.')}</p></section>`;
    this.grid=host.querySelector('.rp-grid')!; this.search=host.querySelector('input')!; this.genre=host.querySelector('select')!;
    this.search.oninput=()=>this.render(); this.genre.onchange=()=>this.render();
    host.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button=>button.onclick=()=>{this.source=button.dataset.source as Source|'all';this.render();});
    host.querySelector<HTMLButtonElement>('[data-provider-retry]')!.onclick=()=>{void this.loadProvider();};
    host.querySelector<HTMLButtonElement>('[data-platform-wallet]')!.onclick=()=>window.dispatchEvent(new Event('royal-open-wallet'));
    demoWallet.addEventListener('change',this.updateBalance,{signal:this.lifetime.signal});
    window.addEventListener('royal-account',()=>{void this.loadProvider();},{signal:this.lifetime.signal});
    this.updateBalance();this.render();void this.loadProvider();
  }
  private async loadProvider() {
    // Separate provider credits are hidden in the single USDT wallet release.
    this.providerMessage='';this.render();return;
    this.providerRequest?.abort();const controller = new AbortController();this.providerRequest=controller;
    this.entries=this.entries.filter(entry=>entry.source!=='casinoapipro');this.providerStatus=undefined;
    this.providerMessage=t('Загружаем каталог Casino API Pro…');this.render();
    if (!demoWallet.accountId) {this.providerMessage=t('Войди в онлайн-зал, чтобы открыть игры Casino API Pro.');this.render();return;}
    try {
      const request = async(path:string,body?:object)=>{
        const response=await fetch('/api/casinoapipro/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
        const data=await response.json();if(!response.ok)throw Error(data.error||t('Не удалось подключиться к тестовым играм.'));return data;
      };
      const status:CasinoApiProStatus=await request('status',{});
      if(this.disposed||controller.signal.aborted)return;
      this.providerStatus=status;
      if (!status.configured) {this.providerMessage=t('Casino API Pro пока не настроен. Остальные игры доступны.');this.render();return;}
      const result:{games:CasinoApiProGame[]}=await request('games');
      if(this.disposed||controller.signal.aborted)return;
      this.entries.push(...result.games.map(game=>({gameId:'casinoapipro',providerGame:game,name:game.name,subtitle:t('Игра поставщика'),kind:({SLOTS:'slot',CRASH:'crash'} as Record<string,string>)[game.category]??'instant',source:'casinoapipro' as const,art:game.thumbnailUrl??'',keywords:game.slug})));
      this.providerMessage=status.walletConnected?'':t('Ожидаем подтверждение подключения нашего кошелька.');this.render();
    }catch(error){if(!this.disposed&&!controller.signal.aborted){this.providerMessage=(error as Error).message;this.render();}}
  }
  private render() {
    if(this.disposed)return;
    const query=this.search.value.trim().toLocaleLowerCase();
    const entries=this.entries.filter(entry=>(this.source==='all'||entry.source===this.source)&&(this.genre.value==='all'||entry.kind===this.genre.value)&&`${entry.name} ${entry.subtitle} ${entry.keywords}`.toLocaleLowerCase().includes(query));
    this.host.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button=>{const source=button.dataset.source!;button.setAttribute('aria-pressed',String(source===this.source));button.querySelector('span')!.textContent=String(source==='all'?this.entries.length:this.entries.filter(entry=>entry.source===source).length);});
    this.host.querySelector('.rp-count')!.textContent=`${t('Показано')}: ${entries.length} / ${this.entries.length}`;
    const notice=this.host.querySelector<HTMLElement>('.rp-provider-status')!;notice.hidden=!this.providerMessage||(this.source!=='all'&&this.source!=='casinoapipro');notice.querySelector('span')!.textContent=this.providerMessage;
    this.host.querySelector<HTMLElement>('.rp-empty')!.hidden=entries.length>0;this.grid.replaceChildren();
    for(const entry of entries){
      const button=document.createElement('button');button.type='button';button.className='rp-card';button.dataset.platformGame=entry.gameId;
      if(entry.providerGame)button.dataset.providerGame=entry.providerGame.id;
      button.setAttribute('aria-label',`${t('Играть')}: ${entry.name}`);
      if(this.selected?.gameId===entry.gameId&&this.selected?.providerGame?.id===entry.providerGame?.id)button.setAttribute('aria-current','true');
      button.disabled=entry.source==='casinoapipro'&&!this.providerStatus?.walletConnected;
      const art=document.createElement('span');art.className='rp-art';
      if(entry.art){const img=document.createElement('img');img.src=entry.art;img.alt='';img.loading='lazy';img.decoding='async';img.width=512;img.height=320;img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();art.append(img);}
      const kind=document.createElement('span');kind.className='rp-kind';kind.textContent=kindNames[entry.kind]??entry.kind;art.append(kind);
      const copy=document.createElement('span');copy.className='rp-copy';
      for(const [tag,text] of [['small',sourceNames[entry.source]],['strong',entry.name],['span',entry.subtitle]]){const el=document.createElement(tag);el.textContent=text;copy.append(el);}
      button.append(art,copy);button.onclick=()=>this.select({gameId:entry.gameId,providerGame:entry.providerGame});this.grid.append(button);
    }
  }
  destroy(){this.disposed=true;this.lifetime.abort();this.providerRequest?.abort();this.host.replaceChildren();delete this.host.dataset.collection;}
}
