export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type CardSuit = 'spade' | 'heart' | 'diamond' | 'club';
export type Card = { rank: CardRank; suit: CardSuit };
export type GameResult = 'player_win' | 'banker_win' | 'tie';
