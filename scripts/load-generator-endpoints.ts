import { loopbackEndpoint, StandError, verifyStandStatus, type StandManifest } from './load-stand-contract';

export function generatorApiOrigins(apiPorts: string | undefined, workers: number, canonicalEndpoint: string, controlEndpoint: string): string[] {
  const canonical = loopbackEndpoint(canonicalEndpoint), control = loopbackEndpoint(controlEndpoint);
  if (!Number.isInteger(workers) || workers < 1 || workers > 32) throw new StandError('invalid-generator-api-ports');
  if (apiPorts === undefined) return Array<string>(workers).fill(canonical);
  const values = apiPorts.split(',');
  if (values.length < workers || values.length > 128 || values.some(value => !/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65535)
    || new Set(values.map(Number)).size !== values.length || values.some(value => Number(value) === Number(new URL(control).port))) throw new StandError('invalid-generator-api-ports');
  return values.map(port => loopbackEndpoint('http://127.0.0.1:' + port));
}

/** Keep one alias per generator, or spread successive connection batches across more aliases. */
export function generatorBatchApiIndex(originCount: number, workers: number, generator: number, batch: number): number {
  if (!Number.isInteger(workers) || workers < 1 || workers > 32 || !Number.isInteger(originCount) || originCount < workers || originCount > 128
    || !Number.isInteger(generator) || generator < 0 || generator >= workers || !Number.isSafeInteger(batch) || batch < 0) throw new StandError('invalid-generator-api-assignment');
  return originCount === workers ? generator : batch % originCount;
}

export async function attestGeneratorApiOrigins(origins: readonly string[], manifest: StandManifest, status: (origin: string) => Promise<unknown>) {
  for (const origin of new Set(origins)) verifyStandStatus(await status(loopbackEndpoint(origin)), manifest);
}

/** Map a pinned canonical reservation to the API alias already attested by the parent. */
export function generatorWebSocketEndpoint(endpoint: string, targetEndpoint: string, canonicalEndpoint?: string): string {
  const url = new URL(endpoint), target = new URL(targetEndpoint);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new StandError('unexpected-generator-websocket-endpoint');
  if (canonicalEndpoint === undefined) {
    if (url.host !== target.host) throw new StandError('unexpected-generator-websocket-endpoint');
    return endpoint;
  }
  const canonical = new URL(loopbackEndpoint(canonicalEndpoint));
  loopbackEndpoint(targetEndpoint);
  if (url.protocol !== 'ws:' || url.host !== canonical.host || url.hash
    || !/^\/workers\/(?:main|worker-(?:[1-9]|1[0-9]|2[0-3]))\/[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_-]{1,64}$/.test(url.pathname)) throw new StandError('unexpected-generator-websocket-endpoint');
  url.host = target.host;
  return url.href;
}
