import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { CRASH_RTP_PERCENT, rollCrashPoint } from '../server/games/rush/crash';

test('Last Exit keeps the 48-bit crash distribution at high multiplier thresholds', (t) => {
  const outcomes = 2n ** 48n;
  const bytes = Buffer.alloc(6);
  const entropy = t.mock.method(crypto, 'randomBytes', (size: number) => {
    assert.equal(size, bytes.length);
    return bytes;
  });
  syncBuiltinESMExports();

  const roll = (ticket: bigint) => {
    bytes.writeUIntBE(Number(ticket), 0, bytes.length);
    return rollCrashPoint();
  };

  try {
    assert.equal(roll(0n), 1);
    assert.equal(roll(outcomes - 1n), 1);

    for (const hundredths of [101n, 200n, 307n, 359n, 361n, 1000n, 1098n, 1641n, 10000n]) {
      const threshold = Number(hundredths) / 100;
      const lastReachingTicket = BigInt(CRASH_RTP_PERCENT) * outcomes / hundredths;
      assert(roll(lastReachingTicket) >= threshold, `Last ticket to reach ${threshold}x`);
      assert(roll(lastReachingTicket + 1n) < threshold, `First ticket below ${threshold}x`);
    }
    assert.equal(entropy.mock.callCount(), 20);
  } finally {
    entropy.mock.restore();
    syncBuiltinESMExports();
  }
});
