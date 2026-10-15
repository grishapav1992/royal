import { DEMO_SYMBOLS } from './demoWallet';

// Themes only map stable symbol IDs to artwork. Game rules live in gameCore.
export const COINS_THEMES = [
  { id: 'classic', name: 'Классика', symbols: DEMO_SYMBOLS, subtitle: 'Твой кошелёк. Твоя удача.' },
  { id: 'cosmic', name: 'Космос', symbols: ['🪐', '💎', '🚀', '🌙', '⭐'], subtitle: 'Три барабана. Целая галактика.' },
] as const;

export type CoinsThemeId = (typeof COINS_THEMES)[number]['id'];
