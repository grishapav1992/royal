/** Fetch decoration only while the hall is idle, yielding immediately to user intent. */
export class BackgroundImages {
 private timer?: ReturnType<typeof setInterval>;
 private controller?: AbortController;
 private disposed = false;
 private resumeAt = performance.now() + 2000;
 private loaded = new Set<string>();
 private failures = new Map<string, number>();
 constructor(private images: Readonly<Record<string, string>>, private accept: (key: string, image: HTMLImageElement) => void,
  private complete: () => void, private blocked = () => Boolean(document.querySelector('dialog[open]'))) {}
 start() { if (!this.timer && !this.disposed) this.timer = setInterval(() => this.pump(), 250); }
 pause(ms = 12000) {
  this.resumeAt = Math.max(this.resumeAt, performance.now() + ms);
  this.controller?.abort();
 }
 private pump() {
  if (this.disposed) return;
  if (this.blocked() || performance.now() < this.resumeAt) { this.controller?.abort(); return; }
  if (this.controller) return;
  const next = Object.entries(this.images).find(([key]) => !this.loaded.has(key) && (this.failures.get(key) ?? 0) < 3);
  if (next) void this.load(...next);
 }
 private async load(key: string, url: string) {
  const controller = this.controller = new AbortController();
  let objectUrl: string | undefined;
  try {
   const response = await fetch(url, { priority: 'low', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
   if (!response.ok) throw Error('Decoration image unavailable');
   const blob = await response.blob();
   if (this.disposed || controller.signal.aborted) return;
   objectUrl = URL.createObjectURL(blob);
   const image = new Image(); image.decoding = 'async'; image.src = objectUrl;
   await image.decode();
   if (this.disposed || controller.signal.aborted) return;
   this.accept(key, image); this.loaded.add(key);
   if (this.loaded.size === Object.keys(this.images).length) {
    clearInterval(this.timer); this.timer = undefined; this.complete();
   }
  } catch {
   if (!controller.signal.aborted && !this.disposed) {
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
    this.resumeAt = Math.max(this.resumeAt, performance.now() + 3000);
   }
  } finally {
   if (objectUrl) URL.revokeObjectURL(objectUrl);
   if (this.controller === controller) this.controller = undefined;
  }
 }
 destroy() { this.disposed = true; clearInterval(this.timer); this.timer = undefined; this.controller?.abort(); }
}
