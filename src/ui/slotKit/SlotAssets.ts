export type SlotAssetState = {
  status: 'loading' | 'ready' | 'error';
  loaded: number;
  total: number;
};

const browserImage = () => new Image();
const CACHE_KEY = Symbol.for('royal.slot.decoded-images.v1');
const CACHE_LIMIT = 64 * 1024 * 1024;
type ImageCache = { images: Map<string, { image: HTMLImageElement; bytes: number }>; bytes: number };
function sharedCache(): ImageCache {
  const host = globalThis as typeof globalThis & Record<symbol, unknown>;
  return (host[CACHE_KEY] ??= { images: new Map(), bytes: 0 }) as ImageCache;
}
function immutable(url: string) { return /^\/game-modules\/[^/]+\/versions\/[^/]+\/media\//.test(url); }
function cached(url: string) {
  if (!immutable(url)) return;
  const cache = sharedCache(), entry = cache.images.get(url);
  if (entry) { cache.images.delete(url); cache.images.set(url, entry); }
  return entry?.image;
}
function remember(url: string, image: HTMLImageElement) {
  if (!immutable(url)) return;
  const cache = sharedCache(), bytes = image.naturalWidth * image.naturalHeight * 4;
  if (bytes > CACHE_LIMIT) return;
  const previous = cache.images.get(url);
  if (previous) { cache.bytes -= previous.bytes; cache.images.delete(url); }
  cache.images.set(url, { image, bytes }); cache.bytes += bytes;
  while (cache.bytes > CACHE_LIMIT) {
    const first = cache.images.keys().next().value!;
    cache.bytes -= cache.images.get(first)!.bytes; cache.images.delete(first);
  }
}

/** Keep visible artwork covered until its required images have decoded. */
export class SlotAssets<AssetName extends string> {
  private images = new Map<AssetName, HTMLImageElement>();
  private pending = new Set<() => void>();
  private loading = new Map<AssetName, Promise<void>>();
  private required: readonly AssetName[];
  private generation = 0;
  private disposed = false;
  private status: SlotAssetState['status'] = 'loading';

  constructor(
    private assets: Readonly<Record<AssetName, string>>,
    private changed: (state: SlotAssetState) => void,
    private createImage: () => HTMLImageElement = browserImage,
    private timeoutMs = 30000,
  ) { this.required = Object.keys(assets) as AssetName[]; }

  get state(): SlotAssetState {
    return {status: this.status, loaded: this.required.filter(name => this.images.has(name)).length, total: this.required.length};
  }

  get ready() { return !this.disposed && this.status === 'ready'; }

  has(name: AssetName) { return this.images.has(name); }

  trim() { for (const name of this.images.keys()) if (!this.required.includes(name)) this.images.delete(name); }

  async load(required: readonly AssetName[] = Object.keys(this.assets) as AssetName[]): Promise<boolean> {
    if (this.disposed) return false;
    const generation = ++this.generation;
    this.cancelPending();
    this.required = [...new Set(required)];
    this.status = 'loading';
    this.changed(this.state);
    try {
      await Promise.all(this.required.map(name =>
        this.images.has(name) ? Promise.resolve() : this.loadImage(name, generation)));
      if (this.disposed || generation !== this.generation) return false;
      this.status = 'ready';
      this.changed(this.state);
      return true;
    } catch {
      if (this.disposed || generation !== this.generation) return false;
      this.status = 'error';
      this.cancelPending();
      this.changed(this.state);
      return false;
    }
  }

  /** Load a newly opened photo or gallery without resetting the ready game stage. */
  async ensure(names: readonly AssetName[]): Promise<boolean> {
    if (this.disposed) return false;
    const generation = this.generation;
    try {
      await Promise.all(names.map(name => this.images.has(name) ? Promise.resolve() : this.loadImage(name, generation)));
      return !this.disposed && generation === this.generation;
    } catch { return false; }
  }

  private loadImage(name: AssetName, generation: number): Promise<void> {
    const existing = this.loading.get(name);
    if (existing) return existing;
    const image = this.createImage === browserImage ? cached(this.assets[name]) : undefined;
    if (image) { this.images.set(name, image); if (this.required.includes(name)) this.changed(this.state); return Promise.resolve(); }
    const task = new Promise<void>((resolve, reject) => {
      const image = this.createImage();
      let settled = false, decoding = false;
      const cleanup = () => {
        clearTimeout(timer);
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
        this.pending.delete(cancel);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          image.removeAttribute('src');
          reject(error);
        }
        else {
          this.images.set(name, image);
          if (this.createImage === browserImage) remember(this.assets[name], image);
          if (this.required.includes(name)) this.changed(this.state);
          resolve();
        }
      };
      const cancel = () => finish(new Error('Image loading cancelled'));
      const failed = () => finish(new Error('Image loading failed'));
      const loaded = async () => {
        if (settled || decoding) return;
        decoding = true;
        try {
          await image.decode();
          if (this.disposed || generation !== this.generation) { cancel(); return; }
          if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
          finish();
        } catch { failed(); }
      };
      const timer = setTimeout(failed, this.timeoutMs);
      this.pending.add(cancel);
      image.decoding = 'async';
      image.fetchPriority = 'high';
      image.addEventListener('load', loaded);
      image.addEventListener('error', failed);
      image.src = this.assets[name];
      if (image.complete && image.naturalWidth) void loaded();
    }).finally(() => { if (this.loading.get(name) === task) this.loading.delete(name); });
    this.loading.set(name, task);
    return task;
  }

  private cancelPending() {
    for (const cancel of [...this.pending]) cancel();
    this.loading.clear();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.cancelPending();
    this.images.clear();
  }
}
