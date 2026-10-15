// TypeScript adaptation of BeFiveINFO/Lucky-Five-Video-Poker (MIT).
// Retains the 53-card joker deck and hand_primary_rates. PHP session handling
// is replaced by a browser practice session; full-house detection is corrected.
export const VIDEO_PAYOUTS = [0, 0, 1, 2, 4, 5, 8, 20, 40, 100, 250] as const;
export const VIDEO_NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Тройка', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш', 'Пять одинаковых'] as const;
export function rankFive(cards: readonly string[]): { rank: number; values: number[] } {
  if (cards.length !== 5 || cards.includes('JJ')) throw new RangeError('Five ordinary cards required');
  const values = cards.map(card => '23456789TJQKA'.indexOf(card[0]) + 2).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(card => card[1] === cards[0][1]);
  const straight = counts.size === 5 && (values[0] - values[4] === 4 || values.join(',') === '14,5,4,3,2');
  const high = straight && values[0] === 14 && values[1] === 5 ? 5 : values[0];
  let rank = 0;
  if (flush && straight) rank = high === 14 ? 9 : 8;
  else if (groups[0][1] === 4) rank = 7;
  else if (groups[0][1] === 3 && groups[1][1] === 2) rank = 6;
  else if (flush) rank = 5;
  else if (straight) rank = 4;
  else if (groups[0][1] === 3) rank = 3;
  else if (groups[0][1] === 2 && groups[1][1] === 2) rank = 2;
  else if (groups[0][1] === 2) rank = 1;
  return { rank, values: straight ? [high] : groups.map(group => group[0]) };
}
export function videoRank(cards: readonly string[]): number {
  if (!cards.includes('JJ')) return rankFive(cards).rank;
  const ordinary = cards.filter(card => card !== 'JJ');
  if (ordinary.every(card => card[0] === ordinary[0][0])) return 10;
  let best = 0;
  for (const rank of 'A23456789TJQK') for (const suit of 'CDHS') {
    const substitute = rank + suit;
    if (!ordinary.includes(substitute)) best = Math.max(best, rankFive([...ordinary, substitute]).rank);
  }
  return best;
}
