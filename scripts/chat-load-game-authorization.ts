import { setTimeout as pause } from 'node:timers/promises';
import { CHAT_GAME_AUTHORIZATION_BATCH_LIMIT, type ChatGameAuthorization, type ChatGameSession } from '../server/chatGameAuthorization';

export const authorizationSessionCount = 10_000;
export const authorizationBatchBudget = 4;
const framesPerSecond = 50;
const frameMs = 1_000 / framesPerSecond;

/** A paired check models admission and final publication authorization of the same source session. */
export async function measureGameAuthorization(authorization: ChatGameAuthorization, sessions: readonly ChatGameSession[],
  startAt: number, seconds: number, rate: number, signal: AbortSignal) {
  const start = performance.now() + (startAt - Date.now());
  const inFlight = new Set<Promise<void>>();
  let offered = 0, admitted = 0, verified = 0, failedBatches = 0, peakInFlight = 0;
  const admissionLatency: number[] = [], finalLatency: number[] = [];
  for (let frame = 0; frame < seconds * framesPerSecond && !signal.aborted; frame++) {
    const first = Math.floor(frame * rate / framesPerSecond);
    const end = Math.floor((frame + 1) * rate / framesPerSecond);
    const size = end - first;
    if (!size) continue;
    if (size > CHAT_GAME_AUTHORIZATION_BATCH_LIMIT) throw new RangeError('Authorization frame exceeds the runtime batch limit');
    const due = start + frame * frameMs;
    const cutoff = start + (Math.floor(frame / framesPerSecond) + 1) * 1_000;
    while (performance.now() < cutoff && !signal.aborted && (performance.now() < due || inFlight.size >= authorizationBatchBudget)) {
      await pause(Math.max(1, Math.ceil(due - performance.now())), undefined, { signal }).catch(error => {
        if (!signal.aborted) throw error;
      });
    }
    if (signal.aborted || performance.now() >= cutoff) continue;
    const references = Array.from({ length: size }, (_, offset) => sessions[(first + offset) % sessions.length]);
    offered += size;
    const pending = (async () => {
      const admissionAt = performance.now();
      const result = await authorization.admit(references);
      admissionLatency.push(performance.now() - admissionAt);
      if (result.length !== references.length) throw new Error('Authorization admission count mismatch');
      const allowed = references.filter((_, index) => result[index]?.clearanceGeneration === 0 && result[index]?.equippedSkinId === null);
      admitted += allowed.length;
      if (!allowed.length) return;
      const finalAt = performance.now();
      const publication = await authorization.verifyPublication(allowed);
      finalLatency.push(performance.now() - finalAt);
      if (publication.length !== allowed.length) throw new Error('Final authorization count mismatch');
      verified += publication.filter(at => at !== null && Number.isSafeInteger(at)).length;
    })().catch(() => { failedBatches++; }).finally(() => inFlight.delete(pending));
    inFlight.add(pending);
    peakInFlight = Math.max(peakInFlight, inFlight.size);
  }
  await Promise.all(inFlight);
  signal.throwIfAborted();
  const summarize = (values: number[]) => {
    values.sort((a, b) => a - b);
    return { batches: values.length, p95Ms: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null };
  };
  const planned = seconds * rate;
  return { planned, offered, missed: planned - offered, admitted, verified, failedBatches, peakInFlight,
    admissionLatency: summarize(admissionLatency), finalLatency: summarize(finalLatency),
    passed: offered / planned >= 0.99 && admitted === offered && verified === offered && failedBatches === 0 };
}
