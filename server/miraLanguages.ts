import type { Language } from '../src/i18n';
export type MiraLanguage = Language;

export const miraText = {
  ru: {
    first: 'Ну? Чем удивишь?', back: 'Вернулся? Надеюсь, с новой темой.',
    absent: (days: number) => `${days} дней без тебя. Стаканы справлялись лучше.`,
    nextDay: (name: string) => `${name || 'Знакомое лицо'}. Опять ты. Посмотрим, что сегодня.`,
    switched: 'Продолжим. Я тебя помню.',
    choices: ['Ты меня ещё помнишь?', 'Скучала без меня?', 'Начнём с лимонада'],
    paused: 'Всё, разговор заел. Я пока займусь стаканами.',
    updating: 'Память разговора обновляется. Подожди немного.', busy: 'Бар сейчас занят. Попробуй позже.',
    answering: 'Мира ещё отвечает. Подожди немного.', input: 'Напиши от 1 до 600 символов.',
    unconfigured: 'Разговор с Мирой пока не настроен. Напитки доступны в меню.',
    cooldown: (seconds: number) => `Мира занялась стаканами. Вернись через ${seconds} сек.`,
    wait: 'Дай Мире пару секунд перед следующей репликой.', limit: 'Сделаем паузу: лимит 60 реплик в час.',
    failed: 'Мира отвлеклась. Попробуй повторить реплику чуть позже.',
    origin: 'Этот источник запросов не разрешён.', login: 'Войди в онлайн-зал, чтобы поговорить с Мирой.',
    remember: 'Не получилось вспомнить разговор. Попробуй позже.', talk: 'Не получилось поговорить с Мирой.', reset: 'Дождись ответа Миры.',
    instruction: 'Язык интерфейса гостя: русский. Пиши reply и каждый элемент choices только по-русски, даже если гость или история говорят на другом языке. Используй всю память независимо от её языка. Сохраняй характер и остальные правила. Не переводи технические ключи JSON, значения enum и идентификаторы напитков.',
    replyDescription: 'Прямая речь Миры по-русски, обычно одна фраза до 20 слов, без имени и ремарок.',
    choicesDescription: 'Возможные следующие реплики ПОСЕТИТЕЛЯ на русском, обращённые к Мире. Не ответы Миры. Если нет подходящих, верни пустой массив.',
  },
  en: {
    first: 'Well? Surprise me.', back: 'Back again? I hope you brought a new topic.',
    absent: (days: number) => `${days} days without you. The glasses coped better.`,
    nextDay: (name: string) => `${name || 'A familiar face'}. You again. Let us see what today brings.`,
    switched: 'Go on. I remember you.',
    choices: ['Do you still remember me?', 'Did you miss me?', 'Let us start with lemonade'],
    paused: 'This conversation is stuck on repeat. I will tend to the glasses.',
    updating: 'Conversation memory is updating. Wait a moment.', busy: 'The bar is busy. Try again later.',
    answering: 'Mira is still replying. Wait a moment.', input: 'Write 1 to 600 characters.',
    unconfigured: "Mira's conversation is not configured yet. Drinks are available in the menu.",
    cooldown: (seconds: number) => `Mira is busy with the glasses. Come back in ${seconds} sec.`,
    wait: 'Give Mira a couple of seconds before the next message.', limit: 'Take a break: limit of 60 messages per hour.',
    failed: 'Mira got distracted. Try your message again shortly.',
    origin: 'This request origin is not allowed.', login: 'Enter the online hall to talk to Mira.',
    remember: 'Could not recall the conversation. Try again later.', talk: 'Could not talk to Mira.', reset: "Wait for Mira's reply.",
    instruction: 'The guest selected English. Write reply and every choices item only in English, even when the guest or earlier conversation turns use Russian or another language. Use all guest memories regardless of their language. Preserve the same personality and all existing rules. Keep JSON keys, enum values and drink identifiers unchanged. Translate drink names naturally when speaking.',
    replyDescription: "Mira's direct speech in English, usually one sentence up to 20 words, without her name or stage directions.",
    choicesDescription: 'Possible next lines spoken by the GUEST to Mira, in English. Never answers spoken by Mira. Return an empty array if none fit.',
  },
} satisfies Record<Language, unknown>;

export function miraLanguage(header?: string): MiraLanguage {
  const preferences = (header ?? '').split(',').map((entry, order) => {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(';');
    const quality = parameters.find(part => part.trim().startsWith('q='))?.trim().slice(2);
    return { language: tag.split('-')[0], weight: quality === undefined ? 1 : Number(quality), order };
  }).filter(item => Number.isFinite(item.weight) && item.weight > 0 && item.weight <= 1)
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  for (const item of preferences) if (Object.hasOwn(miraText, item.language)) return item.language as MiraLanguage;
  return 'ru';
}
