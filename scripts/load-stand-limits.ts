export const MAX_MEASUREMENT_SECONDS = 1800;
const STANDARD_STAND_CLIENT_LIMIT = 6000;
const EXTENDED_SESSION_OVERHEAD_SECONDS = 1200;
export const MAX_STAND_SESSION_MS = (MAX_MEASUREMENT_SECONDS + EXTENDED_SESSION_OVERHEAD_SECONDS) * 1000;
export const DEFAULT_GAME_PROCESSES = 4;
export const MAX_GAME_PROCESSES = 36;
export const MAX_STAND_CLIENTS = 10_000;
export const STAND_ROOM_CAPACITY = 30;
export const STAND_MAX_ROOMS_PER_PROCESS = 10;
export const STAND_MAX_CONNECTIONS_PER_PROCESS = 330;
export const MAX_STAND_PREPARATION_MS = 15 * 60000;
export const MAX_STAND_METRIC_INTERVALS = 300;

function checkStandClientCount(clients: number) {
  if (!Number.isSafeInteger(clients) || clients < 4 || clients > MAX_STAND_CLIENTS) throw new RangeError('invalid-stand-client-count');
}

export function standDatabaseConnectionLimit(gameProcesses = DEFAULT_GAME_PROCESSES): number {
  standGameProcessIds(gameProcesses);
  return Math.max(100, (gameProcesses - 1) * 6 + 10 + 10 + 20);
}

export function standGameProcessIds(gameProcesses = DEFAULT_GAME_PROCESSES): string[] {
  if (!Number.isSafeInteger(gameProcesses) || gameProcesses < 1 || gameProcesses > MAX_GAME_PROCESSES) throw new RangeError('invalid-stand-game-processes');
  return Array.from({ length: gameProcesses }, (_, index) => index === 0 ? 'main' : 'worker-' + index);
}

export function standLoadProfile(clients: number, gameProcesses = DEFAULT_GAME_PROCESSES) {
  const owners = standGameProcessIds(gameProcesses);
  const maxSeats = gameProcesses * STAND_MAX_ROOMS_PER_PROCESS * STAND_ROOM_CAPACITY;
  checkStandClientCount(clients);
  if (clients > maxSeats) throw new RangeError('stand-profile-capacity-exceeded');
  return { clients, gameProcesses, owners, maxSeats, maxRooms: gameProcesses * STAND_MAX_ROOMS_PER_PROCESS };
}

export function standPreparationTimeoutMs(clients: number): number {
  checkStandClientCount(clients);
  return clients > DEFAULT_GAME_PROCESSES * STAND_MAX_ROOMS_PER_PROCESS * STAND_ROOM_CAPACITY ? MAX_STAND_PREPARATION_MS : 5 * 60000;
}

/** A 10,000-client run needs at least 500 seconds at four new clients per 200 ms. */
export function standAdmissionTimeoutMs(clients: number): number {
  checkStandClientCount(clients);
  return (clients <= STANDARD_STAND_CLIENT_LIMIT ? 8 : 15) * 60000;
}

export function standStartupTimeoutMs(gameProcesses = DEFAULT_GAME_PROCESSES): number {
  standGameProcessIds(gameProcesses);
  return gameProcesses > DEFAULT_GAME_PROCESSES ? 120000 : 30000;
}

/** Leave bounded time for admission, synchronization and cleanup around the measurement. */
export function standSessionDurationMs(seconds: number, clients = 4): number {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_MEASUREMENT_SECONDS) throw new RangeError('invalid-stand-duration');
  checkStandClientCount(clients);
  const overheadSeconds = clients <= STANDARD_STAND_CLIENT_LIMIT ? 600 : EXTENDED_SESSION_OVERHEAD_SECONDS;
  return (seconds + overheadSeconds) * 1000;
}
