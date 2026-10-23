import { IndependentGameUI } from './modules/IndependentGameUI';
import { prepareGameModule } from './modules/GameModulePreparation';
import { gameModuleContract } from './modules/GameModuleCatalog';
import { installLanguageSwitcher, t as translateText, tr } from './i18n/index';
import { GAME_REACTION_EVENT } from './ui/gameReactions';
import { GameViewport } from './ui/GameViewport';
import { RoyalPlatformCatalog, platformGameCabinet, type PlatformChoice } from './ui/RoyalPlatformCatalog';
import { CardTablesCatalog } from './ui/CardTablesCatalog';
import { CardDealerStage } from './ui/CardDealerStage';
import { isCardGame, dealerForGame } from './shared/cardTables';
import './ui/floor-navigation.css';
import { isStudioGame } from './shared/studioGames';
import { isVariantGame } from './shared/casinoVariants';
import { ROYAL_PLATFORM_GAMES, isPlatformGame, isRetiredArcadeGame } from './shared/arcadeCatalog';
import { RetiredArcadeRounds, RetiredArcadeRoundGuard, ownsRetiredArcadeRound, type RetiredArcadeRound } from './ui/RetiredArcadeRounds';
import { isExpansionGame, EXPANSION_NAMES } from './shared/casinoExpansion';
import { isSessionGame } from './shared/casinoSessions';
import { ClubMap } from './ui/ClubMap';
import { NileWalletUI } from './ui/NileWalletUI';
import { MiraChat } from './ui/MiraChat';
import { isGithubGame } from './shared/githubGames';
import './demo-preview.css';
import { gameAudio } from './game/GameAudio';
import Phaser from 'phaser';
import { RoomScene, CABINETS, type Cabinet } from './game/RoomScene';
import { cabinetHall, cabinetsInHall } from './shared/cabinets';
import { WORLD } from './game/navigation';
import './style.css';
import './paper-theme.css';
import './own-cabinets.css';
import './mira-dialog.css';
import { DRINKS, HALLS, hallLinks, activityHall, type HallId } from './shared/world';
import type { BreakerStatus } from './game/breaker';
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
const catalogCabinets = cabinetsInHall('arcade');
const hallGameCount = (hall: HallId) => hall === 'arcade' ? ROYAL_PLATFORM_GAMES.length : cabinetsInHall(hall).length + (hall === 'tables'||hall==='github' ? 3 : 0);
const cabinetCards = (cabinets: Cabinet[]) => cabinets.map(cabinet => {
  const index = catalogCabinets.indexOf(cabinet);
  return tr`<button id="${'cabinet-' + cabinet.id}" class="cabinet-card" data-cabinet="${cabinet.id}" data-hall="${cabinetHall(cabinet)}" aria-label="Подойти к автомату ${cabinet.name}"><div class="cabinet-art art-${index}" id="art-${index}"></div><div class="cabinet-copy">${cabinet.demo ? translateText('<span class="card-kicker">ДЕМО</span>') : ''}<strong>${cabinet.name}</strong><small>${cabinet.subtitle}</small></div>${icon('arrow', 'card-arrow')}</button>`;
}).join('');
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = tr`
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
        <section id="card-tables-catalog" aria-label="Карточные столы и крупье" hidden></section>
        <section class="arcade-catalog-group" data-arcade-catalog aria-label="Автоматы Рояль"><h3>20 автоматов Рояль</h3><p>Игра с обложки открывается сразу. Внутри каждого автомата есть каталог RoyalGames и GitHub-игр.</p><div class="cabinet-list">${cabinetCards(catalogCabinets)}</div></section>
        <section data-arcade-catalog><div id="retired-arcade-rounds" hidden></div></section>
        <div class="player-card"><span class="player-portrait" id="player-portrait"></span><div><strong>Это ты</strong><small>Исследователь клуба</small></div><span class="player-dot"></span></div>
      </aside>
    </div>
    <footer class="footer room-dock"><nav class="panel-tabs" aria-label="Панели зала"></nav><button id="panel-close" type="button" hidden>Закрыть панель ×</button><span class="dock-hint">WASD · стрелки · Shift: бег</span><button id="room-overview" type="button" aria-pressed="false">Весь этаж</button></footer>
  </main>
  <dialog id="help-dialog" class="help-dialog"><button class="dialog-close icon-button" data-close aria-label="Закрыть">${icon('close')}</button><h2>Как играть</h2><div class="help-steps"><p><span>01</span>WASD или стрелки: идти. Shift: бежать. Нажатие на пол: бежать к точке.</p><p><span>02</span>Нажми на автомат, стол или его карточку, чтобы подойти. Рядом нажми E, чтобы играть.</p><p><span>03</span>Первый этаж: автоматы и казино-игры. Второй этаж: шахматы, бильярд и аэрохоккей. Третий этаж: карточные столы с крупье. Поднимайся по светящимся лестницам или нажимай кнопки этажей наверху. Кнопка «Игры» открывает список текущего этажа.</p></div><button class="primary-button" data-close>Понятно ${icon('game')}</button></dialog>
  <dialog id="mini-dialog" class="mini-dialog" aria-labelledby="mini-title"><div class="mini-top"><div><span class="eyebrow">ROYAL ORIGINALS / 01</span><h2 id="mini-title">Neon Breaker</h2></div><button type="button" id="studio-game-list" hidden>Все игры</button><button class="icon-button" data-close aria-label="Вернуться в зал">${icon('close')}</button></div><div class="mini-stats"><span>ОЧКИ <strong id="score">0000</strong></span><span>РЕКОРД <strong id="best">0000</strong></span><span>ЖИЗНИ <strong id="lives">● ● ●</strong></span></div><div class="mini-stage"><div id="card-dealer-stage" hidden></div><div id="mini-game"></div><div id="mini-message" class="mini-message"><h3 id="mini-message-title">Разбей все блоки</h3><p id="mini-message-copy">Лови мяч платформой. У тебя три жизни.</p><button class="primary-button" id="start-game">Начать игру</button></div></div><div class="demo-footer" hidden><span>Кредиты Luelon · Отдельно от кошелька клуба · Баланс сбрасывается при открытии</span><button type="button" class="text-button" id="retry-demo">Перезагрузить игру</button></div><div class="mini-bottom"><span>Мышь, палец или ← →</span><button class="text-button" data-close>Вернуться в зал <kbd>Esc</kbd></button></div></dialog>
  <dialog id="bar-dialog" class="bar-dialog"><button class="dialog-close icon-button" data-close aria-label="Вернуться в зал">×</button><span class="eyebrow">MIRA’S BAR</span><h2>Сделаем паузу?</h2><p>Угощение за счёт клуба.</p><div class="drink-list">${DRINKS.map(d=>`<button data-drink="${d.id}" style="--drink-color:${d.color}"><span class="drink-glass" aria-hidden="true">▰</span><span><strong>${d.name}</strong><small>${d.description}</small></span><span>↗</span></button>`).join('')}</div></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;
installLanguageSwitcher(document.querySelector<HTMLElement>('.profile')!);
gameAudio.install();gameAudio.addSettingsButton(document.querySelector<HTMLElement>('.mini-bottom')!);
const layout=new RoomLayout();
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const miniDialog = $<HTMLDialogElement>('#mini-dialog');
new GameViewport(miniDialog);
const helpDialog = $<HTMLDialogElement>('#help-dialog');
const barDialog = $<HTMLDialogElement>('#bar-dialog');
let mini: IndependentGameUI | undefined;
let cardDealerStage: CardDealerStage | undefined;
let retiredRoundGuard: RetiredArcadeRoundGuard | undefined;
let activeGameId = 'breaker';
const descriptions: Record<string,{goal:string;controls:string}> = { breaker:{goal:translateText('Разбей все блоки'),controls:translateText('Лови мяч платформой. Мышь, палец или стрелки.')}, orbit:{goal:translateText('Защити орбиту'),controls:translateText('Сбей 20 кораблей. Стрельба автоматическая, движение мышью, пальцем или ← →.')}, drift:{goal:translateText('Ночная тысяча'),controls:translateText('Проедь 1000 м, обходи машины и собирай монеты. ← → или касание полосы.')}, pixel:{goal:translateText('Кристаллы ждут'),controls:translateText('Собери 5 кристаллов и найди выход за 75 секунд. Стрелки или касание клетки.')} };
let best = 0; try { best = Number(localStorage.getItem('royal-breaker-best')) || 0; } catch { /* Storage can be unavailable in private contexts. */ }
let openVersion = 0;
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3400); }
let openingCabinet = false;
function prepareCabinet(id:string) {
  const contract=gameModuleContract(id);
  if(!contract)return;
  room.deferDecorations();void prepareGameModule(contract.gameId);
}
let platformCabinet: Cabinet | undefined;
let platformSelection: RoyalPlatformCatalog | undefined;
let selectedPlatformGame: PlatformChoice | undefined;
let requestedProvider = false;
function clearPlatformView() {
  openVersion++;
  mini?.destroy(); mini = undefined;
  platformSelection?.destroy(); platformSelection = undefined;
  $('#mini-game').replaceChildren();
}
function showPlatformCatalog() {
  if (!platformCabinet) return;
  const selected = selectedPlatformGame;
  clearPlatformView(); gameAudio.setGame('');
  miniDialog.classList.remove('demo-mode', 'card-table-mode');
  miniDialog.classList.add('wallet-game-mode', 'originals-mode');
  miniDialog.dataset.game = 'royal-catalog';
  $('#mini-title').textContent = translateText('Выбери игру');
  $('.mini-top .eyebrow').textContent = 'ROYAL PLATFORM / 01';
  $('#studio-game-list').hidden = true;
  $('.mini-stats').hidden = true; $('.demo-footer').hidden = true;
  $('#mini-message').hidden = true; $('#card-dealer-stage').hidden = true;
  $('.mini-bottom>span').textContent = translateText('Общий тестовый кошелёк клуба');
  $('.mini-bottom .settings-shortcut').hidden = false; $('.mini-bottom kbd').hidden = false;
  room.setLocked(true);
  if (!miniDialog.open) miniDialog.showModal();
  platformSelection = new RoyalPlatformCatalog($('#mini-game'), choice => { void selectPlatformGame(choice); }, selected);
}
async function selectPlatformGame(choice: PlatformChoice) {
  if (!platformCabinet || !miniDialog.open || !isPlatformGame(choice.gameId)) return;
  prepareCabinet(choice.gameId);
  await openCabinetGame(platformGameCabinet(choice.gameId, platformCabinet), undefined, true, choice);
}

$('#studio-game-list').addEventListener('click', showPlatformCatalog);
async function play(cabinet: Cabinet) {
  if (openingCabinet || document.querySelector('dialog[open]')) return;
  if (!cabinet.playable) { toast(tr`${cabinet.name} пока недоступен.`); return; }
  const physical = CABINETS.find(c => c.id === cabinet.id);
  if (!physical) return;
  prepareCabinet(cabinet.defaultGameId ?? cabinet.id);
  openingCabinet = true;
  try {
    if (!await room.beginCabinet(physical)) {
      room.setLocked(Boolean(document.querySelector('dialog[open]')) || Boolean(social && social.client.status !== 'connected'));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, room.getState().reducedMotion ? 0 : 420));
    if (room.getState().security || (social && social.client.status !== 'connected')) { room.endCabinet(); return; }
    if (cabinet.defaultGameId) {
      platformCabinet = cabinet;
      const choice = {gameId:cabinet.defaultGameId};
      await openCabinetGame(platformGameCabinet(choice.gameId, cabinet), undefined, false, choice);
      if (requestedProvider) await selectPlatformGame({gameId:'casinoapipro'});
    } else await openCabinetGame(cabinet);
  } catch {
    if (miniDialog.open) miniDialog.close();
    else room.endCabinet();
    room.setLocked(Boolean(document.querySelector('dialog[open]')) || Boolean(social && social.client.status !== 'connected'));
    toast(translateText('Не получилось открыть игру. Попробуй ещё раз.'));
  } finally { openingCabinet = false; requestedProvider = false; }
}
async function openCabinetGame(cabinet: Cabinet, recovery?: RetiredArcadeRound, switchPlatform = false, choice?: PlatformChoice) {
  if (switchPlatform && (!platformCabinet || !miniDialog.open || !isPlatformGame(cabinet.id))) return;
  if (isRetiredArcadeGame(cabinet.id) && (!recovery || recovery.gameId !== cabinet.id || !ownsRetiredArcadeRound(recovery))) return;
  if (!cabinet.playable) { toast(tr`${cabinet.name} пока недоступен.`); return; }
  if (miniDialog.open && !switchPlatform) return;
  if (switchPlatform) clearPlatformView();
  if (platformCabinet) selectedPlatformGame = choice ?? {gameId:cabinet.id};
  $('#studio-game-list').hidden = !platformCabinet;
  activeGameId = cabinet.id;gameAudio.effect('cabinet');gameAudio.setGame(cabinet.demo ? 'demo' : cabinet.id);
  miniDialog.classList.toggle('demo-mode', !!cabinet.demo);
  miniDialog.classList.toggle('wallet-game-mode', !!cabinet.wallet);
  miniDialog.classList.toggle('originals-mode', !!platformCabinet || cabinet.wallet === true || cabinet.github === true);
  miniDialog.classList.toggle('card-table-mode', isCardGame(cabinet.id));
  miniDialog.dataset.game = cabinet.id;
  $('.mini-stats').hidden = !!(platformCabinet || cabinet.demo || cabinet.wallet || cabinet.github);
  $('.demo-footer').hidden = !cabinet.demo;
  $('.mini-top .eyebrow').textContent = cabinet.demo ? translateText('LUELON PLAY / ДЕМО') : 'ROYAL ORIGINALS / 01';
  $('.mini-bottom .settings-shortcut').hidden = !!cabinet.demo;
  $('.mini-bottom kbd').hidden = !!cabinet.demo;
  try { best = Number(localStorage.getItem('royal-'+activeGameId+'-best')) || 0; } catch { best=0; }
  $('#mini-title').textContent = cabinet.name;
  document.querySelector('.mini-bottom>span')!.textContent = cabinet.id==='pixel'?translateText('Стрелки или касание клетки'):cabinet.id==='drift'?translateText('← → или касание полосы'):translateText('Мышь, палец или ← →');
  room.setLocked(true); miniDialog.showModal(); $('#mini-message').hidden = false;
  $('#mini-message-title').textContent = translateText('Загружаем автомат…'); $('#mini-message-copy').textContent = ''; $('#start-game').hidden = true;
  const version = ++openVersion;
  if(isCardGame(cabinet.id)){
    $('#mini-message').hidden=true;
    $('#card-dealer-stage').hidden=false;
    $('.mini-top .eyebrow').textContent=translateText('КАРТОЧНЫЙ САЛОН / ЭТАЖ 3');
    const practice=isGithubGame(cabinet.id)&&!isExpansionGame(cabinet.id)&&!isSessionGame(cabinet.id);
    $('.mini-bottom>span').textContent=practice?translateText('Отдельные учебные фишки'):translateText('Общий баланс USDT · Nile');
    cardDealerStage=new CardDealerStage($('#card-dealer-stage'),cabinet.id,$('#mini-game'),action=>room.setDealerAction(cabinet.id,action));
  } else if (isStudioGame(cabinet.id)) {
    $('.mini-top .eyebrow').textContent = 'ROYAL PLATFORM / 01';
    $('.mini-bottom>span').textContent = translateText('Общий тестовый кошелёк клуба');
  } else if (isVariantGame(cabinet.id) || isExpansionGame(cabinet.id)) {
    $('.mini-top .eyebrow').textContent = translateText('ЭТАЖ 1 / ТЕСТОВЫЙ КОШЕЛЁК');
    $('.mini-bottom>span').textContent = translateText('Общий баланс USDT · Nile');
  } else if (isSessionGame(cabinet.id)) {
    $('.mini-top .eyebrow').textContent = translateText('ЭТАЖ 1 / СТАВКИ');
    $('.mini-bottom>span').textContent = translateText('Общий баланс USDT · Nile');
  } else if (cabinet.github && isGithubGame(cabinet.id)) {
    $('.mini-top .eyebrow').textContent = translateText('ЭТАЖ 1 / УЧЕБНЫЕ ИГРЫ');
    $('.mini-bottom>span').textContent = translateText('Бесплатные игры с отдельными учебными фишками');
  } else if (cabinet.wallet) {
    $('.mini-top .eyebrow').textContent = translateText('РОЯЛЬ / USDT · NILE');
    $('.mini-bottom>span').textContent = translateText('Общий баланс USDT · Nile');
  } else if (cabinet.demo) {
    $('.mini-bottom>span').textContent = translateText('Звук и управление внутри игры');
  }
  const contract = gameModuleContract(cabinet.id);
  if (!contract) { miniDialog.close(); toast(translateText('Не получилось загрузить игру. Попробуй открыть автомат ещё раз.')); return; }
  if (!Object.hasOwn(descriptions, cabinet.id)) $('#mini-message').hidden = true;
  let previousPhase = '';
  const onStatus = (state: BreakerStatus) => {
      if (!miniDialog.open || version !== openVersion) return;
      if (state.phase !== previousPhase && (state.phase === 'won' || state.phase === 'lost')) room.reactToGame(state.phase === 'won' ? 'win' : 'lose');
      previousPhase = state.phase;
      $('#score').textContent = String(state.score).padStart(4, '0');
      if (state.score > best) { best = state.score; try { localStorage.setItem('royal-'+activeGameId+'-best', String(best)); } catch { /* Keep the current record in memory. */ } }
      $('#best').textContent = String(best).padStart(4, '0'); $('#lives').textContent = '● '.repeat(state.lives) || '0';
      $('#mini-message').hidden = state.phase === 'playing'; $('#start-game').hidden = false;
      $('#mini-message-title').textContent = state.phase === 'won' ? translateText('Красиво сыграно!') : state.phase === 'lost' ? translateText('Ещё один раунд?') : descriptions[cabinet.id].goal;
      $('#mini-message-copy').textContent = state.phase === 'won' ? translateText('Отличный результат! Попробуй побить свой рекорд.') : state.phase === 'lost' ? tr`Твой результат: ${state.score} очков.` : descriptions[cabinet.id].controls;
      $('#start-game').textContent = state.phase === 'won' || state.phase === 'lost' ? translateText('Сыграть ещё') : cabinet.id==='breaker' && state.lives < 3 ? translateText('Продолжить') : translateText('Начать игру');
    };

  mini = new IndependentGameUI($('#mini-game'), contract.gameId, {
    onStatus,
    scene: room,
    onClosed: () => { if (version === openVersion && miniDialog.open) showPlatformCatalog(); },
    provider: cabinet.id === 'casinoapipro' && platformCabinet ? {embedded:true, gameId:choice?.providerGame?.id, gameName:choice?.providerGame?.name, onCatalogue:showPlatformCatalog} : undefined,
    setTitle: name => { if (miniDialog.open && version === openVersion) $('#mini-title').textContent = name; },
  });
}
const room = new RoomScene({
  onNear: cabinet => {
    $('#interaction').hidden = !cabinet;
    document.querySelectorAll<HTMLButtonElement>('[data-cabinet]').forEach(el => el.classList.toggle('near', el.dataset.cabinet === cabinet?.id));
    if (cabinet) {
      const card=isCardGame(cabinet.id);
      $('#machine-kind').textContent=card?translateText('КАРТОЧНЫЙ СТОЛ'):translateText('ИГРОВОЙ АВТОМАТ');
      $('#machine-name').textContent=card?`${cabinet.name} · ${dealerForGame(cabinet.id)!.name}`:cabinet.name;
      const occupant = room.cabinetOccupant(cabinet.id);
      $('#interact-label').textContent=occupant?translateText('Занято'):cabinet.playable?(card?translateText('Сесть за стол'):translateText('Играть')):translateText('Осмотреть');
      $<HTMLButtonElement>('#interact').disabled=Boolean(occupant);
      $('#machine-name').textContent += occupant ? translateText(' · играет ') + occupant : '';
    }
  },
  onPlay: cabinet => { void play(cabinet); },
  onReady: () => { new ClubMap(room);
    $('#loading').remove();
    catalogCabinets.forEach((c, artIndex) => {
      const i=CABINETS.indexOf(c);
      const img = document.createElement('img'); img.src = game.textures.getBase64(`cabinet-${i}`); img.alt = ''; document.querySelector(`#art-${artIndex}`)?.append(img);
    });
    new NileWalletUI(room);
    const portrait = document.createElement('img'); portrait.src = game.textures.getBase64('citizen-0', 'down-6'); portrait.alt = ''; $('#player-portrait').append(portrait);
    if (!offline) social = new SocialUI(room, toast);
    else { room.onActivity=()=>toast(translateText('Войди в онлайн-зал, чтобы играть вместе и слушать рояль.')); }
    new CatUI(room);
    if (offline) {
      const settings=document.createElement('dialog');settings.id='name-dialog';settings.className='join-dialog auth-dialog';settings.setAttribute('aria-labelledby','name-title');
      settings.innerHTML=translateText('<h2 id="name-title">Настройки игрока</h2><button type="button" id="close-settings" class="primary-button">Готово</button>');
      settings.querySelector('h2')!.after(gameAudio.createSettings());document.body.append(settings);
      const button=document.createElement('button');button.type='button';button.className='logout-button';button.textContent=translateText('Настройки');button.setAttribute('aria-label',translateText('Настройки игрока'));document.querySelector('.profile')!.append(button);
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
room.onApproach = prepareCabinet;
let intentTimer: ReturnType<typeof setTimeout>;
const cabinetIntent = (event: Event) => {
  clearTimeout(intentTimer);
  if (document.querySelector('dialog[open]') || !(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLElement>('[data-cabinet],[data-studio],[data-card-table]');
  const id = button?.dataset.cabinet ?? button?.dataset.studio ?? button?.dataset.cardTable;
  if (!id) return;
  if (event.type === 'pointerover') intentTimer = setTimeout(() => prepareCabinet(id), 120);
  else prepareCabinet(id);
};
document.addEventListener('pointerover', cabinetIntent);
document.addEventListener('focusin', cabinetIntent);
document.addEventListener('pointerdown', cabinetIntent);
const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: WORLD.width, height: WORLD.height,
  backgroundColor: '#191d35', pixelArt: false, roundPixels: false,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
  input: { windowEvents:false },
  scene: [room], audio: { noAudio: true }, banner: false,
});
new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width>0&&height>0)game.scale.resize(Math.floor(width),Math.floor(height));}).observe($('#game'));
document.querySelectorAll<HTMLButtonElement>('[data-cabinet]').forEach(button => button.addEventListener('click', () => room.approach(button.dataset.cabinet!)));
window.addEventListener('royal-open-casinoapipro', () => {
  if (platformCabinet && miniDialog.open) { void selectPlatformGame({gameId:'casinoapipro'}); return; }
  if (room.hall !== 'arcade' || document.querySelector('dialog[open]')) return;
  const state=room.getState();
  const cabinet=cabinetsInHall('arcade').filter(c=>!room.cabinetOccupant(c.id)).sort((a,b)=>Math.hypot(a.x-state.x,a.y-state.y)-Math.hypot(b.x-state.x,b.y-state.y))[0];
  if(!cabinet)return;
  room.setLocked(Boolean(social && social.client.status !== 'connected'));
  requestedProvider = true; room.approach(cabinet.id);
});
new CardTablesCatalog($('#card-tables-catalog'), id => room.approach(id));
new RetiredArcadeRounds($('#retired-arcade-rounds'), async round => {
  if (openingCabinet || document.querySelector('dialog[open]') || !ownsRetiredArcadeRound(round)) return;
  openingCabinet = true;
  try {
    const state = room.getState();
    if (state.hall !== 'arcade' || state.security || social && social.client.status !== 'connected') return;
    await openCabinetGame({id:round.gameId, name:EXPANSION_NAMES[round.gameId], subtitle:translateText('Сохранённая партия'), x:state.x, y:state.y, color:0xc8b17a, playable:true, wallet:true, hall:'arcade'}, round);
    if (miniDialog.open) retiredRoundGuard = new RetiredArcadeRoundGuard($('#mini-game'), round, () => miniDialog.close());
  } catch {
    if (miniDialog.open) miniDialog.close();
    throw Error(translateText('Не получилось открыть сохранённую партию. Обнови её и попробуй ещё раз.'));
  } finally { openingCabinet = false; }
});
$('#floor-links').addEventListener('click', event => {
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-floor-target]');
  const link=hallLinks(room.hall).find(link=>link.target===button?.dataset.floorTarget);
  if(!link)return;
  layout.closePanels();room.approachFloor(link.target);
});
$('#interact').addEventListener('click', () => room.interact());
$('#help').addEventListener('click', () => { room.setLocked(true); helpDialog.showModal(); });
$('#start-game').addEventListener('click', () => mini?.start());
$('#retry-demo').addEventListener('click', () => { void mini?.load(); });
room.onBar = () => { room.setLocked(true); miraChat.open(); if (!barDialog.open) barDialog.show(); };
room.onNotice = toast;
document.addEventListener(GAME_REACTION_EVENT, event => {
  const reaction = (event as CustomEvent<{reaction?:string}>).detail?.reaction;
  if (reaction === 'win' || reaction === 'lose') room.reactToGame(reaction);
});
function updateHall(hall:HallId){
  document.querySelector('h1')!.innerHTML=HALLS[hall].name+' <span>'+HALLS[hall].number+'</span>';
  document.querySelectorAll<HTMLElement>('[data-activity]').forEach(b=>b.hidden=b.dataset.activity==='piano'||activityHall(b.dataset.activity!)!==hall);
  const sharedCards=document.querySelector<HTMLElement>('.shared-cards');if(sharedCards)sharedCards.hidden=hall!=='tables'&&hall!=='github';
  document.querySelectorAll<HTMLElement>('[data-arcade-catalog]').forEach(section => section.hidden = hall !== 'arcade');
  $('#card-tables-catalog').hidden=hall!=='github';
  $('#floor-links').innerHTML=hallLinks(hall).map(link=>{
    const target=HALLS[link.target];
    return tr`<button type="button" data-floor-target="${link.target}" aria-label="На ${target.floor} этаж: ${target.name}"><span aria-hidden="true">${target.floor>HALLS[hall].floor?'↑':'↓'}</span> Этаж ${target.floor}</button>`;
  }).join('');
  document.querySelectorAll<HTMLElement>('[data-cabinet]').forEach(card=>card.hidden=card.dataset.hall!==hall);
  $('.lounge-controls').hidden=hall!=='arcade';
  const gameCount=hallGameCount(hall);
  $('.sidebar-heading span').textContent=String(gameCount).padStart(2,'0');
  const gamesTab=document.querySelector<HTMLButtonElement>('#games-tab');if(gamesTab)gamesTab.textContent=translateText('Игры · ')+String(gameCount);
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
      platformSelection?.destroy(); platformSelection = undefined; platformCabinet = undefined; selectedPlatformGame = undefined;
      $('#studio-game-list').hidden = true;
      retiredRoundGuard?.destroy(); retiredRoundGuard = undefined;
      if(isCardGame(activeGameId))room.setDealerAction(activeGameId,'idle');
      cardDealerStage?.destroy();cardDealerStage=undefined;
      $('#card-dealer-stage').hidden=true;$('#card-dealer-stage').replaceChildren();
    }
    if (dialog === miniDialog) { room.endCabinet(); openVersion++; mini?.destroy(); mini = undefined; gameAudio.setGame(''); $('#mini-game').replaceChildren(); }
    room.setLocked(Boolean(document.querySelector('dialog[open]'))); $('#game').focus({ preventScroll: true });
  });
}
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast(translateText('Полный экран недоступен в этом браузере.')); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && miniDialog.open) { mini?.pause(); } else if (miniDialog.open) { mini?.resume(); } });
// Read-only diagnostics for browser smoke checks.
Object.assign(window, { royalDemo: { getState: () => room.getState(), getMiniState: () => mini?.getState() ?? null, getNetworkState: () => social?.client.getState() ?? null, getAudio: () => gameAudio.getState(), getActivities: () => social?.activities.getState() ?? null } });
