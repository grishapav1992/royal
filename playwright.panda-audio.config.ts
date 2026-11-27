import { defineConfig } from '@playwright/test';

// Аудиопроверка модуля «Путь дракона» идёт оффлайн: звук рендерится в браузере
// без сервера Royal, поэтому собственный веб-сервер здесь не нужен.
export default defineConfig({
  testDir: './tests', testMatch: 'panda-dragon-audio.spec.ts', workers: 1, timeout: 60_000,
  outputDir: 'test-results/panda-audio',
  use: { channel: 'chrome', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
});
