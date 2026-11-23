import { parsePaylineLayout, validPaylineLayout, type PaylineLayout } from './paylines.ts';

export function mountPaylineEditor(root: HTMLElement) {
  root.innerHTML = `<h2>Конструктор линий</h2>
    <p>Выберите по одной ячейке на каждом барабане. Сетка показывает путь, но не считает совпадения и выплаты.</p>
    <div class="lab-tools">
      <label>Барабаны<input data-columns type="number" min="2" max="8" step="1" value="5"></label>
      <label>Ряды<input data-rows type="number" min="2" max="8" step="1" value="3"></label>
      <button data-size type="button">Применить размер</button>
    </div>
    <div class="line-board">
      <div data-cells aria-label="Путь линии" role="group"></div>
      <svg data-path aria-hidden="true" preserveAspectRatio="none"><polyline fill="none" vector-effect="non-scaling-stroke" /></svg>
    </div>
    <div class="lab-tools">
      <label>Линия<select data-lines></select></label>
      <button data-save type="button">Сохранить линию</button>
      <button data-remove type="button">Удалить линию</button>
    </div>
    <label>JSON линий<textarea data-json rows="5" spellcheck="false"></textarea></label>
    <div class="lab-tools">
      <button data-import type="button">Импортировать JSON</button>
      <button data-export type="button">Скачать JSON</button>
    </div>
    <p data-message role="status"></p>`;
  const find = <T extends Element = HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const columns = find<HTMLInputElement>('columns');
  const rows = find<HTMLInputElement>('rows');
  const lines = find<HTMLSelectElement>('lines');
  const cells = find('cells');
  const svg = find<SVGSVGElement>('path');
  const json = find<HTMLTextAreaElement>('json');
  const message = find('message');
  let layout: PaylineLayout = { columns: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] };
  let selected = 0;
  let draft = [...layout.paylines[0]];

  function render() {
    columns.value = String(layout.columns);
    rows.value = String(layout.rows);
    cells.style.setProperty('--slot-columns', String(layout.columns));
    cells.replaceChildren(...Array.from({ length: layout.columns * layout.rows }, (_, index) => {
      const col = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.col = String(col);
      button.dataset.row = String(row);
      button.setAttribute('aria-label', `Барабан ${col + 1}, ряд ${row + 1}`);
      button.textContent = String(row + 1);
      return button;
    }));
    lines.replaceChildren(new Option('Новая линия', '-1'), ...layout.paylines.map((_, i) => new Option(`Линия ${i + 1}`, String(i))));
    lines.value = String(selected);
    find<HTMLButtonElement>('remove').disabled = selected < 0;
    json.value = JSON.stringify(layout, null, 2);
    renderPath();
  }

  function renderPath() {
    for (const cell of cells.querySelectorAll('button')) {
      cell.setAttribute('aria-pressed', String(draft[Number(cell.dataset.col)] === Number(cell.dataset.row)));
    }
    svg.setAttribute('viewBox', `0 0 ${layout.columns} ${layout.rows}`);
    svg.querySelector('polyline')!.setAttribute('points', draft.map((row, col) => `${col + 0.5},${row + 0.5}`).join(' '));
  }

  function select(index: number) {
    selected = index;
    draft = [...(layout.paylines[index] ?? Array(layout.columns).fill(Math.floor(layout.rows / 2)))];
    message.textContent = '';
    find<HTMLButtonElement>('remove').disabled = selected < 0;
    renderPath();
  }

  cells.onclick = event => {
    const cell = (event.target as Element).closest('button[data-col]') as HTMLButtonElement | null;
    if (!cell) return;
    draft[Number(cell.dataset.col)] = Number(cell.dataset.row);
    renderPath();
  };
  lines.onchange = () => select(Number(lines.value));
  find('size').onclick = () => {
    const next = { columns: columns.valueAsNumber, rows: rows.valueAsNumber, paylines: layout.paylines };
    if (!validPaylineLayout(next)) {
      message.textContent = 'Новый размер должен быть от 2 до 8 и вмещать сохранённые линии. Сначала экспортируйте и удалите несовместимые линии.';
      return;
    }
    layout = next;
    select(selected);
    render();
  };
  find('save').onclick = () => {
    const paylines = [...layout.paylines];
    const index = selected < 0 ? paylines.length : selected;
    paylines[index] = [...draft];
    if (!validPaylineLayout({ ...layout, paylines })) { message.textContent = 'Такая линия уже есть или достигнут лимит 128 линий.'; return; }
    layout = { ...layout, paylines };
    selected = index;
    render();
    message.textContent = `Линия ${index + 1} сохранена.`;
  };
  find('remove').onclick = () => {
    if (selected < 0) return;
    layout = { ...layout, paylines: layout.paylines.filter((_, index) => index !== selected) };
    select(layout.paylines.length ? 0 : -1);
    render();
  };
  find('import').onclick = () => {
    try { layout = parsePaylineLayout(json.value); }
    catch { message.textContent = 'Некорректный JSON: проверьте размеры, номера рядов и дубликаты.'; return; }
    select(layout.paylines.length ? 0 : -1);
    render();
    message.textContent = 'Линии загружены.';
  };
  find('export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paylines.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  render();
  return { read: () => layout };
}
