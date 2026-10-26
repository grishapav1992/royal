export const CARD_GAME_IDS = [
  'github-blackjack', 'github-spanish', 'github-exposure', 'github-switch', 'github-free-bet', 'variant-blackjack-target',
  'github-three-card', 'github-caribbean', 'github-let-it-ride', 'github-ultimate', 'github-pai-gow', 'github-deuces',
  'github-mississippi', 'github-four-card', 'github-crazy-four', 'github-flush', 'github-holdem-bonus', 'github-oasis',
  'github-russian', 'github-caribbean-draw', 'github-poker', 'github-video-poker', 'variant-triple-poker',
  'github-baccarat', 'github-war', 'github-red-dog', 'github-dragon-tiger', 'github-rummy', 'github-andar-bahar',
  'github-hilo', 'variant-color', 'variant-duel', 'variant-war',
] as const;
export const CARD_GAMES = CARD_GAME_IDS;
export type CardGameId = typeof CARD_GAME_IDS[number];
export type DealerAction = 'idle' | 'deal' | 'win' | 'lose';
export const isCardGame = (id: unknown): id is CardGameId => (CARD_GAME_IDS as readonly unknown[]).includes(id);
export const CARD_GAME_NAMES: Record<CardGameId, string> = {
  'github-blackjack':'Блэкджек', 'github-spanish':'Spanish 21', 'github-exposure':'Double Exposure',
  'github-switch':'Blackjack Switch', 'github-free-bet':'Free Bet Blackjack', 'variant-blackjack-target':'21: тройной расклад',
  'github-three-card':'Трёхкарточный покер', 'github-caribbean':'Карибский покер', 'github-let-it-ride':'Три ставки',
  'github-ultimate':'Казино Холдем', 'github-pai-gow':'Пай Гоу', 'github-deuces':'Deuces Wild',
  'github-mississippi':'Mississippi Stud', 'github-four-card':'Four Card Poker', 'github-crazy-four':'Crazy 4 Poker',
  'github-flush':'High Card Flush', 'github-holdem-bonus':'Texas Hold’em Bonus', 'github-oasis':'Oasis Poker',
  'github-russian':'Русский покер', 'github-caribbean-draw':'Caribbean Draw', 'github-poker':'Покер',
  'github-video-poker':'Видеопокер', 'variant-triple-poker':'Три карты: комбинация', 'github-baccarat':'Баккара',
  'github-war':'Карточная война', 'github-red-dog':'Red Dog', 'github-dragon-tiger':'Дракон и тигр',
  'github-rummy':'Three Card Rummy', 'github-andar-bahar':'Andar Bahar', 'github-hilo':'Hi-Lo',
  'variant-color':'Красное / чёрное', 'variant-duel':'Дракон: точный разрыв', 'variant-war':'Война: два фронта',
};
export type DealerProfile = {
  id: string; name: string; index: number; skin: string; hair: string;
  hairStyle: 'swept' | 'bob' | 'curls' | 'bun' | 'silver' | 'braids';
  uniform: string; accent: string; glasses: boolean; beard: boolean; earrings: boolean; body: number; tableColor: string;
};
const names = ['Адель','Томас','Рената','Эмиль','Зоя','Лука','Селина','Рафаэль','Инес','Оскар','Мэй','Габриэль','Лилия','Мартин','Кира','Ноа','Амира','Феликс','Валентина','Даниэль','Элис','Виктор','Роза','Алекс','Наоми','Стефан','Акира','Беатрис','Рави','Соня','Николь','Тео','Эстель'];
const skin = ['#f2cba5','#dba680','#b97d57','#8d573f','#e5bb94','#c8916a','#a56e51'];
const hair = ['#322931','#c8a065','#744237','#eee5d2','#493b32','#bc5e47','#4d344e','#8b7464','#d9ad78','#292e37','#a77a48'];
const uniforms = ['#274b57','#704351','#496451','#5a436e','#6f533a','#3d6671','#73515a','#405149','#676071','#466277','#89503f','#526b66','#643849','#4b536f','#805e4a','#35615d','#6d546e','#70603e','#385875','#715445','#557051','#624967','#4f6565','#723b50','#675539','#405c65','#4d3f6c','#7b5956','#3e6050','#806648','#624052','#506779','#6d6353'];
const accents = ['#ead19c','#a9d6c5','#dfafc8','#b9b6e4','#edbc84','#a4d5df','#d6c68b','#b5d1b1'];
const styles: DealerProfile['hairStyle'][] = ['bob','swept','curls','bun','silver','braids'];
export const DEALER_PROFILES: Record<CardGameId, DealerProfile> = Object.fromEntries(CARD_GAME_IDS.map((id,index) => [id, {
  id:'dealer-'+id, name:names[index]!, index, skin:skin[index%skin.length]!, hair:hair[index%hair.length]!,
  hairStyle:styles[index%styles.length]!, uniform:uniforms[index]!, accent:accents[index%accents.length]!,
  glasses:index%5===1 || index===27, beard:[1,7,13,17,21,25,28,31].includes(index), earrings:index%3!==1,
  body:index%4, tableColor:['#305b50','#3c525f','#584455','#485a40'][index%4]!,
}])) as Record<CardGameId, DealerProfile>;
export function dealerForGame(id: string): DealerProfile | undefined { return isCardGame(id) ? DEALER_PROFILES[id] : undefined; }
export const cardTableBounds = ({x,y}: {x:number;y:number}) => ({x:x-116,y:y-112,w:232,h:122});
export const cardTableApproach = ({x,y}: {x:number;y:number}) => ({x,y:y+43});
