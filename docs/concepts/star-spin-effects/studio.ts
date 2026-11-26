import { Scene, type ScenarioId, type Variant } from "./scene";
import { HEROES, type HeroId } from "./fixtures";
import { sharedAudio } from "./audio";
import { assetUrl } from "./media";

const select = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const stages = select("#stages");
const hero = select<HTMLSelectElement>("#hero");
const fast = select<HTMLInputElement>("#fast");
const reduced = select<HTMLInputElement>("#reduce");
const sound = select<HTMLInputElement>("#sound");
const finish = select<HTMLButtonElement>("#finish");
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
reduced.checked = motionPreference.matches;
const scenes = new Map<Variant, Scene>();
const screenSizes = [
 { label: "Малый телефон", width: 320, height: 568 },
 { label: "Телефон", width: 390, height: 844 },
 { label: "Короткое окно", width: 707, height: 447 },
 { label: "Планшет", width: 768, height: 1024 },
 { label: "Ноутбук", width: 1280, height: 720 },
 { label: "ПК", width: 1440, height: 900 },
 { label: "Full HD", width: 1920, height: 1080 },
];
const rotateScreen = select<HTMLButtonElement>("#rotate-screen");
const screenReadout = select<HTMLOutputElement>("#screen-readout");
let selectedSize: typeof screenSizes[number] | undefined;
let rotated = false;
const presetBar = select("#screen-sizes");
for (const preset of [undefined, ...screenSizes]) {
 const button = document.createElement("button");
 button.type = "button";
 button.dataset.size = preset ? `${preset.width}x${preset.height}` : "auto";
 const label = document.createElement("span");
 label.textContent = preset?.label ?? "Авто";
 const dimensions = document.createElement("small");
 dimensions.textContent = preset ? `${preset.width} × ${preset.height}` : "По окну";
 button.append(label, dimensions);
 button.onclick = () => { selectedSize = preset; rotated = false; updateScreenSize(); };
 presetBar.append(button);
}
let view: string = "compare";
let scenario: ScenarioId = "lift";
let activeHero: HeroId = "lyra";
type Example = [ScenarioId, string, string];
const groups: [string, Example[]][] = [
 ["Барабаны", [
  ["lift","Вращение","Пять колонок останавливаются слева направо."],["twoPortals","Два портала","Два SCATTER. Время остановки колонок такое же, как при обычном вращении."],["tower","Доводка WILD","Четвёртая колонка. Два шага доводки, множитель ×1 → ×2 → ×3."],["routes","Линии по очереди","Две оплаченные линии, № 8 и № 16. Итоговая выплата 0,16 USDT."]]],
 ["Итог раунда", [
  ["o_none","Без выплаты","Выплата 0,00 USDT."],["o_partial","Частичный возврат","Выплата 0,02 USDT при ставке 0,10."],["o_return","Возврат ставки","Выплата 0,10 USDT. Чистый итог 0,00."],["o_positive","Положительный","Выплата 0,16 USDT. Чистый итог +0,06."],["o_large","Крупный","Пробный порог от 20× полной ставки. В этом примере выплата 2,26 USDT, или 22,6×."]]],
 ["Перегрузка реактора", [
  ["bonusEnter","Вход в бонус","Три портала дают восемь бесплатных вращений."],["bonusFree","Бесплатное вращение","Счётчик 8 → 7. Нового списания нет."],["bonusEnd","Завершение бонуса","Выплата за весь демонстрационный раунд 0,02 USDT."]]],
 ["Атмосфера", [
  ["wait","Ожидание ответа","Исход ещё неизвестен. Для выхода выберите любой другой сценарий."],["ship","Огни корабля","Огни проходят вдали за игровым полем."],["glow","Свет за героиней","Мягкий акцент цвета выбранной стороны."],["palette","Смена стороны","Свет и Тьма. Сравните переход палитры и реакцию героини."]]]
];
const buttons = select("#scenarios");
for (const [name, items] of groups) {
 const row = document.createElement("div");
 const title = document.createElement("h3"); title.textContent = name; row.append(title);
 const choices = document.createElement("div"); row.append(choices);
 for (const [id,label,description] of items) {
  const b = document.createElement("button"); b.textContent = label; b.dataset.scene = id; b.title = description;
  b.addEventListener("click", () => play(id)); choices.append(b);
 }
 buttons.append(row);
}
function render() {
 const busy = [...scenes.values()].filter(s => s.running);
 finish.disabled = !busy.length || busy.some(s => s.waiting || s.root.dataset.phase === "request");
 sound.checked = sharedAudio.enabled;
 for (const s of scenes.values()) s.syncSound();
 for (const b of buttons.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.scene === scenario));
 const entry = groups.flatMap(([,list])=>list).find(([id])=>id===scenario)!;
 select("#description").textContent = entry[2];
}
function changeHero(id: HeroId) {
 activeHero = id; hero.value = id;
 for (const scene of scenes.values()) scene.setHero(id);
}
function finishAll() { for (const scene of scenes.values()) if (scene.running) scene.finish(); render(); }
function play(id: ScenarioId) {
 scenario = id;
 if (id === "palette") {
  finishAll(); changeHero(HEROES.find(x=>x.id===activeHero)?.side==="light"?"vespera":"lyra");
 } else for (const scene of scenes.values()) void scene.run(id).then(render);
 render();
}
function fitAll() {
 const size = selectedSize;
 let caption = "";
 for (const scene of scenes.values()) {
  const mount = scene.root.parentElement!, frame = mount.parentElement!;
  if (!frame.clientWidth || !frame.clientHeight) continue;
  const width = size ? (rotated ? size.height : size.width) : frame.clientWidth;
  const height = size ? (rotated ? size.width : size.height) : frame.clientHeight;
  const scale = Math.min(1, frame.clientWidth / width, frame.clientHeight / height);
  mount.style.width = width + "px"; mount.style.height = height + "px";
  mount.style.transform = `translate(-50%, -50%) scale(${scale})`;
  scene.fit();
  caption = `${width} × ${height} px`;
 }
 if (caption && screenReadout.value !== caption) screenReadout.value = caption;
}
function updateScreenSize() {
 const size = selectedSize;
 rotateScreen.disabled = !size;
 stages.dataset.fixedSize = String(Boolean(size));
 if (size) {
  const width = rotated ? size.height : size.width, height = rotated ? size.width : size.height;
  stages.style.setProperty("--screen-ratio", `${width} / ${height}`);
  stages.style.setProperty("--screen-height", height + "px");
 }
 const active = size ? `${size.width}x${size.height}` : "auto";
 for (const button of presetBar.querySelectorAll("button")) {
  button.setAttribute("aria-pressed", String(button.dataset.size === active));
  if (size && button.dataset.size === active && rotated) button.querySelector("small")!.textContent = `${size.height} × ${size.width}`;
  else if (button.dataset.size !== "auto") button.querySelector("small")!.textContent = button.dataset.size!.replace("x", " × ");
 }
 fitAll();
}
rotateScreen.onclick = () => { rotated = !rotated; updateScreenSize(); };
function setView(next:string) {
 view = next; stages.dataset.view = next;
 for (const [variant, scene] of scenes) scene.setPanelVisible(view === "compare" || variant === view);
 document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b=>{ if(b.tagName==="BUTTON") b.setAttribute("aria-pressed",String(b.dataset.view===view)); });
 for(const b of document.querySelectorAll<HTMLButtonElement>("[data-expand]")) b.textContent = view==="compare" ? "Развернуть ↗" : "Сравнить рядом";
 fitAll();
}
for (const h of HEROES) hero.add(new Option(h.name,h.id));
document.documentElement.style.setProperty("--hangar", "url('" + assetUrl("background.webp") + "')");
for(const v of ["old","new"] as const){
 const scene = new Scene(select('[data-panel="'+v+'"] .mount'),v,{
  audible:()=>view==="old"?v==="old":v==="new", onSpin:()=>play(scenario==="wait"?"lift":scenario),onSkip:()=>{if(!finish.disabled)finishAll();},
  onCrew:()=>{hero.focus(); try{hero.showPicker()}catch{}}, onChange:render,
  onSide:s=>changeHero(HEROES.find(h=>h.side===s)!.id)
 }); scenes.set(v,scene);
}
function settings() {
 for(const scene of scenes.values())scene.setSettings({fast:fast.checked,reduced:reduced.checked||motionPreference.matches});
 render();
}
for (const b of document.querySelectorAll<HTMLButtonElement>("#views button")) b.onclick=()=>setView(b.dataset.view!);
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-expand]")) b.onclick=()=>setView(view==="compare"?b.dataset.expand!:"compare");
hero.onchange=()=>changeHero(hero.value as HeroId); fast.onchange=settings; reduced.onchange=settings;
sound.onchange=()=>{sharedAudio.setEnabled(sound.checked);render();}; finish.onclick=finishAll;
select("#repeat").onclick=()=>play(scenario);
motionPreference.onchange=()=>{reduced.checked=motionPreference.matches;settings();};
const resize=new ResizeObserver(fitAll);for(const f of document.querySelectorAll(".viewport"))resize.observe(f);
window.addEventListener("pagehide",()=>{for(const scene of scenes.values())scene.destroy();resize.disconnect();sharedAudio.setEnabled(false);},{once:true});
document.addEventListener("visibilitychange",()=>{if(document.hidden)finishAll();sharedAudio.cancel();for(const s of scenes.values())s.setSettings({fast:fast.checked,reduced:document.hidden||reduced.checked||motionPreference.matches});});
const compact = matchMedia("(max-width:899px)").matches;
selectedSize = screenSizes.find(size => size.width === (compact ? 390 : 1280));
setView(compact ? "new" : "compare");updateScreenSize();settings();changeHero("lyra");render();
