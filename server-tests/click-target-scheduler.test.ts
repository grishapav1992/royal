import test from 'node:test';
import assert from 'node:assert/strict';
import { ClickTargetScheduler } from '../src/network/ClickTargetScheduler';

function fixture() {
  let now = 0, sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const sent: { destination: string; at: number }[] = [];
  const scheduler = new ClickTargetScheduler({ now: () => now, later: (callback, delay) => { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id as unknown as ReturnType<typeof setTimeout>; }, cancel: timer => { timers.delete(timer as unknown as number); } });
  const advance = (until: number) => {
    for (;;) {
      const ready = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!ready) break;
      now = ready[1].at; timers.delete(ready[0]); ready[1].callback();
    }
    now = until;
  };
  return { scheduler, sent, advance, choose: (destination: string) => scheduler.request(() => sent.push({ destination, at: now })) };
}

test('a nearby reopened table followed immediately by stairs keeps the latest destination', () => {
  const f = fixture();
  f.choose('reopened table'); f.advance(110); f.choose('old stairs'); f.advance(140); f.choose('selected stairs'); f.advance(199);
  assert.deepEqual(f.sent, [{ destination: 'reopened table', at: 0 }]);
  f.advance(200); assert.deepEqual(f.sent, [{ destination: 'reopened table', at: 0 }, { destination: 'selected stairs', at: 200 }]);
  f.advance(250); f.choose('next destination'); f.advance(399); assert.equal(f.sent.length, 2);
  f.advance(400); assert.deepEqual(f.sent[2], { destination: 'next destination', at: 400 });
});

test('manual movement, a dialog or shutdown cancels pending navigation without bypassing cooldown', () => {
  const f = fixture(); f.choose('table'); f.advance(30); f.choose('stairs'); f.scheduler.cancel(); f.advance(150);
  assert.deepEqual(f.sent, [{ destination: 'table', at: 0 }]);
  f.choose('fresh destination'); f.advance(199); assert.equal(f.sent.length, 1);
  f.advance(200); assert.deepEqual(f.sent[1], { destination: 'fresh destination', at: 200 });
  f.advance(210); f.choose('canceled on shutdown'); f.scheduler.cancel(); f.advance(1000); assert.equal(f.sent.length, 2);
});

test('a new hall revision clears the old route and allows its first destination immediately', () => {
  const f = fixture(); f.choose('old floor'); f.advance(25); f.choose('obsolete route'); f.scheduler.reset(); f.choose('new floor'); f.advance(500);
  assert.deepEqual(f.sent, [{ destination: 'old floor', at: 0 }, { destination: 'new floor', at: 25 }]);
});
