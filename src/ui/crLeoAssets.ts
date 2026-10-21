import { extractSpriteFrames, type SpriteFrame } from './crLeoSprites';
import { CR_LEO_ASSETS } from './crLeoAssetManifest';

export type CrLeoAsset = { image: HTMLImageElement; frames?: SpriteFrame[] };
type AssetSpec = { key: string; file: string; bytes: number };
type LoadAsset = (spec: AssetSpec, progress: (fraction: number) => void, retry: boolean) => Promise<CrLeoAsset>;

async function loadAsset(spec: AssetSpec, progress: (fraction: number) => void, retry: boolean): Promise<CrLeoAsset> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 45000);
  let url: string | undefined;
  try {
    const response = await fetch('/assets/cr-vs-leo/v2/' + spec.file, { signal: controller.signal, cache: retry ? 'reload' : 'force-cache' });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw Error('Football image unavailable');
    const total = Number(response.headers.get('Content-Length')) || spec.bytes, chunks: BlobPart[] = [];
    if (response.body) {
      const reader = response.body.getReader(); let received = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        received += value.byteLength; chunks.push(new Uint8Array(value).buffer);
        progress(Math.min(.9, received / total * .9));
      }
    } else chunks.push(await response.arrayBuffer());
    progress(.9);
    url = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('Content-Type')! }));
    const image = new Image(); image.src = url; await image.decode();
    // Let the progress bar paint before preparing the next atlas on the main thread.
    await new Promise(resolve => setTimeout(resolve, 0));
    const name = spec.key;
    const frames = name.startsWith('stadium') ? undefined : extractSpriteFrames(image,
      name.startsWith('keeper-') || name.startsWith('wall') ? 2 : 4,
      name.startsWith('keeper') || name.startsWith('wall') ? 2 : 4,
      name === 'cr' || name.startsWith('wall'),
      name === 'keeper' ? [undefined,undefined,'left','left',undefined,'right','right',undefined] : name === 'keeper-reach' ? ['left','right','high','center'] : name === 'keeper-dive' ? ['left','right','left','right'] : undefined,
      name === 'wall-far' ? 3 : name === 'wall' ? 5 : 1);
    return { image, frames };
  } finally { clearTimeout(timeout); if (url) URL.revokeObjectURL(url); }
}

/** Share downloads and prepared frames across game windows without sharing game state. */
export class CrLeoAssetStore {
  private values = new Map<string, CrLeoAsset>();
  private progress = new Map<string, number>();
  private failures = new Set<string>();
  private attempted = new Set<string>();
  private listeners = new Set<() => void>();
  private pending?: Promise<void>;
  private jobs: AssetSpec[] = [];
  constructor(private specs: readonly AssetSpec[] = CR_LEO_ASSETS, private load: LoadAsset = loadAsset) {}
  get(key: string) { return this.values.get(key); }
  state() {
    const specs = this.specs;
    const ready = specs.every(spec => this.values.has(spec.key));
    const total = specs.reduce((n, spec) => n + spec.bytes, 0);
    const loaded = specs.reduce((n, spec) => n + spec.bytes * (this.progress.get(spec.key) ?? 0), 0);
    return { ready, percent: ready ? 100 : Math.min(99, Math.floor(100 * loaded / Math.max(1, total))), failed: specs.some(spec => this.failures.has(spec.key)), loading: !!this.pending };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); }; }
  private notify() { this.listeners.forEach(listener => listener()); }
  start(): Promise<void> {
    if (this.pending) return this.pending;
    this.jobs = this.specs.filter(spec => !this.values.has(spec.key));
    if (!this.jobs.length) return Promise.resolve();
    this.failures.clear(); this.jobs.forEach(spec => this.progress.set(spec.key, 0));
    const worker = async () => {
      while (this.jobs.length) {
        const spec = this.jobs.shift()!;
        const key = spec.key;
        try {
          const retry = this.attempted.has(key); this.attempted.add(key);
          const asset = await this.load(spec, fraction => {
            this.progress.set(key, Math.max(this.progress.get(key) ?? 0, Math.min(.99, Math.max(0, fraction)))); this.notify();
          }, retry);
          this.values.set(key, asset); this.progress.set(key, 1);
        } catch { this.failures.add(key); }
        this.notify();
      }
    };
    this.pending = Promise.all([worker(), worker()]).then(() => {}).finally(() => { this.pending = undefined; this.notify(); });
    this.notify(); return this.pending;
  }
}

export const crLeoAssets = new CrLeoAssetStore();
