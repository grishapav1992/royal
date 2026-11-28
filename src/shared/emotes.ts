import { t as translateText } from '../i18n/index';

/**
 * Emotes everyone in the same hall sees: a short gesture with an icon above the character.
 * Social decoration only, available in every location; no stake, wallet or reward.
 */
export const EMOTES = [
  { id: 'wave', icon: '👋', key: '1', label: translateText('Помахать') },
  { id: 'clap', icon: '👏', key: '2', label: translateText('Аплодировать') },
  { id: 'dance', icon: '💃', key: '3', label: translateText('Танцевать') },
  { id: 'cheers', icon: '🥂', key: '4', label: translateText('Чокнуться') },
  { id: 'laugh', icon: '😂', key: '5', label: translateText('Смеяться') },
] as const;
export type EmoteId = typeof EMOTES[number]['id'];
export const EMOTE_MS = 2600;
export const DANCE_MS = 6000;
export const EMOTE_COOLDOWN_MS = 1200;
export const emoteDuration = (id: string) => id === 'dance' ? DANCE_MS : EMOTE_MS;
export const isEmote = (id: unknown): id is EmoteId => EMOTES.some(e => e.id === id);
export const emoteIcon = (id: string) => EMOTES.find(e => e.id === id)?.icon ?? '';
