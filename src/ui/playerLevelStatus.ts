import { language } from '../i18n/index';

const titles = [
  ['Зашёл погреться', 'Came In to Warm Up', '☕'],
  ['Охотник за жетонами', 'Token Hunter', '◉'],
  ['Гроза автомата у входа', 'Menace of the Front Slot', '♠'],
  ['Меняла из столовой', 'Cafeteria Money Changer', '♦'],
  ['Крупье на продлёнке', 'After-School Croupier', '♣'],
  ['Карточный хулиган', 'Card Hooligan', '♥'],
  ['Причина родсобрания', 'Reason for the Parent Meeting', '✎'],
  ['Завхоз джекпота', 'Jackpot Custodian', '⚿'],
  ['Почётный нарушитель тишины', 'Honorary Noise Violation', '♪'],
  ['Инспектор неона', 'Neon Inspector', '✦'],
  ['Депутат по фриспинам', 'Free-Spin Councilor', '⟳'],
  ['Мэр по версии рулетки', 'Mayor According to Roulette', '◎'],
  ['Губернатор фишек', 'Governor of Chips', '⬢'],
  ['Инопланетный аудитор', 'Alien Auditor', '☄'],
  ['Фигурант дела о джекпоте', 'Jackpot Case Suspect', '⚑'],
  ['ЧП в VIP-зале', 'VIP Room Emergency', '⚠'],
  ['Кошмар пит-босса', "Pit Boss's Nightmare", '⚡'],
  ['Хозяин казино до отбоя', 'Casino Owner Until Bedtime', '☾'],
  ['Легенда под неоном', 'Neon Legend', '✶'],
  ['Лицо на всех фишках', 'Face on Every Chip', '◈'],
  ['Президент конторы', 'President of the House', '♛'],
] as const;

export function playerLevelStatus(level?: number) {
  if (!level || !Number.isInteger(level) || level < 1 || level > 100) return;
  const [ru, en, symbol] = titles[Math.floor(level / 5)];
  return { title: language === 'en' ? en : ru, symbol, legendary: level >= 90 };
}
