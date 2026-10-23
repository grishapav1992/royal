import { randomInt } from 'node:crypto';
import { cardRank, cardSuit, type CardSuit, type PvpCardGameId, type PvpCardMove, type PvpCardView } from '../../src/shared/pvp';

export type CardState = {
  gameId: PvpCardGameId; revision: number; phase: 'playing' | 'finished';
  hands: [number[], number[]]; stock: number[]; discard: number[];
  trump: number | null; suit: CardSuit; table: { attack: number; defense?: number }[];
  actor: number; attacker: number; limit: number; collecting: boolean; drawn: boolean;
  passes: number; winner: number | null; message: string;
};
const other = (side: number) => 1 - side;
function shuffle(cards: number[], draw: (max: number) => number) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = draw(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw Error('Invalid random draw');
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function createCardGame(gameId: PvpCardGameId, draw: (max: number) => number = randomInt): CardState {
  const eights = gameId === 'crazy-eights';
  const stock = shuffle(Array.from({ length: 52 }, (_, i) => i).filter(card => eights || cardRank(card) >= 6), draw);
  const hands: [number[], number[]] = [[], []];
  for (let i = 0; i < (eights ? 7 : 6); i++) for (const hand of hands) hand.push(stock.pop()!);
  let trump: number | null = eights ? null : stock[0], suit: CardSuit = trump === null ? 0 : cardSuit(trump);
  const discard: number[] = [];
  if (eights) {
    // Start with a non-wild card, so neither player chooses a suit before their turn.
    const initial = stock.findIndex(card => cardRank(card) !== 8);
    discard.push(stock.splice(initial, 1)[0]); suit = cardSuit(discard[0]);
  }
  const lowest = hands.map(hand => Math.min(...hand.filter(card => cardSuit(card) === suit).map(cardRank)));
  const attacker = eights ? draw(2) : lowest[0] < lowest[1] ? 0 : lowest[1] < lowest[0] ? 1 : draw(2);
  if (attacker !== 0 && attacker !== 1) throw Error('Invalid random draw');
  return { gameId, revision: 0, phase: 'playing', hands, stock, discard, trump, suit,
    table: [], actor: attacker, attacker, limit: 6, collecting: false, drawn: false, passes: 0, winner: null, message: 'Партия началась' };
}
const beats = (attack: number, defense: number, trump: CardSuit) => cardSuit(attack) === cardSuit(defense)
  ? cardRank(defense) > cardRank(attack) : cardSuit(defense) === trump;
const matching = (s: CardState, card: number) => !s.table.length || s.table.some(pair => cardRank(pair.attack) === cardRank(card)
  || pair.defense !== undefined && cardRank(pair.defense) === cardRank(card));
function end(s: CardState, winner: number | null) {
  s.phase = 'finished'; s.winner = winner; s.message = winner === null ? 'Ничья' : 'Партия завершена';
}
function finishBout(s: CardState) {
  const attacker = s.attacker, defender = other(attacker);
  const cards = s.table.flatMap(pair => pair.defense === undefined ? [pair.attack] : [pair.attack, pair.defense]);
  if (s.collecting) s.hands[defender].push(...cards); else s.discard.push(...cards);
  for (const side of [attacker, defender]) while (s.hands[side].length < 6 && s.stock.length) s.hands[side].push(s.stock.pop()!);
  const next = s.collecting ? attacker : defender;
  s.table = []; s.collecting = false; s.attacker = next; s.actor = next; s.limit = Math.min(6, s.hands[other(next)].length);
  s.message = 'Новый заход';
  if (!s.stock.length && s.hands.some(hand => !hand.length)) end(s, !s.hands[0].length && !s.hands[1].length ? null : !s.hands[0].length ? 0 : 1);
}
export function cardMoves(s: CardState, side: number): PvpCardMove[] {
  if (s.phase !== 'playing' || side !== s.actor || (side !== 0 && side !== 1)) return [];
  const hand = s.hands[side], moves: PvpCardMove[] = [];
  if (s.gameId === 'crazy-eights') {
    const top = s.discard.at(-1)!;
    for (const card of hand) {
      if (cardRank(card) === 8) for (const suit of [0, 1, 2, 3] as const) moves.push({ kind: 'play', card, suit });
      else if (cardSuit(card) === s.suit || cardRank(top) !== 8 && cardRank(card) === cardRank(top)) moves.push({ kind: 'play', card });
    }
    if (!s.drawn) moves.push({ kind: 'draw' }); else if (!moves.length) moves.push({ kind: 'pass' });
    return moves;
  }
  if (side === s.attacker) {
    if (s.table.length < s.limit) for (const card of hand) if (matching(s, card)) moves.push({ kind: 'attack', card });
    if (s.table.length && (s.collecting || s.table.every(pair => pair.defense !== undefined))) moves.push({ kind: 'done' });
  } else {
    for (const [target, pair] of s.table.entries()) if (pair.defense === undefined) for (const card of hand)
      if (beats(pair.attack, card, s.suit)) moves.push({ kind: 'defend', card, target });
    if (s.gameId === 'transfer-durak' && s.table.length < 6 && s.table.every(pair => pair.defense === undefined)
      && s.table.length + 1 <= s.hands[s.attacker].length) for (const card of hand)
      if (s.table.every(pair => cardRank(pair.attack) === cardRank(card))) moves.push({ kind: 'transfer', card });
    moves.push({ kind: 'take' });
  }
  return moves;
}
function equalMove(a: PvpCardMove, b: unknown) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  const row = b as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(row).length && Object.entries(a).every(([key, value]) => row[key] === value);
}
/** Input contains only a move. Hands, stock, winner and result always stay on the server. */
export function playCardMove(current: CardState, side: number, value: unknown, draw: (max: number) => number = randomInt): CardState {
  const move = cardMoves(current, side).find(candidate => equalMove(candidate, value));
  if (!move) throw Error('Этот ход недоступен.');
  const s = structuredClone(current);
  if ('card' in move) s.hands[side].splice(s.hands[side].indexOf(move.card), 1);
  if (s.gameId === 'crazy-eights') {
    if (move.kind === 'play') {
      s.discard.push(move.card); s.suit = cardRank(move.card) === 8 ? move.suit! : cardSuit(move.card);
      s.actor = other(side); s.drawn = false; s.passes = 0;
      if (!s.hands[side].length) end(s, side);
    } else if (move.kind === 'draw') {
      if (!s.stock.length && s.discard.length > 1) {
        const top = s.discard.pop()!; s.stock = shuffle(s.discard, draw); s.discard = [top];
      }
      if (s.stock.length) { s.hands[side].push(s.stock.pop()!); s.passes = 0; }
      s.drawn = true;
    } else {
      s.actor = other(side); s.drawn = false;
      // Two consecutive passes with no cards to draw ends a blocked game in a draw.
      if (!s.stock.length && s.discard.length === 1 && ++s.passes >= 2) end(s, null);
    }
  } else if (move.kind === 'done') finishBout(s);
  else if (move.kind === 'take') { s.collecting = true; s.actor = s.attacker; s.message = 'Соперник берёт карты'; }
  else if (move.kind === 'attack') { s.table.push({ attack: move.card }); if (!s.collecting) s.actor = other(side); }
  else if (move.kind === 'transfer') {
    s.table.push({ attack: move.card }); s.attacker = side; s.actor = other(side); s.limit = Math.min(6, s.hands[s.actor].length);
  } else if (move.kind === 'defend') {
    s.table[move.target!].defense = move.card;
    if (s.table.every(pair => pair.defense !== undefined)) s.actor = s.attacker;
  }
  if (s.gameId !== 'crazy-eights' && s.table.length && s.actor === s.attacker
    && (s.collecting || s.table.every(pair => pair.defense !== undefined))
    && (s.table.length >= s.limit || !s.hands[s.attacker].some(card => matching(s, card)))) finishBout(s);
  s.revision++;
  return s;
}
export function publicCardGame(s: CardState, side: number): PvpCardView {
  if (side !== 0 && side !== 1) throw Error('Игрок не участвует в партии.');
  return { gameId: s.gameId, revision: s.revision, phase: s.phase, hand: [...s.hands[side]], opponentCount: s.hands[other(side)].length,
    stockCount: s.stock.length, discardCount: s.discard.length, trump: s.stock.length ? s.trump : null, suit: s.suit,
    table: s.gameId === 'crazy-eights' ? [{ attack: s.discard.at(-1)! }] : structuredClone(s.table),
    actor: s.actor, attacker: s.attacker, self: side, collecting: s.collecting, winner: s.winner, message: s.message, moves: cardMoves(s, side) };
}
