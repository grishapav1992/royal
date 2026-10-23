import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSourceRefresh, SOURCE_REFRESH_IDLE_MS } from '../../server/finance/source-refresh';

function clock() {
  let now = 0, id = 0;
  const jobs = new Map<number, { at: number; run: () => Promise<void> }>();
  return {
    jobs,
    elapse(ms: number) { now += ms; },
    schedule(run: () => Promise<void>, delay: number) {
      const key = ++id; jobs.set(key, {at:now+delay,run}); return () => { jobs.delete(key); };
    },
    fire() { const [key,job] = [...jobs][0]; jobs.delete(key); now=job.at; return job.run(); },
    get now() { return now; },
  };
}

test('a long full audit schedules its successor promptly and never overlaps another audit', async () => {
  const timer=clock(); let complete!:()=>void, active=0, calls=0;
  const stop=scheduleSourceRefresh(async()=>{
    assert.equal(++active,1);calls++;
    await new Promise<void>(resolve=>{complete=resolve;});active--;
  },timer.schedule);
  const first=timer.fire();timer.elapse(75000);
  assert.equal(timer.jobs.size,0);assert.equal(calls,1);
  complete();await first;
  assert.equal([...timer.jobs.values()][0].at-timer.now,SOURCE_REFRESH_IDLE_MS);
  const second=timer.fire();assert.equal(calls,2);
  stop();complete();await second;assert.equal(timer.jobs.size,0);
});

test('shutdown cancels an idle timer and a failed audit retains one bounded retry', async () => {
  const idle=clock();let calls=0;
  const cancel=scheduleSourceRefresh(async()=>{calls++;},idle.schedule);
  cancel();cancel();assert.equal(idle.jobs.size,0);assert.equal(calls,0);
  const failed=clock(), stop=scheduleSourceRefresh(async()=>{throw Error('audit failed');},failed.schedule);
  await assert.rejects(failed.fire(),/audit failed/);
  assert.equal(failed.jobs.size,1);stop();assert.equal(failed.jobs.size,0);
});
