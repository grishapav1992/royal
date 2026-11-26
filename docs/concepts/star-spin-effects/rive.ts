import { assetUrl } from "./media";
export const MODES = ["idle", "spin_wait", "wild_align", "bonus_enter", "bonus_idle", "round_win", "select"] as const;
export type Mode = (typeof MODES)[number];
type RiveMod = typeof import("@rive-app/webgl2");

const b64 = (s: string) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
let runtime: Promise<RiveMod> | null = null;
function loadRuntime() {
  runtime ??= (async () => {
    const [mod, j] = await Promise.all([import("@rive-app/webgl2"), fetch(assetUrl("characters/rive-runtime.json")).then((r) => r.json())]);
    mod.RuntimeLoader.setWasmFallbackUrl(null);
    mod.RuntimeLoader.setWasmThreadsUrl(null);
    mod.RuntimeLoader.setReplayWorker(false);
    mod.RuntimeLoader.setWasmBinary(b64(j.data));
    return mod;
  })();
  return runtime;
}
const chars = new Map<string, Promise<{ buffer: ArrayBuffer; artboard: string }>>();
const loadChar = (id: string) => {
  if (!chars.has(id)) chars.set(id, fetch(assetUrl(`characters/${id}-rive.json`)).then((r) => r.json()).then((j) => {
    if (j.stateMachine !== "Character" || !MODES.every((m, i) => j.modes?.[i] === m)) throw new Error("contract");
    return { buffer: b64(j.data), artboard: j.artboard as string };
  }));
  return chars.get(id)!;
};

/** Героиня: Rive со статичной WebP подложкой. Реакции как в исходном модуле: режим на 1500 мс, затем базовый. */
export class Companion {
  private native: InstanceType<RiveMod["Rive"]> | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private epoch = 0; private timer: number | undefined; private ro: ResizeObserver | undefined;
  base: Mode = "idle"; mode: Mode = "idle"; ready = false;
  constructor(private target: HTMLElement) {}
  async load(id: string, enabled: boolean) {
    const e = ++this.epoch; this.release();
    if (!enabled) return;
    try {
      const [mod, c] = await Promise.all([loadRuntime(), loadChar(id)]);
      if (e !== this.epoch) return;
      const canvas = document.createElement("canvas"); canvas.className = "ss-rive-canvas"; canvas.setAttribute("aria-hidden", "true");
      this.target.append(canvas); this.canvas = canvas;
      this.native = new mod.Rive({
        buffer: c.buffer, canvas, artboard: c.artboard, stateMachines: "Character", autoBind: true, autoplay: true,
        shouldDisableRiveListeners: true, automaticallyHandleEvents: false,
        layout: new mod.Layout({ fit: mod.Fit.Contain, alignment: mod.Alignment.Center }),
        onLoad: () => {
          if (e !== this.epoch) return;
          this.ready = true; this.native?.resizeDrawingSurfaceToCanvas(); this.setMode(this.base);
          this.target.classList.add("ss-rive-ready");
        },
        onLoadError: () => { if (e === this.epoch) this.release(); },
      });
      this.ro = new ResizeObserver(() => this.native?.resizeDrawingSurfaceToCanvas()); this.ro.observe(this.target);
    } catch { if (e === this.epoch) this.release(); }
  }
  private setMode(m: Mode) { this.mode = m; const p = this.native?.viewModelInstance?.number("mode"); if (p) p.value = MODES.indexOf(m); }
  setBase(m: Mode) { this.base = m; if (this.timer === undefined) this.setMode(m); }
  react(m: Mode) {
    if (!this.ready) return;
    this.cancelReaction(); this.setMode(m);
    this.timer = window.setTimeout(() => { this.timer = undefined; this.setMode(this.base); }, 1500);
  }
  cancelReaction() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; this.setMode(this.base); }
  release() {
    if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined;
    this.ro?.disconnect(); this.ro = undefined;
    this.native?.cleanup(); this.native = undefined; this.canvas?.remove(); this.canvas = undefined;
    this.target.classList.remove("ss-rive-ready"); this.ready = false;
  }
  destroy() { this.epoch++; this.release(); }
}
