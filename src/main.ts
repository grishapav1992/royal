import { GAME_REACTION_EVENT } from './ui/gameReactions';
import { CasinoSessionsUI } from './ui/CasinoSessionsUI';
import { CasinoExpansionUI } from './ui/CasinoExpansionUI';
import { CasinoVariantsUI } from './ui/CasinoVariantsUI';
import { CasinoNextVariantsUI } from './ui/CasinoNextVariantsUI';
import { CasinoBatchVariantsUI } from './ui/CasinoBatchVariantsUI';
import { StudioGamesUI } from './ui/StudioGamesUI';
import { StudioCatalog } from './ui/StudioCatalog';
import { CardTablesCatalog } from './ui/CardTablesCatalog';
import { CardDealerStage } from './ui/CardDealerStage';
import { GameWindow } from './ui/GameWindow';
import { isCardGame, dealerForGame } from './shared/cardTables';
import './ui/floor-navigation.css';
import { isStudioGame } from './shared/studioGames';
import { isBatchVariantGame } from './shared/casinoBatchVariants';
import { VARIANT_GAMES, VARIANT_INFO, isVariantGame, type VariantGameId, type BaseVariantGameId } from './shared/casinoVariants';
import { isNextVariantGame } from './shared/casinoNextVariants';
import './ui/casino-variant-catalog.css';
import { isExpansionGame } from './shared/casinoExpansion';
import { isSessionGame } from './shared/casinoSessions';
import { ClubMap } from './ui/ClubMap';
import { DemoWalletUI } from './ui/DemoWalletUI';
import { NileWalletUI } from './ui/NileWalletUI';
import { UsdtWalletUI } from './ui/UsdtWalletUI';
import { CryptoWalletUI } from './ui/CryptoWalletUI';
import { MiraChat } from './ui/MiraChat';
import { EZSlotsGame } from './ui/EZSlotsGame';
import { OriginalGames, type OriginalGameId } from './ui/OriginalGames';
import { isGithubGame } from './shared/githubGames';
import { GithubGames } from './ui/GithubGames';
import { DemoPreview } from './ui/DemoPreview';
import './demo-preview.css';
import { DemoSlot } from './ui/DemoSlot';
import { CasinoApiProUI } from './ui/CasinoApiProUI';
import { prefetchDemoGames } from './game/demoGames';
import { gameAudio } from './game/GameAudio';
import Phaser from 'phaser';
import { RoomScene, CABINETS, type Cabinet } from './game/RoomScene';
import { cabinetHall, cabinetsInHall } from './shared/cabinets';
import { WORLD } from './game/navigation';
import './style.css';
import './paper-theme.css';
import './own-cabinets.css';
import './mira-dialog.css';
import './ui/game-window.css';
import './ui/machine-game-layout.css';
import './ui/slot-game-layout.css';
import './ui/card-game-layout.css';
import { DRINKS, HALLS, hallLinks, activityHall, type HallId } from './shared/world';
import type { BreakerStatus } from './game/breaker';
import type { ArcadeMode } from './game/arcades';
import { SocialUI } from './ui/SocialUI';
import { CatUI } from './ui/CatUI';
import { RoomLayout } from './ui/RoomLayout';
const offline = new URL(location.href).searchParams.get('offline') === '1';
let social: SocialUI | undefined;

const icons = {
  crown: '<path d="m3 7 5 4 4-7 4 7 5-4-2 12H5L3 7Z"/><path d="M6 22h12"/>',
  game: '<path d="M8 7h8c3 0 4 3 5 8s-2 6-5 2H8c-3 4-6 3-5-2s2-8 5-8Z"/><path d="M7 10v5m-2-2h4m7-2h.01m2 3h.01"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
};
const icon = (name: keyof typeof icons, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const floorVariants = VARIANT_GAMES.filter(id => !isCardGame(id));
const catalogCabinets = CABINETS.filter(c => !isVariantGame(c.id) && !isStudioGame(c.id) && !isCardGame(c.id));
const hallGameCount = (hall: HallId) => {
  const cabinets = cabinetsInHall(hall);
  return new Set([...cabinets.map(c => c.id), ...(hall === 'arcade' ? floorVariants : [])]).size + (hall === 'tables' ? 3 : 0);
};
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="header">
    <a class="brand" href="/" aria-label="Рояль, игровой зал"><span class="brand-mark">${icon('crown')}</span><span>РОЯЛЬ<small>ARCADE SOCIAL CLUB</small></span></a>
    <div class="header-center">${icon('game')}<span>Игровой зал</span></div>
    <div class="profile"><span class="demo-badge">ДЕМО</span><span class="avatar">${icon('person')}</span><span class="profile-name">Гость<small>Приятно познакомиться</small></span></div>
  </header>
  <main>
    <div class="room-heading"><div><h1>Казино и бар <span>01</span></h1></div><div class="room-tools"><nav id="floor-links" class="floor-links" aria-label="Лестницы между этажами"></nav><span class="local-label"><i></i>Локальная игра</span><button class="icon-button" id="help" aria-label="Как играть" title="Как играть">${icon('help')}</button><button class="icon-button" id="fullscreen" aria-label="Полный экран" title="Полный экран">${icon('expand')}</button></div></div>
    <div class="workspace">
      <section class="room-panel" aria-label="Игровой зал">
        <div class="room-overlay"><span class="room-intoxication" id="room-intoxication" role="status" hidden></span><span class="npc-count"></span></div>
        <div id="game" tabindex="0" role="application" aria-label="Игровой зал. Передвижение стрелками или WASD, Shift для ускорения. Подойдите к столу или автомату и нажмите E."><div class="loading" id="loading">Открываем клуб<span></span></div></div>
        <div id="interaction" class="interaction" hidden><div><span class="eyebrow" id="machine-kind">ИГРОВОЙ АВТОМАТ</span><strong id="machine-name"></strong></div><button id="interact" class="primary-button"><kbd>E</kbd><span id="interact-label">Играть</span>${icon('arrow')}</button></div>
        <div class="lounge-controls"><button id="visit-bar">Мини-бар</button><button id="stand-up" hidden>Встать</button></div>
      </section>
      <aside class="sidebar">
        <div class="sidebar-heading"><h2>Во что сыграем?</h2><span>${String(hallGameCount('arcade')).padStart(2, '0')}</span></div>
        <section id="studio-catalog" aria-label="Новые миры Рояля"></section>
        <section id="card-tables-catalog" aria-label="Карточные столы и крупье" hidden></section>
        <section class="variant-catalog" aria-label="Новые варианты игр"><div class="variant-catalog-heading"><strong>По-новому</strong><span>${floorVariants.length} вариантов</span></div><p>Новые правила и оформление · Общий демобаланс</p><div>${floorVariants.map(id=>`<button type="button" data-variant="${id}" class="variant-catalog-card theme-${VARIANT_INFO[id].theme}" aria-label="Играть в ${VARIANT_INFO[id].name}"><span class="variant-catalog-symbol" aria-hidden="true">${({'variant-dice':'↔','variant-plinko':'◉◉','variant-limbo':'✧','variant-mines':'▦','variant-sic-bo':'⚄','variant-diamonds':'◇','variant-keno':'⁕','variant-color':'♥♠','variant-keys':'⚿','variant-fruits':'●●●','variant-duel':'↕','variant-war':'⚑⚑','variant-target-plinko':'◎','variant-triple-poker':'♣','variant-dice-streak':'⚄','variant-gem-collection':'◇◇◇','variant-double-mines':'▧','variant-blackjack-target':'21'} as Record<VariantGameId,string>)[id]}</span><span><strong>${VARIANT_INFO[id].name}</strong><small>${VARIANT_INFO[id].tagline}</small></span>${icon('arrow')}</button>`).join('')}</div></section>
        <div class="cabinet-list">${catalogCabinets.map((c,i)=>`<button id="${c.provider?'casinoapipro-open':'cabinet-'+c.id}" class="cabinet-card ${i===0?'featured':''}" data-cabinet="${c.id}" data-hall="${cabinetHall(c)}" ${cabinetHall(c)!=='arcade'?'hidden':''} aria-label="Подойти к автомату ${c.name}"><div class="cabinet-art art-${i}" id="art-${i}"></div><div class="cabinet-copy">${c.demo?'<span class="card-kicker">ДЕМО</span>':''}<strong>${c.name}</strong><small>${c.subtitle}</small>${VARIANT_GAMES.some(id=>VARIANT_INFO[id].base===c.id)?'<span class="variant-available">Классика + новый вариант</span>':''}</div>${icon('arrow','card-arrow')}</button>`).join('')}</div>
        <div class="player-card"><span class="player-portrait" id="player-portrait"></span><div><strong>Это ты</strong><small>Исследователь клуба</small></div><span class="player-dot"></span></div>
      </aside>
    </div>
    <footer class="footer room-dock"><nav class="panel-tabs" aria-label="Панели зала"></nav><button id="panel-close" type="button" hidden>Закрыть панель ×</button><span class="dock-hint">WASD · стрелки · Shift: бег</span><button id="room-overview" type="button" aria-pressed="false">Весь этаж</button></footer>
  </main>
  <dialog id="help-dialog" class="help-dialog"><button class="dialog-close icon-button" data-close aria-label="Закрыть">${icon('close')}</button><h2>Как играть</h2><div class="help-steps"><p><span>01</span>WASD или стрелки: идти. Shift: бежать. Нажатие на пол: бежать к точке.</p><p><span>02</span>Нажми на автомат, стол или его карточку, чтобы подойти. Рядом нажми E, чтобы играть.</p><p><span>03</span>Первый этаж: автоматы и казино-игры. Второй этаж: шахматы, бильярд и аэрохоккей. Третий этаж: карточные столы с крупье. Поднимайся по светящимся лестницам или нажимай кнопки этажей наверху. Кнопка «Игры» открывает список текущего этажа.</p></div><button class="primary-button" data-close>Понятно ${icon('game')}</button></dialog>
  <dialog id="mini-dialog" class="mini-dialog" aria-labelledby="mini-title"><div class="mini-top"><div><span class="eyebrow">ROYAL ORIGINALS / 01</span><h2 id="mini-title">Neon Breaker</h2></div><button class="icon-button" data-close aria-label="Вернуться в зал">${icon('close')}</button></div><div class="mini-stats"><span>ОЧКИ <strong id="score">0000</strong></span><span>РЕКОРД <strong id="best">0000</strong></span><span>ЖИЗНИ <strong id="lives">● ● ●</strong></span></div><div class="mini-stage"><div id="card-dealer-stage" hidden></div><div id="mini-game"></div><div id="mini-message" class="mini-message"><h3 id="mini-message-title">Разбей все блоки</h3><p id="mini-message-copy">Лови мяч платформой. У тебя три жизни.</p><button class="primary-button" id="start-game">Начать игру</button></div></div><div class="demo-footer" hidden><span>Кредиты Luelon · Отдельно от кошелька клуба · Баланс сбрасывается при открытии</span><button type="button" class="text-button" id="retry-demo">Перезагрузить игру</button></div><div class="mini-bottom"><span>Мышь, палец или ← →</span><button class="text-button" data-close>Вернуться в зал <kbd>Esc</kbd></button></div></dialog>
  <dialog id="bar-dialog" class="bar-dialog"><button class="dialog-close icon-button" data-close aria-label="Вернуться в зал">×</button><span class="eyebrow">MIRA’S BAR</span><h2>Сделаем паузу?</h2><p>Угощение за счёт клуба.</p><div class="drink-list">${DRINKS.map(d=>`<button data-drink="${d.id}" style="--drink-color:${d.color}"><span class="drink-glass" aria-hidden="true">▰</span><span><strong>${d.name}</strong><small>${d.description}</small></span><span>↗</span></button>`).join('')}</div></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;
gameAudio.install();gameAudio.addSettingsButton(document.querySelector<HTMLElement>('.mini-bottom')!);
const layout=new RoomLayout();
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const miniDialog = $<HTMLDialogElement>('#mini-dialog');
new GameWindow(miniDialog);
const helpDialog = $<HTMLDialogElement>('#help-dialog');
const barDialog = $<HTMLDialogElement>('#bar-dialog');
let mini: ReturnType<typeof import('./game/breaker').createBreaker> | ReturnType<typeof import('./game/arcades').createArcade> | undefined;
let demoSlot: DemoSlot | undefined;
let ezSlots: EZSlotsGame | undefined;
let originalGames: OriginalGames | undefined;
let githubGames: GithubGames | undefined;
let sessionGames: CasinoSessionsUI | undefined;
let expansionGames: CasinoExpansionUI | undefined;
let variantGames: CasinoVariantsUI | undefined;
let nextVariantGames: CasinoNextVariantsUI | undefined;
let batchVariantGames: CasinoBatchVariantsUI | undefined;
let studioGames: StudioGamesUI | undefined;
let cardDealerStage: CardDealerStage | undefined;
let requestedVariant: VariantGameId | undefined;
let casinoGames: CasinoApiProUI | undefined;
let demoPreview: DemoPreview | undefined;
let activeGameId = 'breaker';
const descriptions: Record<string,{goal:string;controls:string}> = { breaker:{goal:'Разбей все блоки',controls:'Лови мяч платформой. Мышь, палец или стрелки.'}, orbit:{goal:'Защити орбиту',controls:'Сбей 20 кораблей. Стрельба автоматическая, движение мышью, пальцем или ← →.'}, drift:{goal:'Ночная тысяча',controls:'Проедь 1000 м, обходи машины и собирай монеты. ← → или касание полосы.'}, pixel:{goal:'Кристаллы ждут',controls:'Собери 5 кристаллов и найди выход за 75 секунд. Стрелки или касание клетки.'} };
let best = 0; try { best = Number(localStorage.getItem('royal-breaker-best')) || 0; } catch { /* Storage can be unavailable in private contexts. */ }
let openVersion = 0;
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3400); }
function variantCabinet(base: Cabinet, id: VariantGameId): Cabinet {
  return {...base,id,name:VARIANT_INFO[id].name,subtitle:VARIANT_INFO[id].tagline,wallet:true,github:false};
}
function mountCasinoMode(cabinet: Cabinet) {
  cardDealerStage?.destroy();cardDealerStage=undefined;
  $('#card-dealer-stage').hidden=true;
  originalGames?.destroy();originalGames=undefined;
  expansionGames?.destroy();expansionGames=undefined;
  variantGames?.destroy();variantGames=undefined;
  nextVariantGames?.destroy();nextVariantGames=undefined;
  batchVariantGames?.destroy();batchVariantGames=undefined;
  studioGames?.destroy();studioGames=undefined;
  githubGames?.destroy();githubGames=undefined;
  sessionGames?.destroy();sessionGames=undefined;
  ezSlots?.destroy();ezSlots=undefined;
  activeGameId=cabinet.id;miniDialog.dataset.game=cabinet.id;gameAudio.setGame(cabinet.id);
  $('#mini-title').textContent=cabinet.name;
  $('.mini-top .eyebrow').textContent=isVariantGame(cabinet.id)?'НОВЫЙ ВАРИАНТ / ЭТАЖ 1':'КЛАССИКА / ЭТАЖ 1';
  const practiceChips=isGithubGame(cabinet.id)&&!isExpansionGame(cabinet.id)&&!isSessionGame(cabinet.id);
  $('.mini-bottom>span').textContent=practiceChips?'Бесплатные игры с отдельными учебными фишками':'Общий тестовый кошелёк клуба';
  const baseId=isVariantGame(cabinet.id)?VARIANT_INFO[cabinet.id].base:cabinet.id;
  const base=CABINETS.find(c=>c.id===baseId)!;
  let choices=miniDialog.querySelector<HTMLElement>('.casino-mode-picker');
  if(!choices){choices=document.createElement('nav');choices.className='casino-mode-picker';choices.setAttribute('aria-label','Варианты игры');$('.mini-stage').before(choices);}
  choices.hidden=false;
  const modes=[base,...VARIANT_GAMES.filter(id=>VARIANT_INFO[id].base===baseId).map(id=>variantCabinet(base,id))];
  choices.innerHTML=modes.map(c=>`<button type="button" data-casino-mode="${c.id}" aria-pressed="${c.id===cabinet.id}">${c.id===baseId?'Классика':c.name}</button>`).join('');
  choices.querySelectorAll<HTMLButtonElement>('[data-casino-mode]').forEach(button=>button.onclick=()=>{
    if(button.dataset.casinoMode===activeGameId)return;
    mountCasinoMode(modes.find(c=>c.id===button.dataset.casinoMode)!);
    miniDialog.querySelector<HTMLButtonElement>(`[data-casino-mode="${activeGameId}"]`)?.focus({preventScroll:true});
  });
  if(isBatchVariantGame(cabinet.id))batchVariantGames=new CasinoBatchVariantsUI($('#mini-game'),cabinet.id);
  else if(isNextVariantGame(cabinet.id))nextVariantGames=new CasinoNextVariantsUI($('#mini-game'),cabinet.id);
  else if(isVariantGame(cabinet.id))variantGames=new CasinoVariantsUI($('#mini-game'),cabinet.id as BaseVariantGameId);
  else if(isExpansionGame(cabinet.id))expansionGames=new CasinoExpansionUI($('#mini-game'),cabinet.id);
  else if(isSessionGame(cabinet.id))sessionGames=new CasinoSessionsUI($('#mini-game'),cabinet.id);
  else if(isGithubGame(cabinet.id))githubGames=new GithubGames($('#mini-game'),cabinet.id);
  else if(cabinet.id==='royal-fruits')ezSlots=new EZSlotsGame($('#mini-game'));
  else originalGames=new OriginalGames($('#mini-game'),cabinet.id as OriginalGameId);
}
let openingCabinet = false;
async function play(cabinet: Cabinet) {
  if (openingCabinet || document.querySelector('dialog[open]')) return;
  if (!cabinet.playable) { toast(`${cabinet.name} пока недоступен.`); return; }
  const physical = CABINETS.find(c => c.id === cabinet.id) ?? CABINETS.find(c => isVariantGame(cabinet.id) && c.id === VARIANT_INFO[cabinet.id].base);
  if (!physical) return;
  openingCabinet = true;
  try {
    if (!await room.beginCabinet(physical)) {
      room.setLocked(Boolean(document.querySelector('dialog[open]')) || Boolean(social && social.client.status !== 'connected'));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, room.getState().reducedMotion ? 0 : 420));
    if (room.getState().security || (social && social.client.status !== 'connected')) { room.endCabinet(); return; }
    await openCabinetGame(cabinet);
  } catch {
    if (miniDialog.open) miniDialog.close();
    else room.endCabinet();
    room.setLocked(Boolean(document.querySelector('dialog[open]')) || Boolean(social && social.client.status !== 'connected'));
    toast('Не получилось открыть игру. Попробуй ещё раз.');
  } finally { openingCabinet = false; }
}
async function openCabinetGame(cabinet: Cabinet) {
  if (!cabinet.playable) { toast(`${cabinet.name} пока недоступен.`); return; }
  if (cabinet.provider) { casinoGames?.open(true); return; }
  if (miniDialog.open) return;
  activeGameId = cabinet.id;gameAudio.effect('cabinet');gameAudio.setGame(cabinet.demo ? 'demo' : cabinet.id);
  miniDialog.classList.toggle('demo-mode', !!cabinet.demo);
  miniDialog.classList.toggle('wallet-game-mode', !!cabinet.wallet);
  miniDialog.classList.toggle('originals-mode', cabinet.wallet === true || cabinet.github === true);
  miniDialog.classList.toggle('card-table-mode', isCardGame(cabinet.id));
  miniDialog.dataset.game = cabinet.id;
  $('.mini-stats').hidden = !!(cabinet.demo || cabinet.wallet || cabinet.github);
  $('.demo-footer').hidden = !cabinet.demo;
  $('.mini-top .eyebrow').textContent = cabinet.demo ? 'LUELON PLAY / ДЕМО' : 'ROYAL ORIGINALS / 01';
  $('.mini-bottom .settings-shortcut').hidden = !!cabinet.demo;
  $('.mini-bottom kbd').hidden = !!cabinet.demo;
  try { best = Number(localStorage.getItem('royal-'+activeGameId+'-best')) || 0; } catch { best=0; }
  $('#mini-title').textContent = cabinet.name;
  document.querySelector('.mini-bottom>span')!.textContent = cabinet.id==='pixel'?'Стрелки или касание клетки':cabinet.id==='drift'?'← → или касание полосы':'Мышь, палец или ← →';
  room.setLocked(true); miniDialog.showModal(); $('#mini-message').hidden = false;
  $('#mini-message-title').textContent = 'Загружаем автомат…'; $('#mini-message-copy').textContent = ''; $('#start-game').hidden = true;
  const version = ++openVersion;
  const modes=miniDialog.querySelector<HTMLElement>('.casino-mode-picker');if(modes)modes.hidden=true;
  if(isCardGame(cabinet.id)){
    $('#mini-message').hidden=true;
    $('#card-dealer-stage').hidden=false;
    $('.mini-top .eyebrow').textContent='КАРТОЧНЫЙ САЛОН / ЭТАЖ 3';
    const practice=isGithubGame(cabinet.id)&&!isExpansionGame(cabinet.id)&&!isSessionGame(cabinet.id);
    $('.mini-bottom>span').textContent=practice?'Отдельные учебные фишки':'Общий тестовый кошелёк клуба';
    cardDealerStage=new CardDealerStage($('#card-dealer-stage'),cabinet.id,$('#mini-game'),action=>room.setDealerAction(cabinet.id,action));
    if(isBatchVariantGame(cabinet.id))batchVariantGames=new CasinoBatchVariantsUI($('#mini-game'),cabinet.id);
    else if(isNextVariantGame(cabinet.id))nextVariantGames=new CasinoNextVariantsUI($('#mini-game'),cabinet.id);
    else if(isExpansionGame(cabinet.id))expansionGames=new CasinoExpansionUI($('#mini-game'),cabinet.id);
    else if(isSessionGame(cabinet.id))sessionGames=new CasinoSessionsUI($('#mini-game'),cabinet.id);
    else if(isGithubGame(cabinet.id))githubGames=new GithubGames($('#mini-game'),cabinet.id);
    return;
  }
  if(isVariantGame(cabinet.id)||VARIANT_GAMES.some(id=>VARIANT_INFO[id].base===cabinet.id)){
    $('#mini-message').hidden=true;mountCasinoMode(cabinet);return;
  }
  if (isStudioGame(cabinet.id)) {
    $('#mini-message').hidden = true;
    $('.mini-top .eyebrow').textContent = 'НОВЫЕ МИРЫ / ЭТАЖ 1';
    $('.mini-bottom>span').textContent = 'Общий тестовый кошелёк клуба';
    studioGames = new StudioGamesUI($('#mini-game'), cabinet.id);
    return;
  }
  if (isExpansionGame(cabinet.id)) {
    $('#mini-message').hidden = true;
    $('.mini-top .eyebrow').textContent = 'ЭТАЖ 1 / ТЕСТОВЫЙ КОШЕЛЁК';
    $('.mini-bottom>span').textContent = 'Общий демобаланс клуба';
    expansionGames = new CasinoExpansionUI($('#mini-game'), cabinet.id);
    return;
  }
  if (isSessionGame(cabinet.id)) {
    $('#mini-message').hidden = true;
    $('.mini-top .eyebrow').textContent = 'ЭТАЖ 1 / СТАВКИ';
    $('.mini-bottom>span').textContent = 'Выбери демокошелёк или настоящий USDT';
    sessionGames = new CasinoSessionsUI($('#mini-game'), cabinet.id);
    return;
  }
  if (cabinet.github && isGithubGame(cabinet.id)) {
    $('#mini-message').hidden = true;
    $('.mini-top .eyebrow').textContent = 'ЭТАЖ 1 / УЧЕБНЫЕ ИГРЫ';
    $('.mini-bottom>span').textContent = 'Бесплатные игры с отдельными учебными фишками';
    githubGames = new GithubGames($('#mini-game'), cabinet.id);
    return;
  }
  if (cabinet.wallet) {
    $('#mini-message').hidden = true;
    $('.mini-top .eyebrow').textContent = 'РОЯЛЬ / ДЕМОКОШЕЛЁК';
    $('.mini-bottom>span').textContent = 'Ставки и выигрыши в виртуальных монетах';
    if (cabinet.id === 'royal-fruits') ezSlots = new EZSlotsGame($('#mini-game'));
    else originalGames = new OriginalGames($('#mini-game'), cabinet.id as OriginalGameId);
    return;
  }
  if (cabinet.demo) {
    $('#mini-message').hidden = true;
    $('.mini-bottom>span').textContent = 'Звук и управление внутри игры';
    demoSlot = new DemoSlot($('#mini-game'), name => { if (miniDialog.open && version === openVersion) $('#mini-title').textContent = name; });
    return;
  }
  try {
    const module = cabinet.id==='breaker' ? await import('./game/breaker') : await import('./game/arcades');
    if (!miniDialog.open || version !== openVersion) return;
    let previousPhase = '';
    const onStatus = (state: BreakerStatus) => {
      if (state.phase !== previousPhase && (state.phase === 'won' || state.phase === 'lost')) room.reactToGame(state.phase === 'won' ? 'win' : 'lose');
      previousPhase = state.phase;
      $('#score').textContent = String(state.score).padStart(4, '0');
      if (state.score > best) { best = state.score; try { localStorage.setItem('royal-'+activeGameId+'-best', String(best)); } catch { /* Keep the current record in memory. */ } }
      $('#best').textContent = String(best).padStart(4, '0'); $('#lives').textContent = '● '.repeat(state.lives) || '0';
      $('#mini-message').hidden = state.phase === 'playing'; $('#start-game').hidden = false;
      $('#mini-message-title').textContent = state.phase === 'won' ? 'Красиво сыграно!' : state.phase === 'lost' ? 'Ещё один раунд?' : descriptions[cabinet.id].goal;
      $('#mini-message-copy').textContent = state.phase === 'won' ? 'Отличный результат! Попробуй побить свой рекорд.' : state.phase === 'lost' ? `Твой результат: ${state.score} очков.` : descriptions[cabinet.id].controls;
      $('#start-game').textContent = state.phase === 'won' || state.phase === 'lost' ? 'Сыграть ещё' : cabinet.id==='breaker' && state.lives < 3 ? 'Продолжить' : 'Начать игру';
    };
    mini = 'createBreaker' in module ? module.createBreaker($('#mini-game'),onStatus) : module.createArcade($('#mini-game'),cabinet.id as ArcadeMode,onStatus);
  } catch {
    miniDialog.close(); toast('Не получилось загрузить игру. Попробуй открыть автомат ещё раз.');
  }
}
const room = new RoomScene({
  onNear: cabinet => {
    $('#interaction').hidden = !cabinet;
    document.querySelectorAll<HTMLButtonElement>('[data-cabinet]').forEach(el => el.classList.toggle('near', el.dataset.cabinet === cabinet?.id));
    if (cabinet) {
      const card=isCardGame(cabinet.id);
      $('#machine-kind').textContent=card?'КАРТОЧНЫЙ СТОЛ':'ИГРОВОЙ АВТОМАТ';
      $('#machine-name').textContent=card?`${cabinet.name} · ${dealerForGame(cabinet.id)!.name}`:cabinet.name;
      const occupant = room.cabinetOccupant(cabinet.id);
      $('#interact-label').textContent=occupant?'Занято':cabinet.playable?(card?'Сесть за стол':'Играть'):'Осмотреть';
      $<HTMLButtonElement>('#interact').disabled=Boolean(occupant);
      $('#machine-name').textContent += occupant ? ' · играет ' + occupant : '';
    }
    demoPreview?.updateNear(cabinet);
  },
  onPlay: cabinet => {
    const variant=requestedVariant;requestedVariant=undefined;
    void play(variant&&VARIANT_INFO[variant].base===cabinet.id?variantCabinet(cabinet,variant):cabinet);
  },
  onReady: () => { new ClubMap(room);
    $('#loading').remove();
    catalogCabinets.forEach((c, artIndex) => {
      const i=CABINETS.indexOf(c);
      const img = document.createElement('img'); img.src = game.textures.getBase64(`cabinet-${i}`); img.alt = ''; document.querySelector(`#art-${artIndex}`)?.append(img);
    });
    if (CABINETS.some(cabinet => cabinet.demo)) demoPreview = new DemoPreview();
    new DemoWalletUI(room);
    casinoGames = new CasinoApiProUI(room, playing => { if (!playing) room.endCabinet(); });
    new NileWalletUI(room);
    new UsdtWalletUI(room);
    new CryptoWalletUI(room);
    const portrait = document.createElement('img'); portrait.src = game.textures.getBase64('citizen-0', 'down-6'); portrait.alt = ''; $('#player-portrait').append(portrait);
    if (!offline) social = new SocialUI(room, toast);
    else { room.onActivity=()=>toast('Войди в онлайн-зал, чтобы играть вместе и слушать рояль.'); prefetchDemoGames(); }
    new CatUI(room);
    if (offline) {
      const settings=document.createElement('dialog');settings.id='name-dialog';settings.className='join-dialog auth-dialog';settings.setAttribute('aria-labelledby','name-title');
      settings.innerHTML='<h2 id="name-title">Настройки игрока</h2><button type="button" id="close-settings" class="primary-button">Готово</button>';
      settings.querySelector('h2')!.after(gameAudio.createSettings());document.body.append(settings);
      const button=document.createElement('button');button.type='button';button.className='logout-button';button.textContent='Настройки';button.setAttribute('aria-label','Настройки игрока');document.querySelector('.profile')!.append(button);
      button.addEventListener('click',()=>{room.setLocked(true);settings.showModal();});
      settings.querySelector('#close-settings')!.addEventListener('click',()=>settings.close());
      settings.addEventListener('close',()=>room.setLocked(Boolean(document.querySelector('dialog[open]'))));
    }
    layout.attach(room);
    updateHall(room.hall);
  },
});
const miraChat = new MiraChat(barDialog, {
  portraitFrame: (action, frame) => room.getPortraitFrame(action, frame),
  playerState: () => room.getDialoguePlayer(),
  onDrink: id => room.orderDrink(id),
});
const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: WORLD.width, height: WORLD.height,
  backgroundColor: '#191d35', pixelArt: false, roundPixels: false,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
  input: { windowEvents:false },
  scene: [room], audio: { noAudio: true }, banner: false,
});
new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width>0&&height>0)game.scale.resize(Math.floor(width),Math.floor(height));}).observe($('#game'));
document.querySelectorAll<HTMLButtonElement>('[data-cabinet]').forEach(button => button.addEventListener('click', () => {requestedVariant=undefined;room.approach(button.dataset.cabinet!);}));
new StudioCatalog($('#studio-catalog'), id => { requestedVariant=undefined; room.approach(id); });
new CardTablesCatalog($('#card-tables-catalog'), id => { requestedVariant=undefined; room.approach(id); });
$('#floor-links').addEventListener('click', event => {
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-floor-target]');
  const link=hallLinks(room.hall).find(link=>link.target===button?.dataset.floorTarget);
  if(!link)return;
  requestedVariant=undefined;layout.closePanels();room.approachFloor(link.target);
});
document.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach(button=>button.onclick=()=>{const id=button.dataset.variant;if(!isVariantGame(id))return;requestedVariant=id;room.approach(CABINETS.some(c=>c.id===id)?id:VARIANT_INFO[id].base);});
$('#game').addEventListener('pointerdown',()=>{requestedVariant=undefined;});
$('#interact').addEventListener('click', () => room.interact());
$('#help').addEventListener('click', () => { room.setLocked(true); helpDialog.showModal(); });
$('#start-game').addEventListener('click', () => mini?.start());
$('#retry-demo').addEventListener('click', () => { void demoSlot?.load(); });
room.onBar = () => { room.setLocked(true); miraChat.open(); if (!barDialog.open) barDialog.show(); };
room.onNotice = toast;
document.addEventListener(GAME_REACTION_EVENT, event => {
  const reaction = (event as CustomEvent<{reaction?:string}>).detail?.reaction;
  if (reaction === 'win' || reaction === 'lose') room.reactToGame(reaction);
});
function updateHall(hall:HallId){
  document.querySelector('h1')!.innerHTML=HALLS[hall].name+' <span>'+HALLS[hall].number+'</span>';
  document.querySelectorAll<HTMLElement>('[data-activity]').forEach(b=>b.hidden=b.dataset.activity==='piano'||activityHall(b.dataset.activity!)!==hall);
  const sharedCards=document.querySelector<HTMLElement>('.shared-cards');if(sharedCards)sharedCards.hidden=hall!=='tables';
  requestedVariant=undefined;$('.variant-catalog').hidden=hall!=='arcade';
  $('#studio-catalog').hidden=hall!=='arcade';
  $('#card-tables-catalog').hidden=hall!=='github';
  $('#floor-links').innerHTML=hallLinks(hall).map(link=>{
    const target=HALLS[link.target];
    return `<button type="button" data-floor-target="${link.target}" aria-label="На ${target.floor} этаж: ${target.name}"><span aria-hidden="true">${target.floor>HALLS[hall].floor?'↑':'↓'}</span> Этаж ${target.floor}</button>`;
  }).join('');
  document.querySelectorAll<HTMLElement>('[data-cabinet]').forEach(card=>card.hidden=card.dataset.hall!==hall);
  $('.cabinet-list').hidden=!catalogCabinets.some(c=>cabinetHall(c)===hall);$('.lounge-controls').hidden=hall!=='arcade';
  const gameCount=hallGameCount(hall);
  $('.sidebar-heading span').textContent=String(gameCount).padStart(2,'0');
  const gamesTab=document.querySelector<HTMLButtonElement>('#games-tab');if(gamesTab)gamesTab.textContent='Игры · '+String(gameCount);
  social?.activities.hallChanged();
}
room.onHall=updateHall;
$('#visit-bar').addEventListener('click',()=>room.approachBar());
$('#stand-up').addEventListener('click',()=>room.stand());
for (const dialog of [miniDialog, helpDialog, barDialog]) {
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); const { clientX: x, clientY: y } = event; if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => {
    if(dialog===miniDialog){
      if(isCardGame(activeGameId))room.setDealerAction(activeGameId,'idle');
      cardDealerStage?.destroy();cardDealerStage=undefined;
      $('#card-dealer-stage').hidden=true;$('#card-dealer-stage').replaceChildren();
    }
    if (dialog === miniDialog) { room.endCabinet(); openVersion++; demoSlot?.destroy(); demoSlot = undefined; ezSlots?.destroy(); ezSlots = undefined; originalGames?.destroy(); originalGames = undefined; githubGames?.destroy(); githubGames = undefined; sessionGames?.destroy(); sessionGames = undefined; expansionGames?.destroy(); expansionGames = undefined;variantGames?.destroy();variantGames=undefined;nextVariantGames?.destroy();nextVariantGames=undefined;batchVariantGames?.destroy();batchVariantGames=undefined;studioGames?.destroy();studioGames=undefined; gameAudio.setGame('');mini?.game.destroy(true); mini = undefined; $('#mini-game').replaceChildren(); }
    room.setLocked(Boolean(document.querySelector('dialog[open]'))); $('#game').focus({ preventScroll: true });
  });
}
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('Полный экран недоступен в этом браузере.'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && miniDialog.open) { mini?.game.scene.pause(activeGameId); } else if (miniDialog.open) { mini?.game.scene.resume(activeGameId); } });
// Read-only diagnostics for browser smoke checks.
Object.assign(window, { royalDemo: { getState: () => room.getState(), getMiniState: () => mini?.getState() ?? null, getNetworkState: () => social?.client.getState() ?? null, getAudio: () => gameAudio.getState(), getActivities: () => social?.activities.getState() ?? null } });
