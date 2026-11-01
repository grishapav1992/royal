/** Only these qualified native slots accept the first shared reward pool. */
export const REWARD_SLOT_GAMES = ['royal-coins', 'royal-fruits'] as const;
export type RewardGame = typeof REWARD_SLOT_GAMES[number];
