export type SlotAssetState = {
  status: 'loading' | 'ready' | 'error';
  loaded: number;
  total: number;
};

/** Keep a cabinet covered until every image has finished downloading and decoding. */
export class SlotAssets<AssetName extends string> {
  private images = new Map<AssetName, HTMLImageElement>();
  private pending = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private status: SlotAssetState['status'] = 'loading';

  constructor(
    private assets: Readonly<Record<AssetName, string>>,
    private changed: (state: SlotAssetState) => void,
    private createImage: () => HTMLImageElement = () => new Image(),
    private timeoutMs = 30000,
  ) {}

  get state(): SlotAssetState {
    return {status: this.status, loaded: this.images.size, total: Object.keys(this.assets).length};
  }

  get ready() { return !this.disposed && this.status === 'ready'; }

  async load(): Promise<boolean> {
    if (this.disposed) return false;
    const generation = ++this.generation;
    this.cancelPending();
    this.status = 'loading';
    this.changed(this.state);
    try {
      await Promise.all((Object.keys(this.assets) as AssetName[]).map(name =>
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

  private loadImage(name: AssetName, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
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
          this.changed(this.state);
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
    });
  }

  private cancelPending() {
    for (const cancel of [...this.pending]) cancel();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.cancelPending();
    this.images.clear();
  }
}
