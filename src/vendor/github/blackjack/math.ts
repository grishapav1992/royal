// Adapted from Kusnierewicz/Blackjack-game-in-JS, 21game.js (MIT).
// Card values and ace adjustment retained; DOM updates and global variables removed.
export function blackjackScore(cards: readonly string[]): number {
  let handSum = 0;
  let numofaces = 0;
  for (const card of cards) {
    const rank = card[0];
    handSum += rank === 'A' ? 11 : 'TJQK'.includes(rank) ? 10 : Number(rank);
    if (rank === 'A') numofaces++;
  }
  for (let i = 0; i < numofaces && handSum > 21; i++) handSum -= 10;
  return handSum;
}
