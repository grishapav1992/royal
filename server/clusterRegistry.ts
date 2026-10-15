export const READY_PROCESSES_KEY = 'royal:lobby:ready-processes';
export const WORKER_LEASE_PREFIX = 'royal:lobby:worker:';
export const workerLeaseKey = (workerId: string) => WORKER_LEASE_PREFIX + workerId;

export function parseReadyProcess(value: unknown): { workerId: string; owner: string } | undefined {
  if (typeof value !== 'string' || value.length > 512) return;
  try {
    const entry = JSON.parse(value);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.workerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.workerId)
      || typeof entry.owner !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(entry.owner)) return;
    return { workerId: entry.workerId, owner: entry.owner };
  } catch { return; }
}
