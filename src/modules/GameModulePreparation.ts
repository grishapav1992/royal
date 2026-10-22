import { gameModuleContract, type IndependentGameId } from './GameModuleCatalog';
import { validModulePointer, validModuleManifest, moduleDigest, moduleRoot,
 type GameModuleManifest, type GameModulePointer } from './GameModuleManifest';

const MAX_MANIFESTS = 16;
const MAX_WARM_RESOURCES = 16;
const MAX_WARM_BYTES = 8 * 1024 * 1024;
type Package = Readonly<{ metadata: GameModuleManifest; root: string }>;
const manifests = new Map<string, Package>();
const manifestRequests = new Map<string, Promise<Package>>();
const failedManifests = new Set<string>();

function remember<T>(cache: Map<string, T>, key: string, value: T) {
 cache.delete(key); cache.set(key, value);
 while (cache.size > MAX_MANIFESTS) cache.delete(cache.keys().next().value!);
}

function waiting<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
 if (!signal) return promise;
 if (signal.aborted) return Promise.reject(new DOMException('Game closed', 'AbortError'));
 return new Promise((resolve, reject) => {
  const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Game closed', 'AbortError')); };
  signal.addEventListener('abort', abort, { once: true });
  promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
   error => { signal.removeEventListener('abort', abort); reject(error); });
 });
}

async function json(url: string, signal: AbortSignal, cache: RequestCache) {
 const response = await fetch(url, { cache, credentials: 'same-origin', signal });
 if (!response.ok) throw Error('Game package is unavailable');
 if (Number(response.headers.get('Content-Length')) > 65536) throw Error('Game manifest is too large');
 const bytes = await response.arrayBuffer();
 if (bytes.byteLength > 65536) throw Error('Game manifest is too large');
 return { bytes, data: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
}

function immutablePackage(pointer: GameModulePointer): Promise<Package> {
 const key = pointer.manifest + ':' + pointer.sha256;
 const cached = manifests.get(key);
 if (cached) { remember(manifests, key, cached); return Promise.resolve(cached); }
 const pending = manifestRequests.get(key);
 if (pending) return pending;
 const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
 const reload = failedManifests.delete(key);
 const request = (async () => {
  const manifest = await json(pointer.manifest, controller.signal, reload ? 'reload' : 'force-cache');
  if (await moduleDigest(manifest.bytes) !== pointer.sha256 || !validModuleManifest(manifest.data, pointer.manifest, pointer.gameId))
   throw Error('Incompatible game package');
  const metadata = manifest.data;
  Object.freeze(metadata.styles); Object.freeze(metadata.files);
  const preload = (metadata as GameModuleManifest & { preload?: unknown }).preload;
  if (Array.isArray(preload)) Object.freeze(preload);
  Object.freeze(metadata);
  const result = Object.freeze({ metadata, root: moduleRoot(metadata.version, pointer.gameId) });
  remember(manifests, key, result);
  return result;
 })().catch(error => {
  failedManifests.add(key);
  while (failedManifests.size > MAX_MANIFESTS) failedManifests.delete(failedManifests.values().next().value!);
  throw error;
 }).finally(() => { clearTimeout(timeout); manifestRequests.delete(key); });
 manifestRequests.set(key, request);
 return request;
}

/** Each opening checks the active pointer; only verified immutable metadata is shared. */
export async function loadGameModule(gameId: IndependentGameId, signal: AbortSignal): Promise<Package> {
 if (!gameModuleContract(gameId)) throw Error('Unsupported independent game');
 const pointer = (await json(`/game-modules/${gameId}/active.json`, signal, 'no-store')).data;
 if (!validModulePointer(pointer, gameId)) throw Error('Invalid game pointer');
 if (signal.aborted) throw new DOMException('Game closed', 'AbortError');
 return waiting(immutablePackage(pointer), signal);
}

async function warm(gameId: IndependentGameId, controller: AbortController): Promise<boolean> {
 const timeout = setTimeout(() => controller.abort(), 20000);
 try {
  const { metadata, root } = await loadGameModule(gameId, controller.signal);
  const hints = (metadata as GameModuleManifest & { preload?: unknown }).preload;
  const images = Array.isArray(hints) ? hints.filter((path): path is string => typeof path === 'string'
   && Object.hasOwn(metadata.files, path) && /^media\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|avif|gif|svg)$/.test(path)) : [];
  const resources = [...new Set([metadata.entry, ...metadata.styles, ...images])].slice(0, MAX_WARM_RESOURCES);
  let next = 0, bytes = 0;
  const worker = async () => {
   while (next < resources.length) {
    const response = await fetch(root + resources[next++], { cache: 'force-cache', credentials: 'same-origin', signal: controller.signal, priority: 'low' });
    if (!response.ok) throw Error('Game resource is unavailable');
    if (Number(response.headers.get('Content-Length')) > MAX_WARM_BYTES - bytes) throw Error('Game preparation budget exceeded');
    if (response.body) {
     const reader = response.body.getReader();
     try {
      for (;;) {
       const chunk = await reader.read();
       if (chunk.done) break;
       bytes += chunk.value.byteLength;
       if (bytes > MAX_WARM_BYTES) throw Error('Game preparation budget exceeded');
      }
     } finally { await reader.cancel().catch(() => undefined); }
    }
   }
  };
  await Promise.all([worker(), worker()]);
  return true;
 } catch { return false; }
 finally { clearTimeout(timeout); controller.abort(); }
}

type Preparation = { gameId: IndependentGameId; promise: Promise<boolean>; finish: (ready: boolean) => void; controller: AbortController };
let active: Preparation | undefined;
let queued: Preparation | undefined;
const preparedAt = new Map<string, number>();

function start(job: Preparation) {
 active = job;
 void warm(job.gameId, job.controller).then(ready => {
  if (ready) remember(preparedAt, job.gameId, Date.now());
  job.finish(ready);
 }).finally(() => {
  active = undefined;
  if (queued) { const next = queued; queued = undefined; start(next); }
 });
}

/** Warm static files for one intended game without evaluating its code or creating a round. */
export function prepareGameModule(gameId: IndependentGameId): Promise<boolean> {
 if (!gameModuleContract(gameId)) return Promise.resolve(false);
 if (active?.gameId === gameId) return active.promise;
 if (queued?.gameId === gameId) return queued.promise;
 if (Date.now() - (preparedAt.get(gameId) ?? 0) < 30000) return Promise.resolve(true);
 let finish!: (ready: boolean) => void;
 const promise = new Promise<boolean>(resolve => { finish = resolve; });
 const job = { gameId, promise, finish, controller: new AbortController() };
 if (!active) start(job);
 else { queued?.finish(false); queued = job; active.controller.abort(); }
 return promise;
}
