export const SOURCE_REFRESH_IDLE_MS = 1000;
type Schedule = (job: () => Promise<void>, delayMs: number) => () => void;
const systemSchedule: Schedule = (job, delayMs) => {
  const timer = setTimeout(job, delayMs);
  return () => clearTimeout(timer);
};

/** Start the next full audit after completion, without skipped interval ticks or overlap. */
export function scheduleSourceRefresh(refresh: () => Promise<void>, schedule: Schedule = systemSchedule) {
  let stopped = false;
  let cancel = () => {};
  const next = () => {
    cancel = schedule(async () => {
      try { await refresh(); }
      finally { if (!stopped) next(); }
    }, SOURCE_REFRESH_IDLE_MS);
  };
  next();
  return () => { stopped = true; cancel(); };
}
