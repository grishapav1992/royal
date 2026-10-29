/** Artwork orientation only. Settlement remains owned by the shared rules. */
export function rootArtwork(mask: number) {
  switch (mask) {
    case 10: return { column: 0, angle: 0 };
    case 5: return { column: 0, angle: 90 };
    case 3: return { column: 1, angle: 0 };
    case 6: return { column: 1, angle: 90 };
    case 11: return { column: 2, angle: 0 };
    case 14: return { column: 2, angle: 180 };
    case 15: return { column: 3, angle: 0 };
    default: throw new Error('Unsupported Forest Heart artwork mask: ' + mask);
  }
}

/** Arrival follows mutually connected ports, never array order or decorative shortcuts. */
export function rootWave(board: readonly number[]) {
  const wave = new Map<number, { depth: number; entry: number }>();
  if (!(board[10] & 8)) return wave;
  wave.set(10, { depth: 0, entry: 3 });
  const queue = [10], ports = [1, 2, 4, 8], opposites = [4, 8, 1, 2];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], row = Math.floor(cell / 5), col = cell % 5;
    const next = [row ? cell - 5 : -1, col < 4 ? cell + 1 : -1, row < 4 ? cell + 5 : -1, col ? cell - 1 : -1];
    next.forEach((other, direction) => {
      if (other < 0 || wave.has(other) || !(board[cell] & ports[direction]) || !(board[other] & opposites[direction])) return;
      wave.set(other, { depth: wave.get(cell)!.depth + 1, entry: (direction + 2) % 4 }); queue.push(other);
    });
  }
  return wave;
}

export const easeRoot = (progress: number) => progress * progress * (3 - 2 * progress);
