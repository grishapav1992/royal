import { matchMaker, ServerError, type Presence } from '@colyseus/core';
import { SERVER_BUSY } from './lobbyAdmission';
import { READY_PROCESSES_KEY, parseReadyProcess, workerLeaseKey } from './clusterRegistry';

export type RoomProcessStats = { processId: string; roomCount: number; available?: boolean };
type FetchStats = () => Promise<RoomProcessStats[]>;
type Provisional = { observed: number; selections: number[] };
const SELECTION_TTL_MS = 5000;
const MAX_PENDING_SELECTIONS = 128;

export async function fetchAvailableProcesses(presence: Pick<Presence, 'channels' | 'hgetall' | 'get'> = matchMaker.presence,
  fetchStats: FetchStats = matchMaker.stats.fetchAll): Promise<RoomProcessStats[]> {
  const [stats, channels, ready] = await Promise.all([
    fetchStats(), presence.channels('p:*'), presence.hgetall(READY_PROCESSES_KEY),
  ]);
  const active = new Set(channels.map(channel => channel.slice(2)));
  const leases = new Map<string, Promise<unknown>>();
  const available = await Promise.all(stats.map(async stat => {
    if (stat.available === false || !/^[A-Za-z0-9_-]{1,64}$/.test(stat.processId) || !active.has(stat.processId)
      || (stat.processId === matchMaker.processId && matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN)) return false;
    const entry = parseReadyProcess(ready[stat.processId]);
    if (!entry) return false;
    if (!leases.has(entry.workerId)) leases.set(entry.workerId, Promise.resolve(presence.get(workerLeaseKey(entry.workerId))));
    return await leases.get(entry.workerId) === entry.owner;
  }));
  return stats.filter((_stat, index) => available[index]);
}

// One HTTP matchmaking ingress owns this ledger. Room.onCreate still enforces the hard limit.
export function selectRoomProcess(maxRooms: number, fetchStats: FetchStats = fetchAvailableProcesses,
  now: () => number = () => performance.now()): matchMaker.SelectProcessIdCallback {
  if (!Number.isSafeInteger(maxRooms) || maxRooms < 1) throw new RangeError('maxRooms must be a positive safe integer');
  const provisional = new Map<string, Provisional>();
  let previous = '', pendingSelections = 0, queue: Promise<void> = Promise.resolve();

  const select = async () => {
    const stats = await fetchStats(), at = now();
    const live = new Set(stats.map(stat => stat.processId));
    for (const id of provisional.keys()) if (!live.has(id)) provisional.delete(id);
    const candidates: { id: string; count: number; pending: Provisional }[] = [];
    for (const stat of stats) {
      if (stat.available === false || !stat.processId || !Number.isSafeInteger(stat.roomCount) || stat.roomCount < 0) continue;
      let pending = provisional.get(stat.processId);
      if (!pending) {
        pending = { observed: stat.roomCount, selections: [] };
        provisional.set(stat.processId, pending);
      }
      // Native stats can lag by a second. Confirm selections before expiring the remainder.
      const confirmed = Math.max(0, stat.roomCount - pending.observed);
      pending.selections.splice(0, Math.min(confirmed, pending.selections.length));
      pending.selections = pending.selections.filter(selectedAt => at - selectedAt < SELECTION_TTL_MS);
      pending.observed = stat.roomCount;
      const count = stat.roomCount + pending.selections.length;
      if (count < maxRooms) candidates.push({ id: stat.processId, count, pending });
    }
    if (!candidates.length) throw new ServerError(503, SERVER_BUSY);
    candidates.sort((a, b) => a.count - b.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const least = candidates.filter(candidate => candidate.count === candidates[0].count);
    const chosen = least.find(candidate => candidate.id > previous) ?? least[0];
    previous = chosen.id;
    chosen.pending.selections.push(at);
    return chosen.id;
  };

  return () => {
    if (pendingSelections >= MAX_PENDING_SELECTIONS) return Promise.reject(new ServerError(503, SERVER_BUSY));
    pendingSelections++;
    // FIFO also prevents an older asynchronous stats read from overwriting a newer observation.
    const selection = queue.then(select).finally(() => { pendingSelections--; });
    queue = selection.then(() => {}, () => {});
    return selection;
  };
}
