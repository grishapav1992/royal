export type PaylineLayout = Readonly<{ columns: number; rows: number; paylines: readonly (readonly number[])[] }>;

export function validPaylineLayout(value: unknown): value is PaylineLayout {
  if (!value || typeof value !== 'object') return false;
  const { columns, rows, paylines } = value as PaylineLayout;
  if (!Number.isInteger(columns) || columns < 2 || columns > 8 || !Number.isInteger(rows) || rows < 2 || rows > 8
    || !Array.isArray(paylines) || paylines.length > 128) return false;
  return Array.from(paylines).every(line => Array.isArray(line) && line.length === columns
    && Array.from(line).every(row => Number.isInteger(row) && row >= 0 && row < rows))
    && new Set(paylines.map(line => line.join(','))).size === paylines.length;
}

export function parsePaylineLayout(json: string): PaylineLayout {
  const value: unknown = JSON.parse(json);
  if (!validPaylineLayout(value)) throw Error('Проверьте размеры, номера рядов и дубликаты линий.');
  return { columns: value.columns, rows: value.rows, paylines: value.paylines };
}

export function paylineCells(columns: number, line: readonly number[]): number[] {
  return line.map((row, column) => row * columns + column);
}
