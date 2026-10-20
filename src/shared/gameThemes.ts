import { t as translateText } from '../i18n/index';
import { DEMO_SYMBOLS } from './demoWallet';

// Themes only map stable symbol IDs to artwork. Game rules live in gameCore.
export const COINS_THEMES = [
  { id: 'classic', name: translateText('Классика'), symbols: DEMO_SYMBOLS, subtitle: translateText('Твой кошелёк. Твоя удача.') },
  { id: 'cosmic', name: translateText('Космос'), symbols: ['🪐', '💎', '🚀', '🌙', '⭐'], subtitle: translateText('Три барабана. Целая галактика.') },
] as const;

export type CoinsThemeId = (typeof COINS_THEMES)[number]['id'];
