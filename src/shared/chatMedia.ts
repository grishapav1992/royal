export type ChatSticker = { id: string; pack: 'duck' | 'cat' | 'capybara'; name: string; text: string; col: number; row: number };
export const CHAT_STICKERS: readonly ChatSticker[] = [
  { id: 'duck-hi', pack: 'duck', name: 'Уточка: привет!', text: '🦆 Уточка машет: привет!', col: 0, row: 0 },
  { id: 'duck-laugh', pack: 'duck', name: 'Уточка смеётся', text: '🦆 Уточка смеётся до слёз!', col: 1, row: 0 },
  { id: 'duck-love', pack: 'duck', name: 'Уточка с сердечком', text: '🦆 Уточка обнимает сердечко ❤️', col: 2, row: 0 },
  { id: 'duck-party', pack: 'duck', name: 'Уточка празднует', text: '🦆 Уточка празднует в короне! 🎉', col: 3, row: 0 },
  { id: 'cat-hi', pack: 'cat', name: 'Котик: привет!', text: '🐱 Котик машет лапкой: привет!', col: 0, row: 1 },
  { id: 'cat-laugh', pack: 'cat', name: 'Котик смеётся', text: '🐱 Котик смеётся до слёз!', col: 1, row: 1 },
  { id: 'cat-love', pack: 'cat', name: 'Котик с сердечком', text: '🐱 Котик обнимает сердечко ❤️', col: 2, row: 1 },
  { id: 'cat-wow', pack: 'cat', name: 'Котик удивлён', text: '🐱 Котик в восторге: вот это да!', col: 3, row: 1 },
  { id: 'capybara-hi', pack: 'capybara', name: 'Капибара: привет!', text: '🤎 Капибара машет: привет!', col: 0, row: 2 },
  { id: 'capybara-chill', pack: 'capybara', name: 'Капибара отдыхает', text: '🤎 Капибара отдыхает с мандаринкой 🍊', col: 1, row: 2 },
  { id: 'capybara-love', pack: 'capybara', name: 'Капибара с сердечком', text: '🤎 Капибара обнимает сердечко ❤️', col: 2, row: 2 },
  { id: 'capybara-party', pack: 'capybara', name: 'Капибара празднует', text: '🤎 Капибара празднует! 🎉', col: 3, row: 2 },
];
export const CHAT_EMOJI = [
  { emoji: '😂', code: '1f602', name: 'Смех до слёз' },
  { emoji: '🤣', code: '1f923', name: 'Очень смешно' },
  { emoji: '😍', code: '1f60d', name: 'Влюблённый взгляд' },
  { emoji: '🥰', code: '1f970', name: 'Нежность' },
  { emoji: '😎', code: '1f60e', name: 'Круто' },
  { emoji: '😭', code: '1f62d', name: 'Слёзы' },
  { emoji: '🥳', code: '1f973', name: 'Праздник' },
  { emoji: '🤯', code: '1f92f', name: 'Взрыв мозга' },
  { emoji: '🤔', code: '1f914', name: 'Задумался' },
  { emoji: '😡', code: '1f621', name: 'Злость' },
  { emoji: '👍', code: '1f44d', name: 'Класс' },
  { emoji: '❤️', code: '2764_fe0f', name: 'Сердце' },
  { emoji: '🔥', code: '1f525', name: 'Огонь' },
  { emoji: '🎉', code: '1f389', name: 'Конфетти' },
  { emoji: '💀', code: '1f480', name: 'Череп' },
  { emoji: '🤡', code: '1f921', name: 'Клоун' },
] as const;
export type ChatEmoji = typeof CHAT_EMOJI[number];
// Exact readable text keeps existing moderation, history and older clients compatible.
export const chatStickerFromText = (text: string) => CHAT_STICKERS.find(sticker => sticker.text === text);
export const chatStickerFromId = (id: string) => CHAT_STICKERS.find(sticker => sticker.id === id);
export const chatEmojiFromText = (text: string) => CHAT_EMOJI.find(item => item.emoji === text);
export const CHAT_MEDIA_BASE = '/chat-media/v1/';
