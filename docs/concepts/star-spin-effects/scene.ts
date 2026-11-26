import { assetUrl } from "./media";
import { sharedAudio } from "./audio";
import { Companion, type Mode } from "./rive";
import {
  FIXTURES, HEROES, STAKE_CENTS, START_BALANCE_CENTS, SYMBOL_NAMES, classify, column, formatMoney, payoutCents, symbolSrc,
  type Fixture, type HeroId, type LineWin, type Side,
} from "./fixtures";

/** Маршруты 20 линий исходного модуля (строки слева направо). */
const LINES = [[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0],[2,1,1,1,2],[1,0,1,2,1],[1,2,1,0,1],[0,1,0,1,0],[2,1,2,1,2],[1,1,0,1,1],[1,1,2,1,1],[0,2,0,2,0],[2,0,2,0,2],[0,2,1,2,0]];

export type Variant = "old" | "new";
export type ScenarioId =
  | "lift" | "twoPortals" | "tower" | "routes"
  | "o_none" | "o_partial" | "o_return" | "o_positive" | "o_large"
  | "bonusEnter" | "bonusFree" | "bonusEnd"
  | "wait" | "ship" | "glow" | "palette";
export interface Settings { reduced: boolean; fast: boolean }

const SPIN_FIXTURE: Partial<Record<ScenarioId, keyof typeof FIXTURES>> = {
  lift: "zero", twoPortals: "two", tower: "nudge", routes: "multi",
  o_none: "zero", o_partial: "partial", o_return: "even", o_positive: "multi", o_large: "large",
};

interface View { cells: number[]; mults: number[]; lines: LineWin[]; balance: number; payout: number; net: number | null; bonus: number | null; note: string; status: string; phase: string }

const ABORT = Symbol("abort");
const OVERDRIVE = "Режим перегрузки. Продолжение бесплатно.";
function resultText(payout: number) {
  const net = payout - STAKE_CENTS;
  return net > 0 ? "Положительный итог раунда." : net === 0 ? "Стоимость раунда возвращена." : payout > 0 ? "Частичный возврат. Выплата меньше ставки." : "Раунд завершён без выплаты.";
}
const noteFor = (f: Fixture) => (f.lines.length ? "Оплачено линий: " + f.lines.length : "Доводка повышает заряд WILD");
const finalMults = (f: Fixture) => { const m = [1, 1, 1, 1, 1]; for (const n of f.nudges) m[n[0]] = n[3]; return m; };
const towerTop = (c: number[]) => { const k = c.filter((x) => x === 6).length; if (!k) return null; if (k === 3) return 0; return c[0] === 6 ? k - 3 : 3 - k; };
const layoutFor = (w: number, h: number) => (w >= 900 && h >= 600 ? "full" : w > h && h < 600 ? "landscape" : "portrait");

function initialView(): View {
  const f = FIXTURES.initial;
  return { cells: [...f.rows], mults: [1, 1, 1, 1, 1], lines: [], balance: START_BALANCE_CENTS, payout: 0, net: null, bonus: null, note: "20 линий активны", status: "Демо-баланс до раунда. Выбери сценарий.", phase: "idle" };
}
function settledView(f: Fixture): View {
  const p = payoutCents(f);
  return { cells: [...f.rows], mults: finalMults(f), lines: [...f.lines], balance: START_BALANCE_CENTS - STAKE_CENTS + p, payout: p, net: p - STAKE_CENTS, bonus: null, note: noteFor(f), status: resultText(p), phase: "result" };
}
function bonusEnterView(): View { const f = FIXTURES.bonus; return { ...settledView(f), balance: START_BALANCE_CENTS - STAKE_CENTS, net: null, bonus: 8, status: OVERDRIVE, phase: "bonus", note: "Доводка повышает заряд WILD" }; }
function bonusFreeView(): View { const f = FIXTURES.partial; return { ...settledView(f), balance: START_BALANCE_CENTS - STAKE_CENTS, net: null, bonus: 7, status: OVERDRIVE, phase: "bonus" }; }
function bonusEndView(): View { const v = settledView(FIXTURES.partial); return { ...v, status: "Перегрузка завершена. " + resultText(v.payout) }; }

export class Scene {
  readonly root: HTMLElement;
  private comp: Companion;
  private ac = new AbortController();
  private timers = new Set<number>();
  private rafs = new Set<number>();
  private anims = new Set<Animation>();
  private ro: ResizeObserver;
  private view: View = initialView();
  private current: ScenarioId | null = null;
  private hero: HeroId = "lyra";
  private skyRaf = 0; private stars: { x: number; y: number; z: number }[] = []; private ship = -1;
  private panelVisible = true;
  settings: Settings = { reduced: false, fast: false };
  running = false; waiting = false;

  constructor(private host: HTMLElement, readonly variant: Variant, private hooks: { audible: () => boolean; onSpin: () => void; onSide: (s: Side) => void; onCrew: () => void; onSkip: () => void; onChange: () => void }) {
    this.root = document.createElement("section");
    this.root.className = "gn" + (variant === "new" ? " nx" : "");
    this.root.tabIndex = 0;
    this.root.setAttribute("aria-label", "Star Spin, " + (variant === "new" ? "новые эффекты" : "текущий экран"));
    this.root.innerHTML = this.template();
    if (variant === "new") this.fitInstruments();
    const console = document.createElement("footer");
    console.className = "gn-console";
    console.append(this.el("money"), this.el("controls"), this.el("status"));
    this.root.append(console);
    this.root.querySelector(".gn-machine-label")!.prepend(this.root.querySelector(".gn-bonus-meter")!);
    host.append(this.root);
    const portrait = this.root.querySelector<HTMLElement>("[data-ss-portrait]")!;
    this.comp = new Companion(portrait.parentElement!);
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.root); this.ro.observe(this.el("stage"));
    this.root.addEventListener("click", this.onClick);
    this.applyView(this.view);
    this.fit();
    if (variant === "new") { this.seedStars(); this.startSky(); }
  }

  private template() {
    const nx = this.variant === "new";
    const reels = Array.from({ length: 5 }, (_, n) => `<div class="gn-reel" data-reel="${n}" role="img"><div class="gn-track"></div><div class="gn-roll" aria-hidden="true">${Array.from({ length: 12 }, (_, z) => `<div class="gn-cell"><img src="${symbolSrc(z % 6)}" alt="" draggable="false"></div>`).join("")}</div><span class="gn-multiplier" hidden></span>${nx ? '<span class="nx-stopline" aria-hidden="true"></span><span class="nx-wave" aria-hidden="true"></span>' : ""}</div>`).join("");
    const segs = nx ? `<div class="nx-segs" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i data-seg="${i}"></i>`).join("")}</div><div class="nx-fx" data-gn="fx" aria-hidden="true"></div><div class="nx-route" data-gn="route" hidden><span data-gn="route-label"></span><i><b data-gn="route-bar"></b></i></div>` : "";
    return `${nx ? '<div class="nx-tint" aria-hidden="true"></div><canvas class="nx-sky" aria-hidden="true"></canvas><div class="nx-float" data-gn="float" aria-hidden="true" hidden></div>' : ""}<header class="gn-header"><div class="gn-brand">R<span>ROYAL<br>SPACE DIVISION</span></div><div class="gn-title"><small>ВЫБЕРИ СВОЮ СТОРОНУ</small><h2>Star Spin</h2></div><nav class="gn-tools" aria-label="Настройки игры"><button data-gn="crew" class="ss-open" aria-label="Героини и выбор стороны">✦</button><button data-gn="sound" aria-label="Общий звук" aria-pressed="false">♪</button><button data-gn="rules" aria-label="Правила" aria-disabled="true" title="Недоступно на стенде">?</button><button data-gn="settings" aria-label="Настройки" aria-disabled="true" title="Недоступно на стенде">⚙</button></nav></header>
    <main class="gn-world"><div class="gn-machine"><div class="gn-machine-label"><span>REACTOR CONTROL</span><b>5 × 3 · 20 ЛИНИЙ</b></div><div class="gn-stage" data-gn="stage"><div class="gn-board" data-gn="board" role="group" aria-label="Игровое поле">${reels}<svg class="gn-payline" data-gn="payline" viewBox="0 0 500 300" aria-hidden="true"></svg>${segs}<div class="gn-bonus-overlay" data-gn="bonus-overlay" hidden><strong>ПЕРЕГРУЗКА РЕАКТОРА</strong><span>8 БЕСПЛАТНЫХ ВРАЩЕНИЙ</span></div></div></div><div class="gn-field-caption"><span data-gn="field-note"></span><span>RTP 96,14%</span></div></div>
    <aside class="gn-telemetry"><div class="ss-companion"><div class="ss-neutral" aria-hidden="true" hidden>✦<span>LIGHT / DARK</span></div><img data-ss-portrait alt=""></div><div class="ss-identity"><small data-ss-label></small><strong data-ss-name></strong></div><div class="ss-side-picker"><button data-ss="side:light">Свет</button><button data-ss="side:dark">Тьма</button><button data-ss="open" aria-label="Открыть героинь">✦</button></div><div class="gn-bonus-meter"><span>БЕСПЛАТНЫХ ВРАЩЕНИЙ</span><strong data-gn="remaining">0</strong><div data-gn="bonus-dots">${Array(8).fill("<i></i>").join("")}</div></div></aside></main>
    <section class="gn-money" data-gn="money" aria-label="Баланс и итог раунда"><div><span>Баланс · USDT</span><strong data-gn="balance">…</strong></div><div><span>Ставка раунда</span><strong data-gn="cost">0,10</strong></div><div><span>Выплата раунда</span><strong data-gn="payout">0,00</strong></div><div><span>Чистый итог</span><strong data-gn="net">…</strong></div></section>
    <div class="gn-controls" data-gn="controls"><label class="gn-stake"><span>Ставка · USDT</span><select data-gn="stake" aria-label="Общая ставка" disabled><option>0,10</option></select></label><button data-gn="spin" class="gn-spin"><span aria-hidden="true">⟳</span><b>Вращать</b><small>0,10 USDT</small></button><button data-gn="auto" aria-pressed="false" disabled title="Автокрутка на стенде не запускается">Авто</button><div class="gn-playback" data-gn="playback"><button data-gn="skip" hidden>Показать итог</button></div></div>
    <p class="gn-status" data-gn="status" role="status" aria-live="polite"></p>`;
  }

  private el<T extends Element = HTMLElement>(k: string) { return this.root.querySelector(`[data-gn="${k}"]`) as unknown as T; }
  private fitInstruments() {
    const cradle = document.createElement("div");
    cradle.className = "nx-cradle";
    const board = this.el("board");
    board.replaceWith(cradle);
    cradle.append(board);
    const makeDecoration = (host: Element, className: string, children: string) => {
      const node = document.createElement("span");
      node.className = className;
      node.setAttribute("aria-hidden", "true");
      node.innerHTML = children;
      host.prepend(node);
    };
    makeDecoration(cradle, "nx-rails", "<i></i><i></i><i></i><i></i>");
    const portrait = this.root.querySelector<HTMLImageElement>("[data-ss-portrait]")!;
    const pose = document.createElement("div");
    pose.className = "nx-pose";
    portrait.replaceWith(pose);
    pose.append(portrait);
    makeDecoration(pose, "nx-contact-shadows", "<i></i><i></i>");
    makeDecoration(pose, "nx-deck-support", "<i></i><b></b>");
    makeDecoration(pose, "nx-cast-shadow", "");
    makeDecoration(pose, "nx-armillary", "<i></i><b></b>");
    makeDecoration(this.root.querySelector(".gn-title")!, "nx-heading-star", "");
    this.root.querySelector(".gn-title h2")!.innerHTML = "Star <em>Spin</em>";
    const dial = this.el("spin").querySelector("span")!;
    dial.className = "nx-ignition";
    dial.replaceChildren();
    makeDecoration(dial, "nx-iris", "");
    makeDecoration(this.root, "nx-atmosphere", "<i></i><b></b>");
    makeDecoration(this.root, "nx-hangar", "");
  }
  private reel(z: number) { return this.root.querySelector(`[data-reel="${z}"]`) as HTMLElement; }
  private get nx() { return this.variant === "new"; }
  private get motion() { return !this.settings.reduced; }
  private t(ms: number, fast: number) { return this.settings.fast ? fast : ms; }

  private onClick = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest("button"); if (!b || b.getAttribute("aria-disabled") === "true") return;
    const gn = b.dataset["gn"]; const ss = b.dataset["ss"];
    if (gn === "spin") this.hooks.onSpin();
    else if (gn === "skip") this.hooks.onSkip();
    else if (gn === "sound") { sharedAudio.setEnabled(!sharedAudio.enabled); this.hooks.onChange(); }
    else if (gn === "crew" || ss === "open") this.hooks.onCrew();
    else if (ss?.startsWith("side:")) this.hooks.onSide(ss.slice(5) as Side);
  };

  fit() {
    const width = this.root.clientWidth, height = this.root.clientHeight;
    if (!width || !height) return;
    this.root.dataset["layout"] = layoutFor(width, height);
    this.root.dataset["portraitCompact"] = String(height < 620);
    const st = this.el("stage"), b = this.el("board");
    const margin = this.nx ? 24 : 16;
    const w = Math.max(1, Math.floor(Math.min(st.clientWidth - margin, ((st.clientHeight - margin) * 5) / 3, 1000)));
    b.style.width = w + "px"; b.style.height = (w * 3) / 5 + "px"; b.style.setProperty("--cell", w / 5 + "px");
    if (this.nx) {
      this.alignDeck(width);
      this.sizeSky();
    }
  }

  private alignDeck(width: number) {
    const pose = this.root.querySelector<HTMLElement>(".nx-pose")!;
    if (!pose.offsetHeight) return;
    const game = this.root.getBoundingClientRect();
    const art = pose.getBoundingClientRect();
    const horizon = (art.top - game.top + art.height * .72) * width / game.width;
    // Keep the sky in its source proportions. Both slices meet on row 588 of the hangar.
    const panorama = Math.max(width, horizon * 1672 / 588);
    this.root.style.setProperty("--deck-horizon", horizon + "px");
    this.root.style.setProperty("--panorama-width", panorama + "px");
    this.root.style.setProperty("--sky-offset", (horizon - panorama * 588 / 1672) + "px");
  }

  // ---------- героиня и сторона ----------
  setHero(id: HeroId) {
    this.hero = id;
    const h = HEROES.find((x) => x.id === id)!;
    this.root.dataset["side"] = h.side; this.root.dataset["character"] = id;
    const img = this.root.querySelector("[data-ss-portrait]") as HTMLImageElement;
    img.src = assetUrl(`characters/${id}.webp`); img.alt = h.name;
    if (this.nx) img.parentElement!.style.setProperty("--figure-image", `url("${img.src}")`);
    (this.root.querySelector("[data-ss-name]") as HTMLElement).textContent = h.name;
    (this.root.querySelector("[data-ss-label]") as HTMLElement).textContent = h.side === "light" ? "Светлая сторона · Джедаи" : "Тёмная сторона · Ситхи";
    this.root.querySelectorAll<HTMLElement>('[data-ss^="side:"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset["ss"] === "side:" + h.side)));
    void this.comp.load(id, this.motion && this.panelVisible && !document.hidden).then(() => this.comp.react("select"));
  }

  setPanelVisible(visible: boolean) {
    if (visible === this.panelVisible) return;
    this.panelVisible = visible;
    void this.comp.load(this.hero, visible && this.motion && !document.hidden);
    if (this.nx) this.startSky();
  }

  setSettings(s: Settings) {
    const changedReduced = s.reduced !== this.settings.reduced;
    if (this.running) this.finish();
    this.settings = s;
    this.root.classList.toggle("nx-reduced", s.reduced);
    this.root.classList.toggle("nx-fast", s.fast);
    if (changedReduced) { this.setHero(this.hero); if (this.nx) this.startSky(); }
  }
  syncSound() { this.el("sound").setAttribute("aria-pressed", String(sharedAudio.enabled)); }

  // ---------- отрисовка ----------
  private relic(symbol: number) {
    if (symbol < 0 || symbol === 6) return "";
    const url = symbolSrc(symbol);
    const image = `<img src="${url}" alt="" draggable="false">`;
    if (!this.nx) return image;
    return `<span class="nx-relic" style="--relic:url('${url}')">${image}<i aria-hidden="true"></i></span>`;
  }

  private renderColumn(z: number, cells: number[], mult: number) {
    const reel = this.reel(z), track = reel.querySelector(".gn-track") as HTMLElement;
    const T = towerTop(cells);
    track.innerHTML = [-1, 0, 1, 2, 3].map((r) => { const s = r >= 0 && r < 3 ? cells[r]! : -1; return `<div class="gn-cell" data-row="${r}" data-symbol="${s}">${this.relic(s)}</div>`; }).join("")
      + (T !== null ? `<img class="gn-tower" src="${symbolSrc(6)}" alt="" draggable="false" style="top:calc(var(--cell) * ${1 + T})">` : "");
    const m = reel.querySelector(".gn-multiplier") as HTMLElement;
    m.hidden = !cells.includes(6); m.textContent = "×" + mult;
    reel.setAttribute("aria-label", `Барабан ${z + 1}: ${cells.map((c) => SYMBOL_NAMES[c]).join(", ")}${m.hidden ? "" : " ×" + mult}`);
    reel.classList.toggle("nx-live", this.nx && cells.includes(6));
  }
  private clearLines() {
    this.el("payline").replaceChildren();
    this.root.querySelectorAll(".gn-paid,.nx-hit").forEach((c) => c.classList.remove("gn-paid", "nx-hit"));
    this.el("board").classList.remove("nx-dimmed");
  }
  private pts(l: LineWin) { return LINES[l[0] - 1]!.slice(0, l[1]).map((r, i) => [i * 100 + 50, r * 100 + 50] as const); }
  private markCells(l: LineWin, cls: string) { this.pts(l).forEach((_, i) => this.root.querySelector(`[data-reel="${i}"] [data-row="${LINES[l[0] - 1]![i]}"]`)?.classList.add(cls)); }
  private paintStatic(lines: LineWin[]) {
    this.clearLines(); if (!lines.length) return;
    const svg = this.el("payline");
    const shown = this.nx ? lines : [[...lines].sort((a, b) => b[2] - a[2])[0]!];
    svg.innerHTML = shown.map((l) => `<polyline${this.nx && shown.length > 1 ? ' class="nx-rest"' : ""} points="${this.pts(l).map((p) => p.join(",")).join(" ")}"/>`).join("");
    shown.forEach((l) => this.markCells(l, "gn-paid"));
  }
  private setMoney(k: "balance" | "payout" | "net", v: number | null) { this.el(k).textContent = v === null ? "…" : (k === "net" && v > 0 ? "+" : "") + formatMoney(v); }
  private setBonus(rem: number | null) {
    this.root.classList.toggle("gn-bonus", rem !== null);
    this.el("remaining").textContent = String(rem ?? 0);
    this.root.querySelectorAll('[data-gn="bonus-dots"] i').forEach((d, i) => d.classList.toggle("on", rem !== null && i < rem));
    const spin = this.el("spin");
    (spin.querySelector("b") as HTMLElement).textContent = rem !== null ? "Бесплатно" : "Вращать";
    (spin.querySelector("small") as HTMLElement).textContent = rem !== null ? "Осталось: " + rem : "0,10 USDT";
  }
  private setStatus(s: string) { this.el("status").textContent = s; }
  private setBase(m: Mode) { this.comp.setBase(m); }
  private applyView(v: View) {
    this.view = v;
    v.cells.length && [0, 1, 2, 3, 4].forEach((z) => this.renderColumn(z, column(v.cells, z), v.mults[z]!));
    this.root.querySelectorAll(".gn-spinning,.gn-charging").forEach((r) => r.classList.remove("gn-spinning", "gn-charging"));
    this.paintStatic(v.lines);
    this.setMoney("balance", v.balance); this.setMoney("payout", v.payout); this.setMoney("net", v.net);
    this.setBonus(v.bonus); this.setStatus(v.status);
    this.el("field-note").textContent = v.note;
    this.root.dataset["phase"] = v.phase;
    this.setBase(v.bonus !== null ? "bonus_idle" : "idle");
    (this.el("bonus-overlay") as HTMLElement).hidden = true;
    if (this.nx) { this.el("board").classList.toggle("nx-amber-on", v.bonus !== null); }
  }

  // ---------- управление временем ----------
  private wait(ms: number) {
    const s = this.ac.signal;
    return new Promise<void>((res, rej) => {
      if (s.aborted) return rej(ABORT);
      const id = window.setTimeout(() => { this.timers.delete(id); res(); }, ms);
      this.timers.add(id);
      s.addEventListener("abort", () => { clearTimeout(id); rej(ABORT); }, { once: true });
    });
  }
  private anim(el: Element, kf: Keyframe[], o: KeyframeAnimationOptions, awaitIt = true) {
    if (!this.motion || this.ac.signal.aborted) return Promise.resolve();
    const signal = this.ac.signal;
    const a = el.animate(kf, { easing: "cubic-bezier(.2,.75,.3,1)", ...o });
    this.anims.add(a);
    const p = a.finished.then(() => { this.anims.delete(a); }, () => { this.anims.delete(a); });
    return awaitIt ? p.then(() => { if (signal.aborted) throw ABORT; }) : Promise.resolve();
  }
  private frame(ms: number, step: (k: number) => void) {
    const s = this.ac.signal;
    if (!this.motion) { step(1); return Promise.resolve(); }
    return new Promise<void>((res, rej) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        this.rafs.delete(id);
        if (s.aborted) return rej(ABORT);
        const k = Math.min(1, (now - t0) / ms); step(k);
        if (k < 1) { id = requestAnimationFrame(tick); this.rafs.add(id); } else res();
      };
      let id = requestAnimationFrame(tick); this.rafs.add(id);
      s.addEventListener("abort", () => { cancelAnimationFrame(id); rej(ABORT); }, { once: true });
    });
  }
  private count(k: "balance" | "payout", from: number, to: number, ms: number) {
    if (!this.nx) { this.setMoney(k, to); return Promise.resolve(); }
    return this.frame(ms, (p) => this.setMoney(k, Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)))));
  }
  private sound(c: "stop" | "nudge" | "positive") { if (this.hooks.audible()) sharedAudio.play(c); }

  cancel() {
    this.ac.abort(); this.ac = new AbortController(); this.root.classList.remove("nx-static-glow");
    delete this.root.dataset.accent;
    this.timers.forEach(clearTimeout); this.timers.clear();
    this.rafs.forEach(cancelAnimationFrame); this.rafs.clear();
    this.anims.forEach((a) => a.cancel()); this.anims.clear();
    for (const animation of this.root.getAnimations({subtree:true})) {
      if (!(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)) animation.cancel();
    }
    if (this.hooks.audible()) sharedAudio.cancel();
    this.comp.cancelReaction();
    if (this.nx) {
      this.el("fx").replaceChildren();
      (this.el("route") as HTMLElement).hidden = true;
      (this.el("float") as HTMLElement).hidden = true;
      this.root.querySelectorAll(".nx-dust").forEach((d) => d.remove());
      this.root.querySelectorAll(".nx-wait,.nx-glow,.nx-quiet,.nx-neutral").forEach((e) => e.classList.remove("nx-wait", "nx-glow", "nx-quiet", "nx-neutral"));
    }
    this.el("controls").classList.remove("gn-action-overlay");
    (this.el("skip") as HTMLElement).hidden = true;
    (this.el("spin") as HTMLButtonElement).disabled = false;
    this.running = false; this.waiting = false;
  }
  /** Моментально завершает показ до точного готового состояния. */
  finish() {
    if (this.waiting) { this.cancel(); this.applyView(this.preWait); this.hooks.onChange(); return; }
    this.cancel();
    if (this.current) this.applyView(this.finalView(this.current));
    this.hooks.onChange();
  }
  private preWait: View = initialView();

  private finalView(id: ScenarioId): View {
    const fk = SPIN_FIXTURE[id];
    if (fk) return settledView(FIXTURES[fk]);
    if (id === "bonusEnter") return bonusEnterView();
    if (id === "bonusFree") return bonusFreeView();
    if (id === "bonusEnd") return bonusEndView();
    return this.view;
  }

  async run(id: ScenarioId) {
    this.cancel();
    this.current = id;
    if (["ship", "glow", "palette"].includes(id)) { this.applyView(this.view); return this.atmosphere(id); }
    const final = this.finalView(id);
    const signal = this.ac.signal;
    if (!this.motion && id !== "wait") {
      this.applyView(final);
      this.root.dataset.accent = id; this.hooks.onChange(); return;
    }
    this.running = true; this.hooks.onChange();
    try {
      const fk = SPIN_FIXTURE[id];
      if (fk) { this.applyView(initialView()); await this.spin(FIXTURES[fk], true); await this.outcome(FIXTURES[fk]); }
      else if (id === "bonusEnter") { this.applyView(initialView()); await this.spin(FIXTURES.bonus, true); await this.bonusEnter(); }
      else if (id === "bonusFree") { this.applyView(bonusEnterView()); await this.spin(FIXTURES.partial, false); await this.freeDone(); }
      else if (id === "bonusEnd") { this.applyView({ ...bonusFreeView(), bonus: 0, status: OVERDRIVE }); await this.wait(this.t(450, 150)); await this.bonusEnd(); }
      else if (id === "wait") { this.preWait = initialView(); this.applyView(this.preWait); await this.waitOnly(); return; }
      if (signal.aborted) return;
      this.cancel(); this.applyView(final);
    } catch (e) { if (e !== ABORT) throw e; }
    if (signal.aborted) return;
    this.running = false; this.hooks.onChange();
  }

  // ---------- вращение ----------
  private startSpin(debit: boolean) {
    this.clearLines();
    this.root.dataset["phase"] = "request"; this.setBase("spin_wait");
    this.setStatus("Вращение…"); this.setMoney("net", null);
    const spin = this.el("spin") as HTMLButtonElement; spin.disabled = true;
    if (this.nx) spin.classList.add("nx-wait");
    const from = this.view.balance, to = debit ? from - STAKE_CENTS : from;
    this.view = { ...this.view, balance: to };
    if (!debit) { /* в бонусе без новой ставки */ } else if (this.nx) void this.count("balance", from, to, 600).catch(() => {}); else this.setMoney("balance", to);
    if (this.view.bonus === null) this.setMoney("payout", 0);
  }
  private async waitOnly() {
    this.running = true; this.waiting = true; this.hooks.onChange();
    this.startSpin(false);
    this.setStatus("Ожидание результата…");
    if (this.motion) this.root.querySelectorAll("[data-reel]").forEach((r) => r.classList.add("gn-spinning"));
  }
  private async spin(f: Fixture, debit: boolean) {
    this.startSpin(debit);
    const reels = [0, 1, 2, 3, 4].map((z) => this.reel(z));
    if (this.nx) {
      await Promise.all(reels.map((r, z) => { const c = this.el("board").clientWidth / 5; return this.anim(r.querySelector(".gn-track")!, [{ transform: `translateY(${-c}px)` }, { transform: `translateY(${-c - c * 0.16}px)` }], { duration: this.t(200, 90), delay: z * 30, easing: "ease-out" }); }));
    }
    reels.forEach((r) => r.classList.add("gn-spinning"));
    await this.wait(this.t(this.nx ? 700 : 600, 220));
    this.el("controls").classList.add("gn-action-overlay"); this.el("skip").hidden = false;
    this.root.dataset["phase"] = "reveal"; this.hooks.onChange();
    const gap = this.t(260, 110);
    for (let z = 0; z < 5; z++) {
      const r = reels[z]!;
      r.classList.remove("gn-spinning");
      this.renderColumn(z, column(f.pre, z), 1);
      if (this.nx) {
        const c = this.el("board").clientWidth / 5, track = r.querySelector(".gn-track")!;
        void this.anim(track, [{ transform: `translateY(${-c + c * 0.09}px)` }, { transform: `translateY(${-c - c * 0.03}px)`, offset: 0.55 }, { transform: `translateY(${-c}px)` }], { duration: this.t(300, 140) }, false);
        void this.anim(r.querySelector(".nx-stopline")!, [{ opacity: 0, transform: "scaleX(.3)" }, { opacity: 1, transform: "scaleX(1)", offset: 0.3 }, { opacity: 0, transform: "scaleX(1)" }], { duration: this.t(520, 260) }, false);
        void this.anim(this.root.querySelector(`[data-seg="${z}"]`)!, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: this.t(560, 280) }, false);
        this.sound("stop");
        await this.wait(gap); // фиксированное расписание: порталы на него не влияют
      } else {
        this.sound("stop");
        await this.anim(r, [{ filter: "brightness(1.3)" }, { filter: "brightness(1)" }], { duration: this.t(130, 60) });
        await this.wait(this.t(35, 15));
      }
    }
    const nudges = [...f.nudges].sort((a, b) => a[0] - b[0]);
    for (const [z, dir, path, fm] of nudges) {
      const r = reels[z]!;
      for (let T = 1; T < path.length; T++) {
        this.root.dataset["phase"] = "nudge";
        const c = this.el("board").clientWidth / 5, track = r.querySelector(".gn-track")!;
        const to = -c - dir * c;
        this.comp.react("wild_align");
        if (this.nx) {
          this.sound("nudge");
          void this.anim(r.querySelector(".nx-wave")!, [{ transform: "translateY(100%)", opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { transform: "translateY(-100%)", opacity: 0 }], { duration: this.t(520, 240), easing: "ease-in-out" }, false);
          await this.anim(track, [{ transform: `translateY(${-c}px)` }, { transform: `translateY(${to}px)` }], { duration: this.t(340, 140) });
          this.renderColumn(z, path[T]!, fm - (path.length - 1 - T));
          await this.anim(r.querySelector(".gn-multiplier")!, [{ transform: "scale(1.35)", boxShadow: "0 0 0 0 var(--cyan)" }, { transform: "scale(1)", boxShadow: "0 0 0 10px transparent" }], { duration: this.t(420, 180) });
          await this.wait(this.t(120, 40));
        } else {
          this.sound("nudge");
          r.classList.add("gn-charging");
          await this.anim(track, [{ transform: `translateY(${-c}px)` }, { transform: `translateY(${to}px)` }], { duration: this.t(230, 90) });
          this.renderColumn(z, path[T]!, fm - (path.length - 1 - T));
          r.classList.remove("gn-charging");
        }
      }
    }
    reels.forEach((r) => r.classList.remove("gn-spinning"));
    this.el("spin").classList.remove("nx-wait");
    this.el("field-note").textContent = noteFor(f);
    if (this.nx) await this.routes(f.lines); else this.paintStatic(f.lines);
  }

  private async routes(lines: LineWin[]) {
    if (!lines.length) return;
    const svg = this.el("payline"), route = this.el("route") as HTMLElement, label = this.el("route-label"), bar = this.el("route-bar");
    const board = this.el("board");
    route.hidden = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!; const p = this.pts(l);
      this.root.querySelectorAll(".nx-hit").forEach((c) => c.classList.remove("nx-hit"));
      board.classList.add("nx-dimmed");
      label.textContent = `Маршрут ${l[0]} · ${i + 1} из ${lines.length}`;
      this.setStatus(`Оплаченная линия № ${l[0]}. Показ ${i + 1} из ${lines.length}.`);
      bar.style.width = ((i + 1) / lines.length) * 100 + "%";
      const pl = `<polyline class="nx-beam" points="${p.map((q) => q.join(",")).join(" ")}"/><circle class="nx-dot" r="7" cx="${p[0]![0]}" cy="${p[0]![1]}"/>`;
      svg.innerHTML = pl;
      const poly = svg.querySelector("polyline")!, dot = svg.querySelector("circle")!;
      const segLen = p.slice(1).map((q, k) => Math.hypot(q[0] - p[k]![0], q[1] - p[k]![1]));
      const total = segLen.reduce((a, b) => a + b, 0);
      poly.style.strokeDasharray = String(total);
      let lit = -1;
      await this.frame(this.t(260 * p.length, 110 * p.length), (k) => {
        const d = total * k; poly.style.strokeDashoffset = String(total - d);
        let acc = 0, s = 0; while (s < segLen.length && acc + segLen[s]! < d) { acc += segLen[s]!; s++; }
        const a = p[Math.min(s, p.length - 1)]!, b = p[Math.min(s + 1, p.length - 1)]!; const f = segLen[s] ? (d - acc) / segLen[s]! : 0;
        dot.setAttribute("cx", String(a[0] + (b[0] - a[0]) * f)); dot.setAttribute("cy", String(a[1] + (b[1] - a[1]) * f));
        const col = Math.min(p.length - 1, Math.floor((a[0] + (b[0] - a[0]) * f + 1) / 100));
        while (lit < col) { lit++; this.root.querySelector(`[data-reel="${lit}"] [data-row="${LINES[l[0] - 1]![lit]}"]`)?.classList.add("nx-hit"); }
      });
      await this.wait(this.t(380, 120));
    }
    route.hidden = true;
    this.paintStatic(lines);
  }

  // ---------- итог ----------
  private async outcome(f: Fixture) {
    const pay = payoutCents(f), cls = classify(pay);
    const final = settledView(f);
    this.root.dataset["phase"] = "result";
    if (pay > STAKE_CENTS) this.comp.react("round_win");
    if (pay === STAKE_CENTS && this.hooks.audible()) sharedAudio.play("even");
    if (!this.nx) { if (pay > STAKE_CENTS) this.sound("positive"); this.setMoney("payout", pay); this.setMoney("net", final.net); this.setMoney("balance", final.balance); this.setStatus(final.status); return; }
    const board = this.el("board");
    if (cls === "none" || cls === "partial") {
      board.classList.add("nx-quiet");
      await this.count("payout", 0, pay, this.t(500, 200));
    } else if (cls === "return") {
      board.classList.add("nx-neutral");
      this.setMoney("payout", pay);
      await this.wait(this.t(450, 160));
    } else {
      this.root.querySelector(".ss-companion")!.classList.add("nx-glow");
      if (cls === "large") void this.hyperjump();
      this.sound("positive");
      await this.flyToPayout(pay, cls === "large");
    }
    this.setMoney("net", final.net); this.setStatus(final.status);
    await this.count("balance", this.view.balance, final.balance, this.t(700, 250));
    this.view = final;
    await this.wait(this.t(600, 200));
  }
  private async flyToPayout(pay: number, large: boolean) {
    const fl = this.el("float") as HTMLElement, target = this.el("payout");
    const root = this.root.getBoundingClientRect(), b = this.el("board").getBoundingClientRect(), t = target.getBoundingClientRect();
    const scale = root.width / this.root.offsetWidth || 1;
    fl.textContent = "+" + formatMoney(pay); fl.hidden = false;
    const x0 = (b.left + b.width / 2 - root.left) / scale, y0 = (b.top + b.height * 0.42 - root.top) / scale;
    const x1 = (t.left + t.width / 2 - root.left) / scale, y1 = (t.top + t.height / 2 - root.top) / scale;
    fl.style.left = x0 + "px"; fl.style.top = y0 + "px"; fl.classList.toggle("nx-big", large);
    await this.anim(fl, [{ opacity: 0, transform: "translate(-50%,-50%) scale(.7)" }, { opacity: 1, transform: "translate(-50%,-50%) scale(1)" }], { duration: this.t(380, 160), fill: "forwards" });
    await this.wait(this.t(large ? 700 : 350, 120));
    void this.count("payout", 0, pay, this.t(800, 300)).catch(() => {});
    await this.anim(fl, [{ opacity: 1, transform: "translate(-50%,-50%) scale(1)" }, { opacity: 0.2, transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.45)` }], { duration: this.t(800, 300), easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" });
    fl.hidden = true;
    this.setMoney("payout", pay);
    for (let i = 0; i < 12; i++) {
      const d = document.createElement("i"); d.className = "nx-dust";
      d.style.left = (b.left - root.left + b.width * (.1 + .8 * i / 11)) / scale + "px";
      d.style.top = (b.top - root.top + b.height * (.2 + .6 * ((i * 7) % 12) / 11)) / scale + "px";
      this.root.append(d);
      const a = (i / 12) * Math.PI * 2, r = 26 + (i % 3) * 14;
      void this.anim(d, [{ opacity: 1, transform: "translate(-50%,-50%) scale(1)" }, { opacity: 0, transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(.3)` }], { duration: this.t(1000, 400), easing: "ease-out" }).then(() => d.remove()).catch(() => d.remove());
    }
    await this.wait(this.t(400, 150));
  }
  private async hyperjump() {
    const fx = this.el("fx"); const r = document.createElement("div"); r.className = "nx-rays"; fx.append(r);
    await this.anim(r, [{ opacity: 0, transform: "scale(.35)" }, { opacity: 0.85, offset: 0.35 }, { opacity: 0, transform: "scale(1.7)" }], { duration: this.t(1500, 600), easing: "ease-out" }).catch(() => {});
    r.remove();
  }

  // ---------- бонус ----------
  private holo(title: string, sub: string) {
    const h = document.createElement("div"); h.className = "nx-holo"; h.innerHTML = `<strong>${title}</strong><span>${sub}</span>`;
    this.el("fx").append(h); return h;
  }
  private async bonusEnter() {
    this.root.dataset["phase"] = "bonus";
    this.comp.react("bonus_enter");
    if (this.hooks.audible()) sharedAudio.play("bonus");
    if (!this.nx) {
      this.setBonus(8); this.setStatus(OVERDRIVE);
      (this.el("bonus-overlay") as HTMLElement).hidden = false;
      await this.wait(this.t(650, 180));
      (this.el("bonus-overlay") as HTMLElement).hidden = true;
      return;
    }
    const fx = this.el("fx"), cells = FIXTURES.bonus.rows;
    for (const portal of this.root.querySelectorAll('.gn-cell[data-symbol="7"] .nx-relic')) {
      void this.anim(portal, [{ transform: "rotate(0deg)" }, { transform: "rotate(200deg)" }], { duration: this.t(1120, 440) }, false);
    }
    const waves = cells.map((s, i) => (s === 7 ? i : -1)).filter((i) => i >= 0).map((i) => {
      const w = document.createElement("i"); w.className = "nx-ring";
      w.style.left = ((i % 5) * 20 + 10) + "%"; w.style.top = (Math.floor(i / 5) * 33.33 + 16.67) + "%"; fx.append(w);
      const dx = fx.clientWidth * (0.5 - ((i % 5) + 0.5) / 5);
      const dy = fx.clientHeight * (0.5 - (Math.floor(i / 5) + 0.5) / 3);
      return this.anim(w, [{ opacity: 0.75, transform: "translate(-50%,-50%) scale(.6)" }, { opacity: 0, transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.75)` }], { duration: this.t(1100, 450), easing: "ease-in-out" });
    });
    await Promise.all(waves);
    const h = this.holo("ПЕРЕГРУЗКА РЕАКТОРА", "8 БЕСПЛАТНЫХ ВРАЩЕНИЙ");
    void this.anim(h, [{ opacity: 0, transform: "translate(-50%,-50%) scaleY(.6)" }, { opacity: 1, transform: "translate(-50%,-50%) scaleY(1)" }], { duration: this.t(420, 160), fill: "forwards" }, false);
    this.root.classList.add("gn-bonus"); this.setStatus(OVERDRIVE); this.el("board").classList.add("nx-amber-on");
    void this.anim(this.el("board"), [{ filter: "brightness(1)" }, { filter: "brightness(1.18)" }, { filter: "brightness(1)" }], { duration: this.t(1200, 400) }, false);
    const dots = [...this.root.querySelectorAll('[data-gn="bonus-dots"] i')];
    dots.forEach((d) => d.classList.remove("on"));
    for (let i = 0; i < 8; i++) { dots[i]!.classList.add("on"); this.el("remaining").textContent = String(i + 1); await this.wait(this.t(130, 50)); }
    this.setBonus(8);
    await this.wait(this.t(900, 250));
    await this.anim(h, [{ opacity: 1 }, { opacity: 0 }], { duration: this.t(500, 200), fill: "forwards" });
    h.remove();
  }
  private async freeDone() {
    const rem = this.el("remaining");
    if (this.nx) {
      await this.anim(rem, [{ transform: "rotateX(0)" }, { transform: "rotateX(90deg)" }], { duration: this.t(200, 90) });
      this.setBonus(7);
      await this.anim(rem, [{ transform: "rotateX(-90deg)" }, { transform: "rotateX(0)" }], { duration: this.t(200, 90) });
      await this.count("payout", 0, payoutCents(FIXTURES.partial), this.t(500, 200));
    } else { this.setBonus(7); this.setMoney("payout", payoutCents(FIXTURES.partial)); }
    this.setStatus(OVERDRIVE);
    await this.wait(this.t(500, 150));
  }
  private async bonusEnd() {
    const v = bonusEndView();
    if (!this.nx) { this.setBonus(null); this.root.dataset["phase"] = "result"; this.applyView(v); return; }
    const h = this.holo("Перегрузка завершена", "Итог раунда " + formatMoney(v.payout) + " USDT");
    await this.anim(h, [{ opacity: 0, transform: "translate(-50%,-50%) scaleY(.6)" }, { opacity: 1, transform: "translate(-50%,-50%) scaleY(1)" }], { duration: this.t(420, 160), fill: "forwards" });
    this.setBonus(null); this.el("board").classList.remove("nx-amber-on"); this.el("board").classList.add("nx-quiet");
    this.setMoney("net", v.net); this.setStatus(v.status);
    await this.count("balance", this.view.balance, v.balance, this.t(700, 250));
    await this.wait(this.t(900, 250));
    await this.anim(h, [{ opacity: 1 }, { opacity: 0 }], { duration: this.t(500, 200), fill: "forwards" });
    h.remove();
  }

  // ---------- атмосфера ----------
  private async atmosphere(id: ScenarioId) {
    if (id === "palette") { const h = HEROES.find((x) => x.id === this.hero)!; this.hooks.onSide(h.side === "light" ? "dark" : "light"); return; }
    if (!this.nx) return;
    if (!this.motion) { this.setStatus(id === "ship" ? "Вдали видны огни корабля." : "Подсветка героини."); this.root.classList.toggle("nx-static-glow", id === "glow"); return; }
    if (id === "ship") { this.ship = performance.now(); return; }
    const c = this.root.querySelector(".ss-companion")!; c.classList.add("nx-glow");
    try { await this.wait(1800); } catch { return; }
    c.classList.remove("nx-glow");
  }
  private seedStars() { let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); this.stars = Array.from({ length: 110 }, () => ({ x: rnd(), y: rnd(), z: 0.3 + rnd() * 0.7 })); }
  private sizeSky() {
    const canvas = this.root.querySelector<HTMLCanvasElement>(".nx-sky")!;
    const ratio = Math.min(1.5, devicePixelRatio || 1);
    const width = Math.round(this.root.clientWidth * ratio), height = Math.round(this.root.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (!this.motion) this.drawSky(0);
  }
  private drawSky(t: number) {
    const c = this.root.querySelector(".nx-sky") as HTMLCanvasElement; const g = c.getContext("2d"); if (!g) return;
    const w = c.width, h = c.height; g.clearRect(0, 0, w, h);
    const col = this.root.dataset.side === "dark" ? "#f5a8db" : "#9ceafd";
    for (const s of this.stars) {
      const depth = s.z * s.z;
      const x = ((s.x + t * 0.000014 * depth) % 1) * w;
      const y = ((s.y + t * 0.000002 * depth) % 1) * h;
      g.globalAlpha = 0.24 + depth * 0.48;
      g.fillStyle = s.z > 0.78 ? col : "#dfe9f2";
      g.fillRect(x, y, 0.7 + depth * 2.1, 0.7 + depth);
      if (s.z > 0.95) { g.globalAlpha *= 0.34; g.fillRect(x - 3, y, 8, 0.8); }
    }
    if (this.ship >= 0) {
      const k = (performance.now() - this.ship) / 6000;
      if (k > 1) this.ship = -1; else {
        const x = (0.30 + k * 0.68) * w, y = (0.155 - 0.058 * k) * h;
        const span = w * 0.065;
        const exhaust = g.createLinearGradient(x - span, y, x, y);
        exhaust.addColorStop(0, "transparent"); exhaust.addColorStop(1, col);
        g.globalAlpha = Math.min(1, k * 6, (1-k) * 6) * 0.83;
        g.strokeStyle = exhaust; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x - span, y + 0.006 * h); g.lineTo(x, y); g.stroke();
        g.fillStyle = "#ffdfad"; g.fillRect(x, y - 1, 5, 2);
        g.fillStyle = col; g.fillRect(x - 5, y + 2, 3, 1.5);
      }
    }
    g.globalAlpha = 1;
  }
  private startSky() {
    cancelAnimationFrame(this.skyRaf);
    if (!this.panelVisible || document.hidden) return;
    if (!this.motion) { this.ship = -1; this.drawSky(0); return; }
    let next = performance.now() + 2300, lastDraw = -Infinity;
    const loop = (t: number) => {
      if (t - lastDraw >= 32) {
        if (t > next) { this.ship = t; next = t + 21000; }
        this.drawSky(t); lastDraw = t;
      }
      this.skyRaf = requestAnimationFrame(loop);
    };
    this.skyRaf = requestAnimationFrame(loop);
  }

  destroy() {
    this.cancel(); cancelAnimationFrame(this.skyRaf); this.ro.disconnect(); this.comp.destroy();
    this.root.removeEventListener("click", this.onClick); this.root.remove(); void this.host;
  }
}
