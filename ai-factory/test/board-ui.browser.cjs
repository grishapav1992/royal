const { chromium } = require('../../node_modules/playwright');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const publicRoot = path.resolve(__dirname, '../public');
const origin = 'https://board-test.invalid';
const ids = {
  alpha: '10000000-0000-4000-8000-000000000001',
  beta: '10000000-0000-4000-8000-000000000002',
  gamma: '10000000-0000-4000-8000-000000000003',
  ready: '10000000-0000-4000-8000-000000000004',
  working: '10000000-0000-4000-8000-000000000005',
  question: '10000000-0000-4000-8000-000000000006',
  release: '10000000-0000-4000-8000-000000000007',
  unsafe: '10000000-0000-4000-8000-000000000008',
  failedDeveloper: '10000000-0000-4000-8000-000000000009',
  failedTester: '10000000-0000-4000-8000-000000000010',
  failedAnalyst: '10000000-0000-4000-8000-000000000011',
  paused: '10000000-0000-4000-8000-000000000012',
  pausedRelease: '10000000-0000-4000-8000-000000000013'
};
const laneFor = { inbox: 'inbox', analyzing: 'analysis', needs_answers: 'analysis', ready: 'ready', developing: 'working', repairing: 'working', testing: 'testing', ready_release: 'release', releasing: 'release', done: 'done', needs_attention: 'attention', paused: 'attention', cancelled: 'attention' };
const unsafeTitle = '<img src=x onerror=alert(1)>';
const unsafeReason = '<img src=x onerror=alert(1)> unavailable';
const privateDescription = 'Подробное описание, которое открывается по запросу.';
const privatePlan = 'Технический критерий приемки.';
const privateArtifact = 'artifact-debug-marker';
const privateReport = 'Исторический отчет исполнителя.';
function makeTask(id, title, status, position, priority = 'P2', extra = {}) {
  const column = laneFor[status];
  return {
    id, title, description: 'Описание задачи', status, priority,
    board_column: column, board_position: position,
    board_moves: [column, ...(status === 'inbox' ? ['analysis'] : status === 'ready' ? ['working'] : [])],
    board_move_actions: status === 'inbox' ? { analysis: 'analyze' } : status === 'ready' ? { working: 'start' } : {},
    requirements_version: 1, created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z',
    questions: [], events: [], bugs: [], runs: [], ...extra
  };
}
function fixtures() {
  return [
    makeTask(ids.alpha, 'Первая идея', 'inbox', 0, 'P3', { description: privateDescription }),
    makeTask(ids.beta, 'Вторая идея', 'inbox', 1, 'P0'),
    makeTask(ids.gamma, 'Третья идея', 'inbox', 2, 'P1'),
    makeTask(ids.unsafe, unsafeTitle, 'inbox', 3),
    makeTask(ids.ready, 'Готовая спецификация', 'ready', 0, 'P2', {
      spec: { summary: 'Результат планирования', acceptance: [privatePlan], subtasks: [{ title: 'Проверить крайний случай', description: 'Отдельный критерий' }] }
    }),
    makeTask(ids.working, 'Текущая разработка', 'developing', 0, 'P1', {
      active_run: { id: 'run', status: 'running', role: 'developer', started_at: new Date(Date.now() - 20000).toISOString(), lease_expires_at: new Date(Date.now() + 3600000).toISOString(), progress: { phase: 'model', activity_kind: 'thinking', updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), tool_calls: 137, tool_completed: 136, model_started_at: new Date(Date.now() - 20000).toISOString(), timeout_ms: 1800000 } }
    }),
    makeTask(ids.question, 'Задача с вопросом', 'needs_answers', 0, 'P1', { questions: [{ id: 'question', text: 'Какой результат ожидается?', answer: '' }, { id: 'second-question', text: 'Как проверить второй результат?', answer: '' }, { id: 'answered', text: 'Предыдущий вопрос?', answer: 'Уже полученный ответ.' }] }),
    makeTask(ids.release, 'Проверенная задача', 'ready_release', 0, 'P2', {
      artifact: { developer: { summary: 'Изменения готовы', commit: 'a'.repeat(40), debug: privateArtifact, patch: { filename: 'candidate.patch', bytes: 32 } }, tester: { passed: true, summary: 'Проверки пройдены' } },
      runs: [{ id: 'tested', role: 'tester', status: 'succeeded', summary: privateReport, requirements_version: 1, started_at: '2026-10-10T01:00:00Z', finished_at: '2026-10-10T01:05:00Z' }],
      events: [{ type: 'job_completed', message: 'Проверка завершилась в истории.', created_at: '2026-10-10T01:05:00Z' }],
      usage_summary: { totals: { total_tokens: 2500, input_tokens: 2000, output_tokens: 500 }, reported_runs: 1, unreported_runs: 0 }
    }),
    makeTask(ids.failedDeveloper, 'Остановленная разработка', 'needs_attention', 0, 'P1', {
      board_moves: ['attention', 'working'], board_move_actions: { working: 'retry' },
      runs: [{ id: 'failed-developer', role: 'developer', status: 'failed', error: unsafeReason, requirements_version: 1 }],
      board_last_failure: { role: 'developer', error: unsafeReason }
    }),
    makeTask(ids.failedTester, 'Остановленная проверка', 'needs_attention', 1, 'P1', {
      board_moves: ['attention', 'testing'], board_move_actions: { testing: 'retry' },
      runs: [{ id: 'failed-tester', role: 'tester', status: 'failed', error: 'Проверки недоступны', requirements_version: 1 }],
      board_last_failure: { role: 'tester', error: 'Проверки недоступны' },
      artifact: { tester: { verification_blocked: true } }
    }),
    makeTask(ids.failedAnalyst, 'Остановленный анализ', 'needs_attention', 2, 'P2', {
      board_moves: ['attention', 'analysis'], board_move_actions: { analysis: 'retry' },
      runs: [{ id: 'failed-analyst', role: 'analyst', status: 'failed', error: 'Истекло время анализа', requirements_version: 1 }],
      board_last_failure: { role: 'analyst', error: 'Истекло время анализа' }
    }),
    makeTask(ids.paused, 'Разработка на паузе', 'paused', 3, 'P2', {
      board_moves: ['attention', 'working'], board_move_actions: { working: 'resume' },
      runs: [{ id: 'paused-developer', role: 'developer', status: 'cancelled', requirements_version: 1 }]
    }),
    makeTask(ids.pausedRelease, 'Выпуск на паузе', 'paused', 4, 'P2', {
      resume_status: 'ready_release', board_moves: ['attention', 'release'], board_move_actions: { release: 'resume' },
      runs: [{ id: 'checked-before-pause', role: 'tester', status: 'succeeded', requirements_version: 1 }]
    })
  ];
}

(async () => {
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH || existsSync(systemChrome) ? { executablePath: process.env.CHROME_PATH || systemChrome } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let tasks = fixtures(); let moveCalls = []; let actionCalls = []; let stateCalls = 0; let failMove = null; let failAction = null; let holdStatePoll = null; let runtimeAvailable = true;
    await page.route(`${origin}/**`, async route => {
      const request = route.request(); const url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/team/api/state') {
        stateCalls += 1;
        const listedTasks = tasks.map(({ runs, events, bugs, jobs, questions, ...task }) => ({
          ...task, open_questions: (questions || []).filter(question => !question.answer?.trim()).length
        }));
        const stateBody = { tasks: listedTasks, settings: {}, runtime: { available: runtimeAvailable, authenticated: true, release_enabled: false }, projects: [], usage: null };
        if (holdStatePoll) {
          const held = holdStatePoll; holdStatePoll = null;
          const frozenBody = JSON.stringify(stateBody);
          held.started(); await held.release;
          return route.fulfill({ status: 200, contentType: 'application/json', body: frozenBody });
        }
        return json(stateBody);
      }
      const detail = url.pathname.match(/^\/team\/api\/tasks\/([a-f0-9-]+)$/);
      if (detail) return json({ task: tasks.find(task => task.id === detail[1]) });
      const move = url.pathname.match(/^\/team\/api\/tasks\/([a-f0-9-]+)\/move$/);
      if (move) {
        assert.equal(request.method(), 'POST');
        const body = request.postDataJSON(); moveCalls.push({ id: move[1], body });
        if (failMove) { const failure = failMove; failMove = null; return json({ error: failure.message }, failure.status); }
        const task = tasks.find(item => item.id === move[1]);
        assert.deepEqual(Object.keys(body).sort(), ['before_task_id', 'column_id', 'expected_status']);
        assert.equal(body.expected_status, task.status);
        assert.equal(typeof body.column_id, 'string');
        assert.ok(body.before_task_id === null || /^[a-f0-9-]{36}$/.test(body.before_task_id));
        if (!task.board_moves.includes(body.column_id)) return json({ error: 'Этот этап нельзя запустить перемещением.' }, 409);
        if (task.board_column !== body.column_id) {
          task.status = { analysis: 'analyzing', working: 'developing', testing: 'testing' }[body.column_id];
          task.board_column = body.column_id; task.board_moves = [body.column_id]; task.board_move_actions = {};
        }
        const siblings = tasks.filter(item => item.id !== task.id && item.board_column === body.column_id).sort((a, b) => a.board_position - b.board_position);
        const before = body.before_task_id === null ? siblings.length : siblings.findIndex(item => item.id === body.before_task_id);
        assert.ok(before >= 0, 'The requested insertion point belongs to the target lane.');
        siblings.splice(before, 0, task); siblings.forEach((item, index) => { item.board_position = index; });
        return json({ task });
      }
      const action = url.pathname.match(/^\/team\/api\/tasks\/([a-f0-9-]+)\/action$/);
      if (action) {
        assert.equal(request.method(), 'POST');
        const body = request.postDataJSON(); actionCalls.push({ id: action[1], body });
        if (failAction) { const failure = failAction; failAction = null; return json({ error: failure.message }, failure.status); }
        const task = tasks.find(item => item.id === action[1]);
        const target = Object.entries(task.board_move_actions).find(([, value]) => value === body.action)?.[0];
        assert.ok(target, 'Recovery button requests the task-specific retry or resume action.');
        task.status = { analysis: 'analyzing', working: 'developing', testing: 'testing' }[target];
        task.board_column = target; task.board_moves = [target]; task.board_move_actions = {};
        return json({ task });
      }
      const file = url.pathname === '/team/' ? 'index.html' : url.pathname.split('/').at(-1);
      if (['index.html', 'app.js', 'styles.css', 'favicon.svg'].includes(file)) return route.fulfill({
        contentType: { 'index.html': 'text/html', 'app.js': 'text/javascript', 'styles.css': 'text/css', 'favicon.svg': 'image/svg+xml' }[file],
        headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        body: readFileSync(path.join(publicRoot, file), 'utf8')
      });
      return route.abort();
    });
    const card = id => page.locator(`article.task-card[data-task-id="${id}"]`);
    const lane = id => page.locator(`.board-column[data-column-id="${id}"]`);
    const disclosure = key => page.locator(`#task-detail details.detail-disclosure[data-disclosure="${key}"]`);
    const openDisclosure = async key => {
      const block = disclosure(key); await block.waitFor();
      assert.equal(await block.evaluate(node => node.open), false, `${key} starts collapsed.`);
      const summary = block.locator(':scope > summary'); await summary.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(key => document.querySelector(`#task-detail details[data-disclosure="${key}"]`)?.open === true, key);
      assert.equal(await block.locator('.disclosure-content').isVisible(), true, `${key} can be expanded with the keyboard.`);
      return block;
    };
    const laneOrder = id => lane(id).locator('article.task-card').evaluateAll(nodes => nodes.map(node => node.dataset.taskId));
    const waitOrder = async (id, expected) => {
      await page.waitForFunction(({ column, expectedIds }) => {
        const nodes = document.querySelectorAll(`.board-column[data-column-id="${column}"] article.task-card`);
        return JSON.stringify([...nodes].map(node => node.dataset.taskId)) === JSON.stringify(expectedIds);
      }, { column: id, expectedIds: expected });
      assert.deepEqual(await laneOrder(id), expected);
    };
    const reload = async ({ reset = true } = {}) => {
      if (reset) { tasks = fixtures(); moveCalls = []; actionCalls = []; failMove = null; failAction = null; holdStatePoll = null; runtimeAvailable = true; }
      await page.goto(`${origin}/team/`);
      await card(ids.alpha).waitFor();
    };
    const beginDrag = async id => {
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await card(id).dispatchEvent('dragstart', { dataTransfer: transfer });
      return transfer;
    };
    const drop = async (sourceId, columnId, beforeId = null) => {
      const transfer = await beginDrag(sourceId);
      const target = beforeId ? card(beforeId) : lane(columnId).locator('.column-tasks');
      const box = await target.boundingBox(); assert.ok(box);
      const point = { clientX: box.x + box.width / 2, clientY: beforeId ? box.y + 2 : box.y + box.height - 2 };
      await target.dispatchEvent('dragover', { dataTransfer: transfer, ...point });
      await target.dispatchEvent('drop', { dataTransfer: transfer, ...point });
      await card(sourceId).dispatchEvent('dragend', { dataTransfer: transfer });
      await transfer.dispose();
    };

    await reload();
    await waitOrder('inbox', [ids.alpha, ids.beta, ids.gamma, ids.unsafe]);
    assert.equal(await card(ids.alpha).getAttribute('data-priority'), 'P3');
    assert.equal(await card(ids.beta).getAttribute('data-status'), 'inbox');
    assert.equal(await page.locator('button button').count(), 0);
    assert.equal(await card(ids.unsafe).locator('img, script').count(), 0);
    assert.equal(await card(ids.unsafe).locator('h3').innerText(), unsafeTitle);
    assert.equal(await card(ids.alpha).locator('.card-description, .task-id, time').count(), 0, 'Cards keep the task title and status without description, technical ID or dates.');
    assert.equal((await card(ids.alpha).innerText()).includes(privateDescription), false);
    await card(ids.alpha).locator('.card-open').click();
    await page.locator('#task-dialog[open]').waitFor();
    assert.equal(await disclosure('description').evaluate(node => node.open), false);
    assert.equal(await page.getByText(privateDescription, { exact: true }).isVisible(), false, 'The full description is available on request.');
    assert.equal(await page.locator('#task-detail').getByRole('button', { name: 'Передать аналитику', exact: true }).isVisible(), true);
    assert.equal(await page.locator('#task-detail .detail-actions-menu').evaluate(node => node.open), false);
    assert.equal(await page.locator('#task-detail').getByRole('button', { name: 'Редактировать', exact: true }).isVisible(), false, 'Secondary actions do not compete with the next step.');
    await openDisclosure('description');
    assert.equal(await page.getByText(privateDescription, { exact: true }).isVisible(), true);
    tasks.find(task => task.id === ids.alpha).updated_at = '2026-10-10T01:01:00Z';
    await page.waitForTimeout(5200);
    assert.equal(await disclosure('description').evaluate(node => node.open), true, 'Polling preserves the expanded detail section.');
    await page.locator('#task-detail .detail-actions-menu > summary').click();
    await page.locator('#task-detail').getByRole('button', { name: 'Редактировать', exact: true }).click();
    const editTitle = page.locator('#task-detail .edit-form input[name="title"]');
    await editTitle.fill('Несохраненное название');
    tasks.find(task => task.id === ids.alpha).updated_at = '2026-10-10T01:02:00Z';
    await page.waitForTimeout(5200);
    assert.equal(await editTitle.inputValue(), 'Несохраненное название', 'Polling cannot replace an unfinished edit.');
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();

    await card(ids.ready).locator('.card-open').click();
    await page.locator('#task-dialog[open]').waitFor();
    assert.equal(await disclosure('description').evaluate(node => node.open), false, 'Expanding one task does not expand another task.');
    assert.equal(await page.getByText(privatePlan, { exact: true }).isVisible(), false, 'The full acceptance plan starts collapsed.');
    await openDisclosure('spec');
    assert.equal(await page.getByText(privatePlan, { exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();

    await card(ids.working).locator('.card-open').click();
    await page.locator('#task-dialog[open]').waitFor();
    await page.locator('#task-progress .task-stepper li').first().waitFor();
    assert.equal(await page.locator('#task-progress .task-stepper li').count(), 4, 'Progress presents actual workflow stages.');
    assert.equal(await page.locator('#task-progress .task-stepper li.current').count(), 1);
    assert.match(await page.locator('#task-progress .task-stepper li.current').innerText(), /Разработ/i);
    assert.equal(await page.locator('#task-progress [aria-valuenow], #task-progress progress').count(), 0, 'No invented completion percentage is exposed.');
    assert.equal((await page.locator('#task-progress').innerText()).includes('136'), false, 'Tool counters are not presented as progress.');
    assert.equal(await page.locator('#task-progress .progress-heading').isVisible(), true);
    tasks.find(task => task.id === ids.working).active_run.progress.last_activity_at = new Date(Date.now() - 180000).toISOString();
    await page.waitForFunction(() => document.querySelector('#task-progress .progress-heading')?.textContent.includes('Нет новой активности'), null, { timeout: 8000 });
    assert.equal(await page.locator('#task-progress .activity-bar.moving').count(), 0, 'A silent run no longer appears actively moving.');
    assert.equal(await page.locator('#task-progress .current-note').isVisible(), true, 'Unconfirmed activity has a visible status explanation.');
    runtimeAvailable = false;
    await page.waitForFunction(() => document.querySelector('#task-progress .progress-heading')?.textContent.includes('Исполнитель недоступен'), null, { timeout: 8000 });
    assert.match(await page.locator('#task-progress .task-stepper li.current .step-text').innerText(), /Не подтверждено/, 'The stage does not claim confirmed work while the runner is unavailable.');
    assert.equal(await page.locator('#task-progress .activity-bar.moving').count(), 0);
    runtimeAvailable = true;
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();

    await card(ids.pausedRelease).locator('.card-open').click();
    await page.locator('#task-progress .task-stepper li').first().waitFor();
    const pausedReleaseSteps = page.locator('#task-progress .task-stepper li');
    assert.equal(await pausedReleaseSteps.nth(2).evaluate(node => node.classList.contains('complete')), true, 'Pausing a checked candidate does not turn completed testing into current work.');
    assert.equal(await pausedReleaseSteps.nth(3).evaluate(node => node.classList.contains('blocked')), true, 'The paused stage follows resume_status rather than the last successful role.');
    assert.match(await pausedReleaseSteps.nth(3).innerText(), /Выпуск\s+Остановлен/);
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();

    await card(ids.question).locator('.card-open').click();
    await page.locator('#task-dialog[open]').waitFor();
    const answers = page.locator('.question-item textarea');
    await answers.first().waitFor();
    assert.equal(await answers.first().isVisible(), true, 'The answer required to resume work remains open.');
    assert.equal(await page.getByText('Уже полученный ответ.', { exact: true }).isVisible(), false, 'Answered questions start collapsed.');
    await answers.first().fill('Ответ еще не сохранен');
    tasks.find(task => task.id === ids.question).updated_at = '2026-10-10T01:03:00Z';
    await page.waitForTimeout(5200);
    assert.equal(await answers.first().inputValue(), 'Ответ еще не сохранен');
    await answers.first().fill(''); await answers.nth(1).fill('Ответ во втором вопросе');
    await page.locator('#task-detail .detail-actions-menu > summary').click();
    await page.locator('#task-detail').getByRole('button', { name: 'Редактировать', exact: true }).click();
    await page.locator('#task-detail .edit-form').getByRole('button', { name: 'Отмена', exact: true }).click();
    tasks.find(task => task.id === ids.question).updated_at = '2026-10-10T01:04:00Z';
    await page.waitForTimeout(5200);
    assert.equal(await answers.first().inputValue(), '');
    assert.equal(await answers.nth(1).inputValue(), 'Ответ во втором вопросе', 'Canceling an edit preserves a draft in any answer, including a later question when the first is empty.');
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();

    // Native desktop drag uses the browser's actual drag events and DataTransfer.
    const callsBeforeNative = moveCalls.length;
    await card(ids.gamma).locator('.card-drag-handle').dragTo(card(ids.alpha).locator('.card-drag-handle'), { targetPosition: { x: 10, y: 1 } });
    await waitOrder('inbox', [ids.gamma, ids.alpha, ids.beta, ids.unsafe]);
    assert.equal(moveCalls.length, callsBeforeNative + 1, 'One native gesture sends one move.');
    assert.deepEqual(moveCalls.at(-1), { id: ids.gamma, body: { column_id: 'inbox', before_task_id: ids.alpha, expected_status: 'inbox' } });
    await reload({ reset: false });
    await waitOrder('inbox', [ids.gamma, ids.alpha, ids.beta, ids.unsafe]);

    await reload();
    const transfer = await beginDrag(ids.alpha);
    const analysisList = lane('analysis').locator('.column-tasks');
    const analysisBox = await analysisList.boundingBox(); assert.ok(analysisBox);
    await analysisList.dispatchEvent('dragover', { dataTransfer: transfer, clientX: analysisBox.x + analysisBox.width / 2, clientY: analysisBox.y + analysisBox.height - 2 });
    assert.equal(await lane('analysis').evaluate(node => node.classList.contains('drop-allowed')), true);
    assert.equal(await lane('testing').evaluate(node => node.classList.contains('drop-blocked')), true);
    assert.equal(await page.locator('.board-drop-marker').count(), 1);
    await card(ids.alpha).evaluate(node => { window.__boardDragSource = node; });
    const pollsBefore = stateCalls;
    tasks.find(task => task.id === ids.alpha).description = 'Описание обновилось во время перетаскивания';
    await page.waitForFunction(() => document.querySelector('.connection-status') !== null);
    await page.waitForTimeout(5200);
    assert.ok(stateCalls > pollsBefore, 'State polling continues while dragging.');
    assert.equal(await card(ids.alpha).evaluate(node => node === window.__boardDragSource && node.isConnected), true, 'Polling keeps the drag source DOM alive.');
    await card(ids.alpha).dispatchEvent('dragend', { dataTransfer: transfer }); await transfer.dispose();
    await page.waitForFunction(() => !document.querySelector('.board-drop-marker'));

    await reload();
    await drop(ids.alpha, 'analysis');
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'analyzing', ids.alpha);
    assert.match(await card(ids.alpha).locator('.card-progress-title').innerText(), /Ожидает исполнителя/i, 'Being in a stage does not falsely claim that the queued run has started.');
    assert.equal(moveCalls.length, 1);
    assert.equal(moveCalls[0].body.expected_status, 'inbox');
    assert.equal(await lane('analysis').locator(`article[data-task-id="${ids.alpha}"]`).count(), 1);
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), false, 'Dropping does not accidentally open the task.');
    await drop(ids.ready, 'working');
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'developing', ids.ready);
    assert.equal(moveCalls.length, 2);
    const allowedCalls = moveCalls.length;
    await drop(ids.working, 'testing');
    await page.waitForTimeout(150);
    assert.equal(moveCalls.length, allowedCalls, 'Forbidden transitions do not send a move.');
    assert.equal(await lane('working').locator(`article[data-task-id="${ids.working}"]`).count(), 1);

    await reload();
    assert.equal(await card(ids.failedDeveloper).locator('.card-error-note').isVisible(), true, 'The stopped card exposes a concise cause.');
    assert.equal((await card(ids.failedDeveloper).innerText()).includes(unsafeReason), false, 'Raw runner errors stay out of the board.');
    assert.equal(await card(ids.failedDeveloper).locator('img, script').count(), 0, 'Failure text cannot create executable markup.');
    assert.equal(await card(ids.failedDeveloper).getByRole('button', { name: 'Повторить запуск', exact: true }).count(), 1);
    assert.equal(await card(ids.paused).getByRole('button', { name: 'Продолжить', exact: true }).count(), 1);
    assert.equal(await page.locator('button button').count(), 0, 'Recovery actions stay outside the card-open button.');
    await drop(ids.failedDeveloper, 'working');
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'developing', ids.failedDeveloper);
    assert.equal(moveCalls.length, 1, 'A failed development returns to development with one move.');
    assert.equal(moveCalls[0].body.expected_status, 'needs_attention');
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), false);
    await drop(ids.failedTester, 'working');
    assert.equal(moveCalls.length, 1, 'A stopped tester cannot bypass its recovery lane.');
    assert.equal(await card(ids.failedTester).getAttribute('data-status'), 'needs_attention');
    await drop(ids.failedTester, 'testing');
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'testing', ids.failedTester);
    assert.equal(moveCalls.length, 2, 'A failed tester returns directly to testing.');
    await drop(ids.failedAnalyst, 'analysis');
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'analyzing', ids.failedAnalyst);
    assert.equal(moveCalls.length, 3, 'A failed analyst returns directly to analysis.');

    await reload();
    await card(ids.failedDeveloper).getByRole('button', { name: 'Повторить запуск', exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'developing', ids.failedDeveloper);
    assert.equal(moveCalls.length + actionCalls.length, 1, 'A card retry requests recovery once.');
    if (actionCalls.length) assert.equal(actionCalls[0].body.action, 'retry');
    if (moveCalls.length) assert.deepEqual(moveCalls[0].body, { column_id: 'working', before_task_id: null, expected_status: 'needs_attention' });
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), false, 'A recovery click does not open the task.');
    await card(ids.paused).getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'developing', ids.paused);
    assert.equal(moveCalls.length + actionCalls.length, 2, 'A paused card resumes once.');
    if (actionCalls.length) assert.equal(actionCalls.at(-1).body.action, 'resume');

    await reload();
    let heldStarted; let releaseHeld;
    const heldReady = new Promise(resolve => { heldStarted = resolve; });
    const heldRelease = new Promise(resolve => { releaseHeld = resolve; });
    holdStatePoll = { started: heldStarted, release: heldRelease };
    await heldReady;
    const retryResponse = page.waitForResponse(response => response.url().endsWith(`/api/tasks/${ids.failedDeveloper}/action`) && response.request().method() === 'POST');
    try {
      await card(ids.failedDeveloper).getByRole('button', { name: 'Повторить запуск', exact: true }).click();
      await retryResponse;
      assert.equal(tasks.find(task => task.id === ids.failedDeveloper).status, 'developing', 'The quick retry commits while an old board poll is in flight.');
    } finally { releaseHeld(); }
    await page.waitForRequest(request => new URL(request.url()).pathname === '/team/api/state', { timeout: 2000 });
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'developing', ids.failedDeveloper, { timeout: 2000 });
    assert.equal(actionCalls.length, 1, 'A stale in-flight poll is followed by a fresh state request without repeating the retry.');
    assert.equal(moveCalls.length, 0);

    await reload();
    tasks.find(task => task.id === ids.failedDeveloper).board_last_failure.error = null;
    await reload({ reset: false });
    const noCurrentError = await card(ids.failedDeveloper).locator('.card-error-note').innerText();
    assert.ok(noCurrentError.trim(), 'An unknown cause still has a useful recovery message.');
    assert.equal(noCurrentError.includes(unsafeReason), false, 'The card respects an authoritative empty current error.');
    await card(ids.failedDeveloper).locator('.card-open').click();
    await page.locator('#task-dialog[open]').waitFor();
    assert.equal(await page.locator('#task-detail .task-stop-reason .cause-text').innerText(), noCurrentError, 'The current failure note cannot fall back to a previous run error.');
    assert.equal(await page.locator('#task-detail .task-stop-reason').getAttribute('role'), 'alert');
    assert.equal(await page.locator('#task-detail .run-item .run-error').isVisible(), false, 'A historical error starts collapsed.');
    await openDisclosure('reports');
    assert.equal(await page.locator('#task-detail .run-item .run-error').innerText(), unsafeReason, 'The old error remains available only in its historical run.');
    assert.equal(await page.locator('#task-detail .run-item').locator('img, script').count(), 0, 'Expanding raw reports cannot execute error markup.');
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();

    await reload();
    failAction = { status: 503, message: 'Исполнитель временно недоступен. Повтори позже.' };
    await card(ids.failedDeveloper).getByRole('button', { name: 'Повторить запуск', exact: true }).click();
    await page.locator('.toast.error').getByText(failAction?.message || 'Исполнитель временно недоступен. Повтори позже.', { exact: true }).waitFor();
    assert.equal(await card(ids.failedDeveloper).getAttribute('data-status'), 'needs_attention', 'A failed recovery request leaves the task in attention.');
    assert.equal(await card(ids.failedDeveloper).getByRole('button', { name: 'Повторить запуск', exact: true }).isEnabled(), true, 'The card action becomes available after a recovery error.');
    assert.equal(actionCalls.length, 1, 'Recovery errors do not trigger an automatic repeat.');
    assert.equal(moveCalls.length, 0);

    await reload();
    await card(ids.failedTester).locator('.card-move-button').click();
    await page.locator('#move-dialog[open]').waitFor();
    assert.deepEqual(await page.locator('#move-column option').evaluateAll(options => options.filter(option => !option.disabled).map(option => option.value)), ['attention', 'testing']);
    await page.locator('#move-column').selectOption('testing');
    assert.match(await page.locator('#move-note').innerText(), /повтор|провер|тест/i, 'The menu explains tester recovery.');
    await page.locator('#move-dialog button[type="submit"]').click();
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'testing', ids.failedTester);
    assert.equal(moveCalls.length, 1, 'The menu starts the correct recovery role.');

    await reload();
    await card(ids.release).getByRole('button', { name: 'Проверить результат', exact: true }).click();
    await page.locator('#task-dialog[open]').waitFor();
    assert.equal(await page.locator('#task-detail .detail-title').innerText(), 'Проверенная задача');
    const releaseSteps = page.locator('#task-progress .task-stepper li');
    assert.equal(await releaseSteps.nth(2).evaluate(node => node.classList.contains('complete')), true, 'A ready candidate has completed testing.');
    assert.equal(await releaseSteps.nth(3).evaluate(node => node.classList.contains('current')), true, 'Publication remains the current outstanding step.');
    assert.equal(await releaseSteps.nth(3).evaluate(node => node.classList.contains('complete')), false, 'A checked candidate has not been published yet.');
    assert.match(await releaseSteps.nth(3).innerText(), /Выпуск\s+Ожидание/);
    await page.locator('#task-detail .release-result').getByRole('heading', { name: 'Результат для выпуска', exact: true }).waitFor();
    assert.match(await page.locator('#task-detail .release-result').innerText(), /публикац.*не настроен/i, 'The release detail explains why publication is blocked.');
    assert.equal(await page.locator('#task-detail').getByRole('button', { name: 'Подтвердить выпуск', exact: true }).count(), 0, 'Unavailable publication never exposes a confirmation action.');
    const downloads = page.locator('#task-detail a[download], #task-detail a[href*="/api/tasks/"][href$="/patch"]');
    assert.equal(await downloads.count(), 0, 'The task UI does not offer downloads or patch links.');
    assert.equal(await page.locator('#task-detail').getByRole('link', { name: 'Скачать изменения', exact: true }).count(), 0);
    for (const key of ['artifact', 'reports', 'history', 'usage']) assert.equal(await disclosure(key).evaluate(node => node.open), false, `${key} remains collapsed on first open.`);
    assert.equal(await page.getByText(privateReport, { exact: true }).isVisible(), false, 'Long QA reports do not crowd the publication next step.');
    assert.equal(await page.locator('#task-detail .artifact-card').isVisible(), false, 'Raw artifacts start collapsed.');
    assert.equal((await page.locator('#task-detail').innerText()).includes(privateArtifact), false);
    await openDisclosure('artifact');
    assert.ok((await disclosure('artifact').innerText()).includes(privateArtifact), 'The original artifact remains accessible.');
    assert.equal(await downloads.count(), 0, 'Expanding artifacts does not expose downloads or patch links.');
    await openDisclosure('reports');
    assert.equal(await page.getByText(privateReport, { exact: true }).isVisible(), true, 'The checked result remains available for review.');
    assert.equal(await downloads.count(), 0, 'Expanding reports does not expose downloads or patch links.');
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();
    await page.locator('[data-filter="all"]').click();
    await drop(ids.release, 'done');
    assert.equal(moveCalls.length, 0, 'Reviewing a checked candidate cannot mark it published.');
    assert.equal(actionCalls.length, 0, 'Reviewing a checked candidate never requests a release.');
    assert.equal(await card(ids.release).getAttribute('data-status'), 'ready_release');

    await reload();
    failMove = { status: 409, message: 'Задача уже изменилась. Обнови доску.' };
    await drop(ids.alpha, 'analysis');
    await page.locator('.toast.error').getByText('Задача уже изменилась. Обнови доску.', { exact: true }).waitFor();
    await waitOrder('inbox', [ids.alpha, ids.beta, ids.gamma, ids.unsafe]);
    assert.equal(await card(ids.alpha).getAttribute('data-status'), 'inbox');
    assert.equal(moveCalls.length, 1);
    assert.equal(await page.locator('.board-drop-marker').count(), 0);

    await reload();
    failMove = { status: 409, message: 'Запуск уже начался. Перемещение на другой этап недоступно.' };
    await drop(ids.ready, 'working');
    await page.locator('.toast.error').getByText('Запуск уже начался. Перемещение на другой этап недоступно.', { exact: true }).waitFor();
    assert.equal(await lane('ready').locator(`article[data-task-id="${ids.ready}"]`).count(), 1);
    assert.equal(await card(ids.ready).getAttribute('data-status'), 'ready');
    assert.equal(moveCalls.length, 1);

    await reload();
    const moveButton = card(ids.alpha).getByRole('button', { name: 'Переместить задачу Первая идея', exact: true });
    await moveButton.focus(); await page.keyboard.press('Enter');
    const moveDialog = page.locator('#move-dialog'); await page.locator('#move-dialog[open]').waitFor();
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), false);
    assert.deepEqual(await page.locator('#move-column option').evaluateAll(options => options.filter(option => !option.disabled).map(option => option.value)), ['inbox', 'analysis']);
    assert.equal(await page.locator(`#move-before option[value="${ids.alpha}"]`).count(), 0);
    await page.locator('#move-column').selectOption('inbox');
    await page.locator('#move-before').selectOption(ids.gamma);
    await moveDialog.locator('button[type="submit"]').click();
    await waitOrder('inbox', [ids.beta, ids.alpha, ids.gamma, ids.unsafe]);
    assert.equal(moveCalls.length, 1);
    assert.equal(await moveDialog.evaluate(node => node.open), false);
    await card(ids.alpha).locator('.card-move-button').click();
    await page.keyboard.press('Escape');
    assert.equal(await moveDialog.evaluate(node => node.open), false);

    await reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await card(ids.alpha).locator('.card-move-button').click();
    await page.locator('#move-column').selectOption('analysis');
    assert.equal(await moveDialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
    assert.equal(await page.locator('body').evaluate(node => node.scrollWidth > innerWidth), false);
    await moveDialog.locator('button[type="submit"]').click();
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'analyzing', ids.alpha);
    assert.equal(moveCalls.length, 1, 'The mobile menu starts the approved stage once.');
    await card(ids.alpha).locator('.card-open').click();
    await page.locator('#task-dialog[open]').waitFor();
    assert.equal(await page.locator('#task-detail .detail-title').innerText(), 'Первая идея');
    await page.getByRole('button', { name: 'Закрыть задачу', exact: true }).click();
    const mobileRetry = card(ids.failedTester).getByRole('button', { name: 'Повторить запуск', exact: true });
    await mobileRetry.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(id => document.querySelector(`article[data-task-id="${id}"]`)?.dataset.status === 'testing', ids.failedTester);
    assert.equal(moveCalls.length + actionCalls.length, 2, 'The recovery button works with the keyboard at the mobile breakpoint.');
    await card(ids.release).getByRole('button', { name: 'Проверить результат', exact: true }).click();
    await page.locator('#task-dialog[open]').waitFor();
    assert.equal(await page.locator('#task-detail .detail-title').innerText(), 'Проверенная задача');
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.scrollWidth > node.clientWidth), false, 'Release review fits the mobile dialog.');
    await openDisclosure('artifact');
    await openDisclosure('reports');
    assert.equal(await page.locator('#task-detail a[download], #task-detail a[href*="/api/tasks/"][href$="/patch"]').count(), 0, 'The mobile task UI also has no download action.');
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.scrollWidth > node.clientWidth), false, 'Expanded reports and artifacts fit the mobile dialog.');
    assert.deepEqual(errors, []);
    console.log('PASS: compact cards; collapsed description, plan, reports, artifacts, history and usage; keyboard expansion with preserved state; truthful stage progress; queued, silent and unconfirmed runs; paused release resume stage; visible owner questions; preserved edit and later-question drafts; native drag and persisted order; approved stage and recovery moves; developer/tester/analyst recovery; retry and resume actions; fresh state after stale poll; authoritative empty failure cause; safe raw reports; checked candidate awaiting publication without download actions; invalid drop guards; keyboard and mobile controls; safe text and no nested buttons.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
