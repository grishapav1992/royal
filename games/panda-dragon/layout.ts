export { DRAGON_PATH_LAYOUT as PANDA_LAYOUT } from '../../src/shared/dragonPathLayout';

export const SYMBOLS = [
  { id: 0, key: "scroll", name: "Свиток Дракона", role: "Скаттер – 3 свитка открывают бонус" },
  { id: 1, key: "panda", name: "Мастер-панда", role: "Дикий символ" },
  { id: 2, key: "peach", name: "Персик Мудрости", role: "Высокий символ" },
  { id: 3, key: "dumplings", name: "Пельмени", role: "Высокий символ" },
  { id: 4, key: "tiger", name: "Мастер Тигр", role: "Средний символ" },
  { id: 5, key: "crane", name: "Журавль", role: "Средний символ" },
  { id: 6, key: "monkey", name: "Обезьяна", role: "Низкий символ" },
  { id: 7, key: "mantis", name: "Богомол", role: "Низкий символ" },
  { id: 8, key: "snake", name: "Змея", role: "Низкий символ" },
] as const;

export const BIG_WIN_MULTIPLIER = 20;
