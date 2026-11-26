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
 const pair = view==="compare" && innerWidth>=900;
 for (const scene of scenes.values()) {
  const mount = scene.root.parentElement!, frame = mount.parentElement!;
  const miniature = pair && frame.clientWidth < 900;
  const width = miniature ? 1000 : frame.clientWidth;
  const height = miniature ? 625 : frame.clientHeight;
  mount.style.width = width + "px"; mount.style.height = height + "px";
  mount.style.transform = miniature ? "scale(" + frame.clientWidth/width + ")" : "none";
  scene.fit();
 }
}
function setView(next:string) {
 view = next; stages.dataset.view = next;
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
setView(matchMedia("(max-width:899px)").matches?"new":"compare");settings();changeHero("lyra");render();
