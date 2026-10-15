const { chromium } = require('../../node_modules/playwright');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const publicRoot = path.resolve(__dirname, '../public');
const taskId = 'c8eb6ec1-eb93-443c-a3ae-f98c5e1e5418';
const counters = { input_tokens: 12000, cached_input_tokens: 7000, output_tokens: 3000, reasoning_output_tokens: 1200, total_tokens: 15000 };
const factory = { totals: counters, by_role: [{ role: 'developer', totals: counters, reported_runs: 1, unreported_runs: 2, legacy_reports: 1 }], reported_runs: 1, unreported_runs: 2, legacy_reports: 1, coverage_started_at: '2026-10-10T01:00:00Z' };
const task = { id: taskId, title: 'Проверить баланс', description: 'Проверенная задача', status: 'ready_release', priority: 'P0', requirements_version: 1, created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', questions: [{ id: 'question', text: 'Какой баланс?', answer: '' }], events: [], bugs: [], usage_summary: factory, runs: [{ id: 'new', role: 'developer', status: 'succeeded', requirements_version: 1, started_at: '2026-10-10T01:00:00Z', finished_at: '2026-10-10T01:10:00Z', usage: counters }, { id: 'old', role: 'analyst', status: 'succeeded', requirements_version: 1, started_at: '2026-10-10T00:00:00Z', usage: null }] };
function ready() {
  return { subscription: { status: 'ready', checked_at: new Date().toISOString(), stale: false, error: null, limits: [{ id: 'codex', name: 'Codex', plan_type: 'pro', windows: [{ kind: 'primary', used_percent: 30, remaining_percent: 70, window_minutes: 300, resets_at: '2026-10-10T06:00:00Z' }, { kind: 'secondary', used_percent: 94, remaining_percent: 6, window_minutes: 10080, resets_at: '2026-10-14T12:00:00Z' }] }], account_usage: { lifetime_tokens: 100000, daily_tokens: [] } }, factory: structuredClone(factory) };
}
(async () => {
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH || existsSync(systemChrome) ? { executablePath: process.env.CHROME_PATH || systemChrome } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, timezoneId: 'UTC' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let usage = ready(); let refreshCalls = 0; let failState = false;
    await page.route('https://usage-test.invalid/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/team/api/state') {
        if (failState) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Временно недоступно' }) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tasks: [task], settings: {}, runtime: { available: true, authenticated: true, release_enabled: false }, projects: [], usage }) });
      }
      if (url.pathname === `/team/api/tasks/${taskId}`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ task }) });
      if (url.pathname === '/team/api/usage/refresh') { refreshCalls += 1; usage.subscription.checked_at = new Date(Date.now() + 1).toISOString(); return route.fulfill({ status: 202, contentType: 'application/json', body: '{"requested":true}' }); }
      if (url.pathname === '/team/api/usage') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(usage) });
      const file = url.pathname === '/team/' ? 'index.html' : url.pathname.split('/').at(-1);
      if (['index.html', 'app.js', 'styles.css', 'favicon.svg'].includes(file)) return route.fulfill({ contentType: { 'index.html': 'text/html', 'app.js': 'text/javascript', 'styles.css': 'text/css', 'favicon.svg': 'image/svg+xml' }[file], headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" }, body: readFileSync(path.join(publicRoot, file), 'utf8') });
      return route.abort();
    });
    await page.goto('https://usage-test.invalid/team/');
    await page.locator('#usage-card-title').getByText('Осталось 6%', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Расход и лимиты', exact: true }).click();
    const dialog = page.locator('#usage-dialog');
    await dialog.getByText('Осталось 70%', { exact: true }).waitFor();
    assert.equal(await dialog.locator('progress').count(), 2);
    assert.equal(await dialog.locator('progress').first().evaluate(node => node.value), 70);
    assert.match(await dialog.locator('#usage-freshness').innerText(), /МСК/);
    await dialog.getByText('Обновление 10 окт., 09:00 МСК', { exact: true }).waitFor();
    assert.match(await dialog.locator('#usage-factory').innerText(), /15\s000/);
    assert.match(await dialog.locator('#usage-factory').innerText(), /Подробных отчетов запусков: 1 · Без подробностей: 2/);
    assert.match(await dialog.locator('#usage-factory').innerText(), /Старых отчетов: 1\. Их счетчики включены в итог; привязка к конкретным запускам не получена\./);
    assert.match(await dialog.locator('.usage-role').innerText(), /Старых отчетов роли: 1/);
    assert.equal(await dialog.locator('.usage-plan').count(), 0);
    assert.equal(await dialog.locator('.usage-limit-group h4').first().innerText(), 'Codex');
    assert.match(await dialog.innerText(), /Лимит аккаунта общий для Codex/);
    if (process.argv.includes('--smoke')) { console.log('PASS: detailed versus legacy coverage labels, role coverage, quota names, hidden technical subscription type, real remainder and token totals.'); return; }
    await page.getByRole('button', { name: 'Обновить лимиты', exact: true }).click();
    await page.getByText('Лимиты обновлены.', { exact: true }).waitFor();
    assert.equal(refreshCalls, 1);
    usage.subscription.checked_at = '2026-10-01T00:00:00Z'; usage.subscription.stale = true;
    await page.waitForTimeout(5200);
    await dialog.getByText('Показаны последние полученные лимиты. Текущий остаток пока не подтвержден.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('progress').first().evaluate(node => node.value), 70);
    usage.subscription.status = 'unavailable'; usage.subscription.error = '<img src=x onerror=alert(1)>';
    await page.waitForTimeout(5200);
    await dialog.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor();
    assert.equal(await dialog.locator('img').count(), 0);
    assert.equal(await dialog.locator('progress').count(), 2);
    usage.subscription.limits = []; usage.subscription.checked_at = null; usage.subscription.account_usage = null;
    usage.factory = { totals: { input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_output_tokens: null, total_tokens: null }, by_role: [], reported_runs: 0, unreported_runs: 3, legacy_reports: 0, coverage_started_at: null };
    await page.waitForTimeout(5200);
    await dialog.getByText('Лимиты пока недоступны. Остаток неизвестен, это не означает, что лимит исчерпан.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('progress').count(), 0);
    assert.equal(await dialog.locator('dd').first().innerText(), 'Нет данных');
    assert.equal(await page.locator('#usage-card-title').innerText(), 'Остаток неизвестен');
    usage = ready(); usage.subscription.limits.push({ id: 'special', name: '<script>alert(1)</script>', plan_type: 'pro', windows: [{ kind: 'primary', used_percent: 100, remaining_percent: 0, window_minutes: null, resets_at: null }] });
    usage.factory.totals = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
    await page.waitForTimeout(5200);
    await dialog.getByText('Осталось 0%', { exact: true }).waitFor();
    assert.equal(await dialog.locator('progress').count(), 3);
    assert.equal(await dialog.locator('script').count(), 0);
    assert.equal(await dialog.locator('dd').first().innerText(), '0');
    await page.keyboard.press('Escape'); assert.equal(await dialog.evaluate(node => node.open), false);
    await page.getByRole('button', { name: 'Проверить баланс. Готова к выпуску', exact: true }).click();
    const taskUsage = page.locator('#task-detail details[data-disclosure="usage"]');
    const taskReports = page.locator('#task-detail details[data-disclosure="reports"]');
    await taskUsage.waitFor();
    assert.equal(await taskUsage.evaluate(node => node.open), false, 'Task usage starts collapsed.');
    assert.equal(await taskReports.evaluate(node => node.open), false, 'Run details start collapsed.');
    await taskUsage.locator(':scope > summary').click();
    assert.match(await taskUsage.innerText(), /15\s000/);
    await taskReports.locator(':scope > summary').click();
    await page.locator('.run-usage').getByText('Токены: расход не получен.', { exact: true }).waitFor();
    assert.match(await page.locator('#task-detail').innerText(), /Кеш: 7\s000 \(часть входа\)/);
    const answer = page.locator('.question-item textarea'); await answer.fill('Несохраненный ответ');
    await page.getByRole('button', { name: 'Расход и лимиты команды', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await answer.inputValue(), 'Несохраненный ответ');
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), true);
    await page.locator('#task-dialog').evaluate(node => node.close());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Открыть лимит аккаунта Codex', exact: true }).click();
    assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
    assert.equal(await page.locator('body').evaluate(node => node.scrollWidth > innerWidth), false);
    await page.keyboard.press('Escape');
    failState = true; await page.waitForTimeout(5200);
    await page.getByRole('button', { name: 'Расход и лимиты', exact: true }).click();
    await dialog.getByText('Показаны последние полученные лимиты. Текущий остаток пока не подтвержден.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('progress').count(), 3);
    assert.deepEqual(errors, []);
    console.log('PASS: quota remainder, multiple windows, Moscow reset, fresh/stale/unavailable, null/zero, token coverage, account/project scope, role/run/task counters, manual refresh, safe text, mobile layout, Escape, disconnected last data.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
