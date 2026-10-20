import { t as translateText } from '../i18n/index';
export type ChatSticker = { id: string; pack: 'duck' | 'cat' | 'capybara'; name: string; text: string; col: number; row: number };
export const CHAT_STICKERS: readonly ChatSticker[] = [
  { id: 'duck-hi', pack: 'duck', name: translateText('Уточка: привет!'), text: translateText('🦆 Уточка машет: привет!'), col: 0, row: 0 },
  { id: 'duck-laugh', pack: 'duck', name: translateText('Уточка смеётся'), text: translateText('🦆 Уточка смеётся до слёз!'), col: 1, row: 0 },
  { id: 'duck-love', pack: 'duck', name: translateText('Уточка с сердечком'), text: translateText('🦆 Уточка обнимает сердечко ❤️'), col: 2, row: 0 },
  { id: 'duck-party', pack: 'duck', name: translateText('Уточка празднует'), text: translateText('🦆 Уточка празднует в короне! 🎉'), col: 3, row: 0 },
  { id: 'cat-hi', pack: 'cat', name: translateText('Котик: привет!'), text: translateText('🐱 Котик машет лапкой: привет!'), col: 0, row: 1 },
  { id: 'cat-laugh', pack: 'cat', name: translateText('Котик смеётся'), text: translateText('🐱 Котик смеётся до слёз!'), col: 1, row: 1 },
  { id: 'cat-love', pack: 'cat', name: translateText('Котик с сердечком'), text: translateText('🐱 Котик обнимает сердечко ❤️'), col: 2, row: 1 },
  { id: 'cat-wow', pack: 'cat', name: translateText('Котик удивлён'), text: translateText('🐱 Котик в восторге: вот это да!'), col: 3, row: 1 },
  { id: 'capybara-hi', pack: 'capybara', name: translateText('Капибара: привет!'), text: translateText('🤎 Капибара машет: привет!'), col: 0, row: 2 },
  { id: 'capybara-chill', pack: 'capybara', name: translateText('Капибара отдыхает'), text: translateText('🤎 Капибара отдыхает с мандаринкой 🍊'), col: 1, row: 2 },
  { id: 'capybara-love', pack: 'capybara', name: translateText('Капибара с сердечком'), text: translateText('🤎 Капибара обнимает сердечко ❤️'), col: 2, row: 2 },
  { id: 'capybara-party', pack: 'capybara', name: translateText('Капибара празднует'), text: translateText('🤎 Капибара празднует! 🎉'), col: 3, row: 2 },
];
export const CHAT_EMOJI = [
  { emoji: '😂', code: '1f602', name: translateText('Смех до слёз') },
  { emoji: '🤣', code: '1f923', name: translateText('Очень смешно') },
  { emoji: '😍', code: '1f60d', name: translateText('Влюблённый взгляд') },
  { emoji: '🥰', code: '1f970', name: translateText('Нежность') },
  { emoji: '😎', code: '1f60e', name: translateText('Круто') },
  { emoji: '😭', code: '1f62d', name: translateText('Слёзы') },
  { emoji: '🥳', code: '1f973', name: translateText('Праздник') },
  { emoji: '🤯', code: '1f92f', name: translateText('Взрыв мозга') },
  { emoji: '🤔', code: '1f914', name: translateText('Задумался') },
  { emoji: '😡', code: '1f621', name: translateText('Злость') },
  { emoji: '👍', code: '1f44d', name: translateText('Класс') },
  { emoji: '❤️', code: '2764_fe0f', name: translateText('Сердце') },
  { emoji: '🔥', code: '1f525', name: translateText('Огонь') },
  { emoji: '🎉', code: '1f389', name: translateText('Конфетти') },
  { emoji: '💀', code: '1f480', name: translateText('Череп') },
  { emoji: '🤡', code: '1f921', name: translateText('Клоун') },
] as const;
export type ChatEmoji = typeof CHAT_EMOJI[number];
// Exact readable text keeps existing moderation, history and older clients compatible.
export const chatStickerFromText = (text: string) => CHAT_STICKERS.find(sticker => sticker.text === text);
export const chatStickerFromId = (id: string) => CHAT_STICKERS.find(sticker => sticker.id === id);
export const chatEmojiFromText = (text: string) => CHAT_EMOJI.find(item => item.emoji === text);
export const CHAT_MEDIA_BASE = '/chat-media/v1/';
