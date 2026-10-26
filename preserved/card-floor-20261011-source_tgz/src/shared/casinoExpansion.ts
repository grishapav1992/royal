import { VARIANT_GAMES, VARIANT_NAMES, VARIANT_RULES, isVariantGame, validVariantSettings, type VariantSettings, type VariantView } from './casinoVariants';
import { STUDIO_GAMES, STUDIO_INFO, STUDIO_RULES, isStudioGame, validStudioSettings, type StudioSettings, type StudioView } from './studioGames';
export const BASE_EXPANSION_GAMES = ['github-diamonds','github-crash','github-three-card','github-caribbean','github-let-it-ride','github-ultimate','github-war','github-red-dog','github-pai-gow','github-dragon-tiger','github-deuces','github-sic-bo','github-mississippi','github-four-card','github-crazy-four','github-flush','github-holdem-bonus','github-oasis','github-russian','github-caribbean-draw','github-spanish','github-exposure','github-switch','github-free-bet','github-rummy','github-andar-bahar'] as const;
export const EXPANSION_GAMES = [...BASE_EXPANSION_GAMES,...VARIANT_GAMES,...STUDIO_GAMES] as const;
export type ExpansionGameId = typeof EXPANSION_GAMES[number];
export const EXPANSION_NAMES: Record<ExpansionGameId,string> = {
  ...Object.fromEntries(STUDIO_GAMES.map(id=>[id,STUDIO_INFO[id].name])) as Record<typeof STUDIO_GAMES[number],string>,
  ...VARIANT_NAMES,
  'github-diamonds':'Diamonds','github-crash':'Crash','github-three-card':'Трёхкарточный покер','github-caribbean':'Карибский покер',
  'github-let-it-ride':'Три ставки','github-ultimate':'Казино Холдем','github-war':'Карточная война','github-red-dog':'Red Dog',
  'github-pai-gow':'Пай Гоу','github-dragon-tiger':'Дракон и тигр','github-deuces':'Deuces Wild','github-sic-bo':'Sic Bo',
  'github-mississippi':"Mississippi Stud",
  'github-four-card':"Four Card Poker",
  'github-crazy-four':"Crazy 4 Poker",
  'github-flush':"High Card Flush",
  'github-holdem-bonus':"Texas Hold’em Bonus",
  'github-oasis':"Oasis Poker",
  'github-russian':"Русский покер",
  'github-caribbean-draw':"Caribbean Draw",
  'github-spanish':"Spanish 21",
  'github-exposure':"Double Exposure",
  'github-switch':"Blackjack Switch",
  'github-free-bet':"Free Bet Blackjack",
  'github-rummy':"Three Card Rummy",
  'github-andar-bahar':"Andar Bahar",
};
// Casino variants share the same server-owned wallet sessions.
export const EXPANSION_RULES: Record<ExpansionGameId,string> = {
  ...STUDIO_RULES,
  ...VARIANT_RULES,
  'github-diamonds':'Пять самоцветов. Три, четыре или пять одинаковых дают выплату до 30×. Исходная таблица Rush: возврат 77,62%.',
  'github-crash':'Множитель растёт после отсчёта. Забери выплату до остановки. Достижение 100× выплачивается автоматически. Время определяет сервер; закрытие окна сохраняет полёт.',
  'github-three-card':'Ante и необязательная Pair Plus. Играть стоит ещё одну Ante; пас теряет Ante, но выигрыш Pair Plus выплачивается. Дилеру нужна дама или выше.',
  'github-caribbean':'Пять карт игроку, одна карта дилера открыта. Играть стоит две Ante. Дилеру нужна пара или туз с королём. Дополнительный Jackpot выключен.',
  'github-let-it-ride':'Три равные ставки. На каждом из двух ходов верни одну ставку или оставь её. Выплата по итоговым пяти картам: пара десяток или выше, до 1001× за каждую оставшуюся ставку.',
  'github-ultimate':'Начало стоит Ante + Blind. До флопа можно поставить Play 3×/4× Ante, на флопе 2×, на ривере 1× или пас. Необязательная Trips оценивается отдельно.',
  'github-war':'Сравниваются карты, туз старший. При ничьей забери половину Ante или поставь ещё одну Ante на войну. Победа и повторная ничья на войне возвращают 3× Ante.',
  'github-red-dog':'После двух карт выбери повышение на одну Ante или продолжение. Третья карта должна попасть строго между ними. Разрыв 1/2/3/4+ даёт прибыль 5/4/2/1 ставок. Особые пары и соседние ранги рассчитываются сразу.',
  'github-pai-gow':'Из семи карт отложи две в младшую руку, пять остаются в старшей. Старшая должна быть сильнее. Победа обеих рук даёт выплату 1,95× с комиссией 5%; разделённый результат возвращает ставку.',
  'github-dragon-tiger':'Одна колода, туз младший. Ставка на старшую карту получает 2×, ничья возвращает половину ставки. Отдельная ставка на ничью выключена.',
  'github-deuces':'Все двойки заменяют любую карту. Выбери удерживаемые карты и замени остальные. Исходная Full Pay: около 100,76% при оптимальной стратегии; доступна только на демомонеты.',
  'github-sic-bo':'Три кости. Малое: сумма 4-10, большое: 11-17. Любой триплет проигрывает обе ставки. Выплата 2×, точный возврат 97,22%.',
  'github-mississippi':"Две карты игрока и три общие карты. На каждом из трёх этапов добавь 1-3 Ante или сбрось. Пара 6-10 возвращает ставки, валеты и выше дают выигрыш; роял-флеш платит 501× от всех оставленных ставок.",
  'github-four-card':"Из пяти карт выбирается лучшая комбинация четырёх; дилер выбирает из шести. Одна карта дилера открыта. Play стоит 1-3 Ante. Бонус Ante за каре, стрит-флеш и тройку рассчитывается автоматически. Aces Up выключен.",
  'github-crazy-four':"Начало: Ante + Super Bonus. Play стоит одну Ante; с парой тузов или выше доступно 2-3 Ante. Дилеру нужен король или выше. Выплата обязательной Super Bonus зависит от комбинации. Queens Up выключен.",
  'github-flush':"Семь карт. Сравнивается самая длинная группа одной масти, затем старшинство карт. Raise 1× Ante, с пятью картами одной масти 2×, с шестью или семью 3×. Дополнительные ставки выключены.",
  'github-holdem-bonus':"Две карты игроку и пять общих. Play до флопа стоит 2 Ante; после флопа и тёрна можно добавить одну Ante или сделать чек. Бонусная ставка на первые карты выключена. Таблица Ante сохранена из исходного проекта.",
  'github-oasis':"Пять карт, одна карта дилера открыта. Выбери до пяти карт для обмена: каждая стоит одну Ante, либо оставь руку. Затем Play за 2 Ante или пас. Jackpot выключен.",
  'github-russian':"Пять карт. Обмен стоит одну Ante за каждую карту; можно вместо обмена купить шестую за одну Ante и отбросить одну. Play стоит 2 Ante. Если дилер не квалифицировался, можно оплатить обмен его старшей карты за одну Ante. Исходная версия оценивает одну лучшую комбинацию.",
  'github-caribbean-draw':"Карибский покер с обменом: до двух карт за одну общую Ante, либо без обмена. Затем Play стоит 2 Ante или пас. Jackpot выключен.",
  'github-spanish':"Колода без десяток, картинки стоят 10. Игрок с 21 выигрывает, обычный блэкджек платит 3:2. Есть бонусы за 21 из нескольких карт, удвоение, разделение пар и страховка. Дополнительные ставки выключены.",
  'github-exposure':"Обе карты дилера открыты. При обычной ничьей выигрывает дилер; блэкджек платит 1:1. Доступны добор, остановка, разрешённые удвоения и разделения. Страховка и дополнительные ставки выключены.",
  'github-switch':"Две равные начальные ставки. Можно обменять вторые карты между руками; затем сыграть каждую руку отдельно. Блэкджек платит 1:1, 22 у дилера возвращает обычные ставки. Удвоение оплачивается отдельно.",
  'github-free-bet':"Одна начальная ставка. Бесплатное удвоение на жёстких 9, 10 или 11; бесплатное разделение пар, кроме карт стоимостью 10. Блэкджек платит 3:2, 22 у дилера возвращает ставки. Бесплатные действия не списывают демомонеты.",
  'github-rummy':"Три карты. Парные карты и комбинации одной масти снижают счёт; меньше лучше. Дилеру нужен счёт не выше 20. Play стоит одну Ante. Дополнительный Low Bonus выключен.",
  'github-andar-bahar':"После сохранения ставки открывается карта-ориентир. Выбери Andar или Bahar; карты раскладываются до совпадения ранга. Первая колонка получает 1,9× ставки, вторая 2×. Повторного списания при выборе стороны нет. Дополнительные ставки выключены.",
};
export const isExpansionGame = (value:unknown): value is ExpansionGameId => (EXPANSION_GAMES as readonly unknown[]).includes(value);
export type ExpansionAction =
  | {id:string;gameId:ExpansionGameId;action:'start';stakeUnits:string;settings:({side?:boolean;bet?:'dragon'|'tiger'|'small'|'big'} | VariantSettings | StudioSettings)}
  | {id:string;gameId:ExpansionGameId;action:'move';sessionId:string;move:string;picks?:number[]};
export type ExpansionView = {studio?:StudioView;variant?:VariantView;player:string[];dealer:string[];community:string[];actions:{move:string;label:string;cost:number;perPick?:number;minPicks?:number;maxPicks?:number}[];hands?:{cards:string[];score:number;label:string;active:boolean}[];phase:number;ended:boolean;message:string;hint?:number[]};
export type ExpansionSession = {id:string;gameId:ExpansionGameId;rulesVersion:1;state:'active'|'settled';stakeUnits:string;spentUnits:string;returnedUnits:string;view:ExpansionView;startedAt?:number;serverNow?:number;multiplier?:number;crashAt?:number;dice?:number[];gems?:string[]};
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
export function validExpansionAction(value:unknown):value is ExpansionAction {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const r=value as ExpansionAction;if(!uuid(r.id)||!isExpansionGame(r.gameId))return false;
  if(r.action==='start'){
    if(Object.keys(r).sort().join(',')!=='action,gameId,id,settings,stakeUnits'||typeof r.stakeUnits!=='string'||!/^[1-9][0-9]{0,10}$/.test(r.stakeUnits)||!r.settings||typeof r.settings!=='object'||Array.isArray(r.settings))return false;
    if(isStudioGame(r.gameId))return validStudioSettings(r.gameId,r.settings);
    if(isVariantGame(r.gameId))return validVariantSettings(r.gameId,r.settings);
    const keys=Object.keys(r.settings).join(',');
    const options=r.settings as {side?:boolean;bet?:string};
    if(['github-three-card','github-ultimate'].includes(r.gameId))return keys===''||keys==='side'&&typeof options.side==='boolean';
    if(r.gameId==='github-dragon-tiger')return keys==='bet'&&['dragon','tiger'].includes(options.bet??'');
    if(r.gameId==='github-sic-bo')return keys==='bet'&&['small','big'].includes(options.bet??'');
    return keys==='';
  }
  if(r.action!=='move'||!uuid(r.sessionId)||typeof r.move!=='string'||!['studio-spin','studio-advance','roll','red','black','unlock','reveal','play','fold','pull','ride','play1','play2','play3','play4','check','war','surrender','raise','stay','set','auto','hold','cashout','exchange','draw','discard','buy-sixth','force','decline','hit','stand','double','split','insurance','no-insurance','switch','keep','free-double','free-split','andar','bahar'].includes(r.move))return false;
  if(isStudioGame(r.gameId)){
    const kind=STUDIO_INFO[r.gameId].kind;
    if(kind==='slot'){if(r.move!=='studio-spin'||r.picks!==undefined)return false;}
    else if(kind==='crash'||kind==='flight'){if(!['studio-advance','cashout'].includes(r.move)||r.picks!==undefined)return false;}
    else if(kind==='mines'){if(!['reveal','cashout'].includes(r.move)||r.move==='reveal'&&(!Array.isArray(r.picks)||r.picks.length!==1||!Number.isInteger(r.picks[0])||r.picks[0]<0||r.picks[0]>15)||r.move==='cashout'&&r.picks!==undefined)return false;}
    else return false;
    return Object.keys(r).sort().join(',')===(r.picks===undefined?'action,gameId,id,move,sessionId':'action,gameId,id,move,picks,sessionId');
  }
  if(isVariantGame(r.gameId)){
    if(r.gameId==='variant-mines'){
      if(!['reveal','cashout'].includes(r.move))return false;
      if(r.move==='reveal'&&(!Array.isArray(r.picks)||r.picks.length!==1||!Number.isInteger(r.picks[0])||r.picks[0]<0||r.picks[0]>15))return false;
      if(r.move==='cashout'&&r.picks!==undefined)return false;
    }else if(r.gameId==='variant-color'){
      if(!['red','black','cashout'].includes(r.move)||r.picks!==undefined)return false;
    }else if(r.gameId==='variant-keys'){
      if(!['unlock','cashout'].includes(r.move))return false;
      if(r.move==='unlock'&&(!Array.isArray(r.picks)||r.picks.length!==2||new Set(r.picks).size!==2||r.picks.some(n=>!Number.isInteger(n)||n<0||n>3)))return false;
      if(r.move==='cashout'&&r.picks!==undefined)return false;
    }else if(r.gameId==='variant-double-mines'){
      if(!['reveal','cashout'].includes(r.move))return false;
      if(r.move==='reveal'&&(!Array.isArray(r.picks)||r.picks.length!==2||new Set(r.picks).size!==2||r.picks.some(n=>!Number.isInteger(n)||n<0||n>15)))return false;
      if(r.move==='cashout'&&r.picks!==undefined)return false;
    }else if(r.gameId==='variant-dice-streak'){
      if(!['roll','cashout'].includes(r.move))return false;
      if(r.move==='roll'&&(!Array.isArray(r.picks)||r.picks.length!==1||![2,3,4].includes(r.picks[0])))return false;
      if(r.move==='cashout'&&r.picks!==undefined)return false;
    }else return false;
    return Object.keys(r).sort().join(',')===(r.picks===undefined?'action,gameId,id,move,sessionId':'action,gameId,id,move,picks,sessionId');
  }
  if(['studio-spin','studio-advance','roll','reveal','red','black','unlock'].includes(r.move))return false;
  if(r.picks!==undefined&&(!Array.isArray(r.picks)||r.picks.length>5||new Set(r.picks).size!==r.picks.length||r.picks.some(n=>!Number.isInteger(n)||n<0||n>6)))return false;
  return Object.keys(r).sort().join(',')===(r.picks===undefined?'action,gameId,id,move,sessionId':'action,gameId,id,move,picks,sessionId')&&(['set','hold','exchange','draw','discard'].includes(r.move)||r.picks===undefined);
}
