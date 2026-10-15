export type CasinoApiProGame = { id: string; slug: string; name: string; category: string; thumbnailUrl?: string; minBet: string; maxBet: string };
export type CasinoApiProStatus = { configured: boolean; walletConnected: boolean; currency: string; playerId: string; balance: string };
