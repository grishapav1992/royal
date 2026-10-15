'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const basePath = location.pathname.startsWith('/team') ? '/team/' : new URL('.', location.href).pathname;
  $('.sidebar .brand').href = basePath;
  let setupToken = new URLSearchParams(location.search).get('setup');
  const STATUS = {
    inbox: 'Входящая', analyzing: 'Анализ', needs_answers: 'Нужен ответ', ready: 'Готова к разработке',
    developing: 'Разработка', testing: 'Тестирование', repairing: 'Исправление', ready_release: 'Готова к выпуску',
    releasing: 'Выпуск', done: 'Завершена', needs_attention: 'Нужно внимание', paused: 'На паузе', cancelled: 'Отменена'
  };
  const ROLE = { analyst: 'Аналитик', manager: 'Аналитик', developer: 'Разработчик', tester: 'Тестировщик', testing: 'Тестировщик', release: 'Выпуск', deployer: 'Выпуск' };
  const EFFORT = { low: 'Низкая', medium: 'Средняя', high: 'Высокая', xhigh: 'Очень высокая' };
  const PROFILE_ROLES = ['analyst', 'developer', 'tester'];
  const RUN_STATUS = { queued: 'В очереди', pending: 'Ожидание', running: 'В работе', completed: 'Завершен', success: 'Завершен', succeeded: 'Завершен', done: 'Завершен', failed: 'Ошибка', error: 'Ошибка', cancelled: 'Отменен', interrupted: 'Прерван', paused: 'Пауза' };
  const LANES = [
    { id: 'attention', title: 'Нужно внимание', statuses: ['needs_attention', 'paused', 'cancelled'] },
    { id: 'inbox', title: 'Входящие', statuses: ['inbox'] },
    { id: 'analysis', title: 'Анализ', statuses: ['analyzing', 'needs_answers'] },
    { id: 'ready', title: 'Очередь', statuses: ['ready'] },
    { id: 'working', title: 'Разработка', statuses: ['developing', 'repairing'] },
    { id: 'testing', title: 'Тестирование', statuses: ['testing'] },
    { id: 'release', title: 'Выпуск', statuses: ['ready_release', 'releasing'] },
    { id: 'done', title: 'Завершены', statuses: ['done'] }
  ];
  const state = { authenticated: false, connected: false, detailConnected: true, tasks: [], settings: {}, roleCatalog: {}, profileDraft: null, profilesDirty: false, profilesSaving: false, profilesVersion: 0, profileSignature: '', profileMessage: '', runtime: {}, usage: null, filter: 'active', search: '', taskId: null, task: null, progressTask: null, detailDirty: false, signature: '', fetching: false, deviceLogin: false, lastDeviceSignature: '' };
  let deviceTimer = null;
  let stateLoadDone = null;
  let stateLoadResolve = null;
  const boardMoveState = { drag: null, moving: false, task: null, marker: null, suppressClickUntil: 0 };
  const knowledgeState = { data: null, selectedId: null, request: 0, timer: null, fetching: false, query: '', renderSignature: '' };
  const usageState = { signature: '', requesting: false, requestedAt: null, message: '' };
  const KNOWLEDGE_STATUS = { verified: 'Подтверждено', decision: 'Решение', candidate: 'Ожидает выпуска', planned: 'План' };
  const KNOWLEDGE_ENVIRONMENT = { project: 'Проект', production: 'Рабочий сервер', sandbox: 'Песочница', testnet: 'Тестовая сеть', candidate: 'Кандидат на выпуск' };
  const KNOWLEDGE_TYPE = { project: 'Проект', service: 'Сервис', integration: 'Интеграция', mechanic: 'Механика', document: 'Документ', decision: 'Решение', task: 'Задача', candidate: 'Кандидат на выпуск' };
  const KNOWLEDGE_PREDICATE = { integrates: 'Интегрирует', uses: 'Использует', documents: 'Описывает', requires: 'Требует', implements: 'Реализует', decides: 'Определяет решение', has_candidate: 'Имеет кандидата на выпуск', tested_by: 'Проверено' };

  function shortId(id) {
    if (!id) return '';
    return `ИИ-${String(id).slice(0, 8).toUpperCase()}`;
  }
  function priority(value) { return /^P[0-3]$/.test(String(value)) ? String(value) : /^[0-3]$/.test(String(value)) ? `P${value}` : 'P2'; }
  function hasContent(value) { return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value && Object.keys(value).length); }
  function date(value, long = false) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', long ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(parsed);
  }
  function age(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null;
  }
  function duration(milliseconds) {
    if (milliseconds === null) return 'нет данных';
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) return `${seconds} с`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} мин ${seconds % 60} с`;
    return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  }
  function activeRun(task) {
    const run = task.active_run;
    return run?.status === 'running' && ['analyzing', 'developing', 'testing', 'repairing', 'releasing'].includes(task.status) ? run : null;
  }
  function workInfo(task, detail = false) {
    const run = activeRun(task);
    const progress = run?.progress;
    const elapsed = age(run?.started_at);
    const activityAge = age(progress?.last_activity_at);
    const leaseExpired = run?.lease_expires_at && Date.parse(run.lease_expires_at) <= Date.now();
    const disconnected = !state.connected || detail && !state.detailConnected;
    const unavailable = state.runtime.available === false || state.runtime.authenticated === false || state.runtime.stale || leaseExpired;
    if (disconnected) return { run, progress, elapsed, activityAge, kind: 'warning', animate: false, title: 'Связь с панелью потеряна', note: 'Показаны последние полученные данные. Текущее выполнение пока не подтверждено.' };
    if (task.status === 'paused') return { kind: 'waiting', title: 'Задача на паузе', note: 'Работа продолжится после команды «Продолжить».' };
    if (task.status === 'needs_attention') return task.artifact?.tester?.verification_blocked
      ? { kind: 'warning', title: 'Проверка не завершена', note: 'Повтори проверку после устранения причины.' }
      : { kind: 'warning', title: 'Работа остановилась', note: 'Причина указана ниже.' };
    if (task.status === 'cancelled') return { kind: 'waiting', title: 'Задача отменена', note: 'Исполнитель больше не выполняет эту задачу.' };
    if (task.status === 'ready_release' || task.status === 'done') return { kind: 'complete', title: task.status === 'done' ? 'Задача завершена' : 'Разработка и проверка завершены', note: task.status === 'done' ? 'Выпуск завершен.' : state.runtime.release_enabled === false ? 'Готова к выпуску. Публикация пока отключена.' : 'Готова к выпуску. Ожидает подтверждения публикации.' };
    if (!run) {
      const messages = { inbox: ['Ожидает передачи аналитику', 'Передай задачу на анализ, чтобы команда начала работу.'], needs_answers: ['Ожидает твоего ответа', 'Ответы нужны для продолжения анализа.'], ready: ['Готова к разработке', 'Ожидает запуска разработки.'] };
      const message = messages[task.status] || [state.settings.paused ? 'Ожидает снятия паузы команды' : 'Ожидает исполнителя', 'Запуск еще не начался.'];
      return { kind: 'waiting', title: message[0], note: message[1] };
    }
    if (unavailable) return { run, progress, elapsed, activityAge, kind: 'warning', animate: false, title: leaseExpired ? 'Связь с запуском не подтверждена' : 'Исполнитель недоступен', note: 'Новая активность пока не подтверждена. Система проверяет состояние запуска.' };
    if (!progress?.phase || !progress.updated_at) return { run, elapsed, kind: 'waiting', animate: false, title: `${ROLE[run.role] || 'Исполнитель'} запущен`, note: 'Детали активности этого запуска пока не получены.' };
    const phaseLabels = { preparing: 'Готовим рабочую копию', build: 'Проверяем сборку', server_tests: 'Запускаем серверные тесты', browser_tests: 'Проверяем игру в браузере', saving: 'Сохраняем результат' };
    const roleActivity = { analyst: 'Изучает задачу', developer: 'Пишет и проверяет код', tester: 'Проверяет результат' }[run.role] || 'Работает над задачей';
    const activityLabels = { starting: 'Начинает работу', thinking: roleActivity, tool_running: 'Выполняет действие', tool_completed: roleActivity, responding: 'Подготавливает результат' };
    const title = phaseLabels[progress.phase] || activityLabels[progress.activity_kind] || `${ROLE[run.role] || 'Исполнитель'} работает`;
    const phaseAge = age(progress.phase_started_at || progress.updated_at);
    const silence = progress.phase === 'model' ? activityAge ?? phaseAge : phaseAge;
    if (silence !== null && silence >= 120000) return { run, progress, elapsed, activityAge, kind: 'warning', animate: false, title: `Нет новой активности ${duration(silence)}`, note: 'Проверяем состояние запуска.' };
    return { run, progress, elapsed, activityAge, kind: 'active', animate: true, title, note: state.settings.paused ? 'Пауза команды касается новых запусков. Этот запуск продолжает работу.' : 'Время завершения пока неизвестно.' };
  }
  function taskSteps(task) {
    const run = activeRun(task);
    const runs = (task.runs || []).filter(run => task.requirements_version === undefined || task.requirements_version === null || String(run.requirements_version) === String(task.requirements_version));
    const stopped = ['needs_attention', 'paused', 'cancelled'].includes(task.status);
    const effectiveStatus = ['paused', 'cancelled'].includes(task.status) ? task.resume_status || task.status : task.status;
    const confirmed = state.connected && state.detailConnected && state.runtime.available !== false && state.runtime.authenticated !== false && !state.runtime.stale && (!run?.lease_expires_at || Date.parse(run.lease_expires_at) > Date.now());
    const statusIndex = { analyzing: 0, needs_answers: 0, ready: 1, developing: 1, repairing: 1, testing: 2, ready_release: 3, releasing: 3, done: 3 }[effectiveStatus];
    const failedRole = task.status === 'needs_attention' ? task.board_last_failure?.role || runs.at(-1)?.role : null;
    const roleIndex = { analyst: 0, manager: 0, developer: 1, tester: 2, testing: 2, release: 3, deployer: 3 }[run?.role || failedRole];
    const current = roleIndex ?? statusIndex;
    const success = role => ['succeeded', 'completed', 'success', 'done'].includes(runs.filter(item => item.role === role).at(-1)?.status);
    const developmentSucceeded = ['testing', 'ready_release', 'releasing', 'done'].includes(effectiveStatus) || current !== 1 && success('developer');
    return ['Анализ', 'Разработка', 'Тестирование', 'Выпуск'].map((label, index) => {
      const complete = index === 0 ? current > 0 || success('analyst') : index === 1 ? developmentSucceeded : index === 2 ? ['ready_release', 'releasing', 'done'].includes(effectiveStatus) : effectiveStatus === 'done';
      const active = !complete && current === index;
      const description = complete ? 'Завершен' : !active ? 'Предстоит' : stopped ? 'Остановлен' : run ? confirmed ? 'В работе' : 'Не подтверждено' : task.status === 'needs_answers' ? 'Нужен ответ' : 'Ожидание';
      return { label, kind: complete ? 'complete' : active ? stopped ? 'blocked' : 'current' : 'pending', description };
    });
  }
  function renderTaskProgress(container, task) {
    const info = workInfo(task, true);
    container.className = `task-progress ${info.kind}`;
    if (!$('.task-stepper', container)) {
      const flow = el('ol', 'task-stepper'); flow.setAttribute('aria-label', 'Этапы задачи');
      const heading = el('p', 'progress-heading'); heading.setAttribute('role', 'status');
      const bar = el('div', 'activity-bar'); bar.setAttribute('aria-hidden', 'true'); bar.append(el('span'));
      container.append(flow, heading, bar, el('div', 'progress-metrics'), el('p', 'progress-note current-note'));
    }
    const steps = taskSteps(task);
    const flow = $('.task-stepper', container);
    const flowSignature = JSON.stringify(steps);
    if (flow.dataset.signature !== flowSignature) {
      flow.dataset.signature = flowSignature; flow.replaceChildren();
      steps.forEach((step, index) => {
        const item = el('li', `task-step ${step.kind}`);
        if (step.kind === 'current' || step.kind === 'blocked') item.setAttribute('aria-current', 'step');
        const marker = el('span', 'step-marker', step.kind === 'complete' ? '✓' : index + 1); marker.setAttribute('aria-hidden', 'true');
        const text = el('span', 'step-text'); text.append(el('strong', '', step.label), el('span', '', step.description)); item.append(marker, text); flow.append(item);
      });
    }
    const heading = $('.progress-heading', container);
    if (heading.textContent !== info.title) heading.textContent = info.title;
    $('.activity-bar', container).classList.toggle('moving', Boolean(info.animate));
    const metrics = $('.progress-metrics', container); metrics.replaceChildren();
    if (info.run) metrics.append(el('span', '', `В работе ${duration(info.elapsed)}`));
    const note = $('.current-note', container);
    const showNote = info.kind === 'warning' && task.status !== 'needs_attention' || info.kind === 'active';
    note.hidden = !showNote; note.textContent = showNote ? info.note : '';
    heading.hidden = ['needs_attention', 'ready_release', 'done'].includes(task.status) && state.connected && state.detailConnected;
    $('.activity-bar', container).hidden = !info.run;
  }

  function renderCardProgress(container, task) {
    const info = workInfo(task);
    container.className = `card-progress ${info.kind}`;
    container.replaceChildren(el('span', 'card-progress-title', info.title));
    if (info.run) container.append(el('span', '', `В работе ${duration(info.elapsed)}`));
  }
  function refreshProgressDisplays() {
    $$('[data-progress-task]').forEach(container => {
      const task = state.tasks.find(item => item.id === container.dataset.progressTask);
      if (task) renderCardProgress(container, task);
    });
    const detail = $('#task-progress');
    if (detail && state.progressTask && $('#task-dialog').open) renderTaskProgress(detail, state.progressTask);
  }
  function detailSignature(task) {
    return JSON.stringify({ ...task, active_run: null, runs: (task.runs || []).map(run => ({ ...run, progress: null, lease_expires_at: null })) });
  }
  function badge(status) {
    const node = el('span', 'status-badge', STATUS[status] || RUN_STATUS[status] || status || 'Ожидание');
    if (['analyzing', 'developing', 'testing', 'repairing', 'releasing', 'running'].includes(status)) node.classList.add('active-status');
    if (status === 'needs_answers') node.classList.add('question-status');
    if (status === 'ready_release') node.classList.add('release-status');
    if (['needs_attention', 'failed', 'error'].includes(status)) node.classList.add('error-status');
    if (['done', 'completed', 'success', 'succeeded'].includes(status)) node.classList.add('done-status');
    return node;
  }
  function priorityBadge(value) {
    const p = priority(value);
    const node = el('span', `priority-badge ${p.toLowerCase()}`, { P0: 'Срочно', P1: 'Важно', P2: 'Плановая', P3: 'Идея' }[p]);
    node.title = { P0: 'Критично', P1: 'Важно', P2: 'Плановое развитие', P3: 'Эксперимент' }[p];
    return node;
  }
  function toast(message, error = false, taskId = null) {
    const item = el('div', `toast${error ? ' error' : ''}`, message);
    if (taskId) {
      const open = el('button', 'toast-action', 'Открыть задачу'); open.type = 'button';
      open.addEventListener('click', () => { openTask(taskId); item.remove(); });
      item.append(open);
    }
    $('#toast-region').append(item);
    setTimeout(() => item.remove(), taskId ? 12000 : 5500);
  }
  function linkedTaskId() {
    const id = new URLSearchParams(location.hash.slice(1)).get('task');
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '') ? id : null;
  }
  function renderAttention() {
    const tasks = state.tasks.filter(task => task.status === 'needs_attention')
      .sort((a, b) => priority(a.priority).localeCompare(priority(b.priority)));
    const notice = $('#attention-notice'); notice.replaceChildren(); notice.hidden = !tasks.length;
    if (!tasks.length) return;
    notice.append(el('strong', '', tasks.length === 1 ? 'Задача требует внимания' : `Требуют внимания: ${tasks.length}`));
    tasks.slice(0, 1).forEach(task => {
      const open = el('button', 'button quiet small', task.title); open.type = 'button';
      open.addEventListener('click', () => openTask(task.id)); notice.append(open);
    });
  }
  function setError(selector, error) {
    const node = $(selector);
    node.textContent = error || '';
    node.hidden = !error;
  }
  function showLogin() {
    state.authenticated = false; state.connected = false;
    state.usage = null; usageState.signature = ''; usageState.requestedAt = null; usageState.message = '';
    state.profileDraft = null; state.profilesDirty = false; state.profileSignature = ''; state.profileMessage = '';
    knowledgeState.data = null; knowledgeState.selectedId = null; knowledgeState.query = ''; knowledgeState.renderSignature = '';
    $('#knowledge-summary').hidden = true; $('#knowledge-projection').hidden = true; $('#knowledge-conflicts').hidden = true; $('#knowledge-content').hidden = true;
    stopDevicePolling();
    $$('dialog[open]').forEach(dialog => dialog.close());
    $('#boot').hidden = true;
    $('#workspace').hidden = true;
    $('#login-screen').hidden = false;
    $('#login-password').value = '';
    if (setupToken) {
      $('#login-title').textContent = 'Создадим твою команду';
      $('#login-description').textContent = 'Укажи почту и задай пароль от 12 до 128 символов.';
      $('#login-help').textContent = 'Эта ссылка предназначена для первой настройки. После установки вход будет доступен с твоим паролем.';
      $('#login-password').autocomplete = 'new-password';
      $('#login-password').minLength = 12;
      $('#login-password').placeholder = 'Придумай пароль';
      $('#login-form button[type="submit"]').textContent = 'Создать пространство';
    } else {
      $('#login-title').textContent = 'С возвращением';
      $('#login-description').textContent = 'Введи почту и пароль, чтобы открыть задачи.';
      $('#login-help').textContent = 'Доступ только для владельца проекта.';
      $('#login-password').autocomplete = 'current-password';
      $('#login-password').removeAttribute('minlength');
      $('#login-password').placeholder = 'Пароль панели';
      $('#login-form button[type="submit"]').textContent = 'Войти';
    }
  }
  async function api(path, options = {}) {
    const response = await fetch(`${basePath}api/${path}`, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    const contentType = response.headers.get('content-type') || '';
    let body;
    if (contentType.includes('application/json')) body = await response.json();
    else body = { error: 'Сервер вернул неожиданный ответ. Попробуй еще раз.' };
    if (!response.ok) {
      if (response.status === 401 && !['session', 'setup', 'bootstrap'].includes(path)) showLogin();
      const error = new Error(typeof body.error === 'string' ? body.error : body.error?.message || body.message || `Не удалось выполнить запрос (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function knowledgeDate(value) {
    const parsed = new Date(value || '');
    return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
  }
  function knowledgeTags(record) {
    const tags = el('div', 'knowledge-tags');
    if (record.status) {
      const tag = el('span', 'knowledge-tag', KNOWLEDGE_STATUS[record.status] || record.status);
      if (Object.hasOwn(KNOWLEDGE_STATUS, record.status)) tag.classList.add(`knowledge-status-${record.status}`);
      tags.append(tag);
    }
    if (record.environment) tags.append(el('span', 'knowledge-tag', KNOWLEDGE_ENVIRONMENT[record.environment] || record.environment));
    return tags;
  }
  function knowledgeSources(record) {
    const sources = el('details', 'knowledge-sources');
    const evidence = Array.isArray(record.evidence) ? record.evidence : [];
    sources.append(el('summary', '', `Источники: ${evidence.length}`));
    if (!evidence.length) sources.append(el('p', 'muted', 'Источник для этой записи не указан.'));
    evidence.forEach(source => {
      const row = el('div', 'knowledge-source');
      row.append(el('span', 'knowledge-source-path', source.path || 'Путь не указан'));
      if (source.sha256) row.append(el('code', 'knowledge-hash', `SHA-256: ${source.sha256}`));
      const task = /^task:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/i.exec(source.path || '');
      if (task) {
        const open = el('button', 'button quiet small', 'Открыть задачу'); open.type = 'button';
        open.addEventListener('click', () => { $('#knowledge-dialog').close(); openTask(task[1]); }); row.append(open);
      }
      sources.append(row);
    });
    if (record.event_id) sources.append(el('code', 'knowledge-hash', `Запись истории: ${record.event_id}`));
    return sources;
  }
  function selectKnowledgeNode(id) {
    knowledgeState.selectedId = id;
    $$('#knowledge-nodes button').forEach(button => {
      const selected = button.dataset.nodeId === id;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
    renderKnowledgeDetail();
  }
  function renderKnowledgeDetail() {
    const container = $('#knowledge-detail'); container.replaceChildren();
    const data = knowledgeState.data;
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    const node = nodes.find(item => item.id === knowledgeState.selectedId);
    if (!node) { container.append(el('p', 'knowledge-empty', nodes.length ? 'Выбери сущность из списка.' : 'По этому запросу ничего не найдено. Попробуй другое название или очисти поиск.')); return; }
    container.append(el('span', 'eyebrow', KNOWLEDGE_TYPE[node.entity_type] || node.entity_type || 'Сущность'), el('h3', 'knowledge-node-title', node.name || node.id), knowledgeTags(node));
    if (node.summary) container.append(el('p', 'knowledge-node-description', node.summary));
    container.append(knowledgeSources(node));
    const edges = (Array.isArray(data.edges) ? data.edges : []).filter(edge => edge.source === node.id || edge.target === node.id);
    container.append(el('h3', 'knowledge-relations-heading', `Связи: ${edges.length}`));
    if (!edges.length) { container.append(el('p', 'muted knowledge-empty', 'В этом снимке нет связей для выбранной сущности.')); return; }
    const relations = el('ul', 'knowledge-relations');
    edges.forEach(edge => {
      const outgoing = edge.source === node.id;
      const neighborId = outgoing ? edge.target : edge.source;
      const neighbor = nodes.find(item => item.id === neighborId);
      const item = el('li', 'knowledge-relation');
      const heading = el('div', 'knowledge-relation-heading');
      heading.append(el('span', 'knowledge-relation-direction', outgoing ? 'Исходящая связь' : 'Входящая связь'), el('strong', '', KNOWLEDGE_PREDICATE[edge.predicate] || edge.predicate || 'Связано'));
      const connection = el('div', 'knowledge-connection');
      const selected = el('span', 'knowledge-connection-current', node.name || node.id);
      const arrow = el('span', 'knowledge-arrow', '→'); arrow.setAttribute('aria-hidden', 'true');
      const neighborLabel = neighbor?.name || neighborId;
      const linked = neighbor ? el('button', 'knowledge-neighbor', neighborLabel) : el('span', 'knowledge-missing-neighbor', neighborLabel);
      if (neighbor) { linked.type = 'button'; linked.addEventListener('click', () => selectKnowledgeNode(neighborId)); }
      if (outgoing) connection.append(selected, arrow, linked); else connection.append(linked, arrow, selected);
      item.append(heading, connection);
      if (edge.text) item.append(el('p', 'knowledge-relation-text', edge.text));
      item.append(knowledgeTags(edge), knowledgeSources(edge));
      if (knowledgeDate(edge.created_at)) item.append(el('p', 'knowledge-record-date', `Добавлено: ${knowledgeDate(edge.created_at)}`));
      relations.append(item);
    });
    container.append(relations);
  }
  function renderKnowledge(data) {
    const signature = JSON.stringify({ ...data, generated_at: null });
    const snapshotTime = knowledgeDate(data.generated_at);
    if (signature === knowledgeState.renderSignature) {
      $('#knowledge-snapshot-time').textContent = snapshotTime ? `Снимок сформирован: ${snapshotTime}` : 'Время формирования снимка не указано.';
      return;
    }
    knowledgeState.renderSignature = signature;
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
    const summary = $('#knowledge-summary'); summary.replaceChildren(); summary.hidden = false;
    [[nodes.length, 'Сущностей показано'], [edges.length, 'Связей показано'], [conflicts.length, 'Конфликтов']].forEach(([count, label]) => {
      const metric = el('div', 'knowledge-metric'); metric.append(el('strong', '', count), el('span', '', label)); summary.append(metric);
    });
    const projection = $('#knowledge-projection'); projection.replaceChildren(); projection.hidden = false;
    const projectionStatus = data.projection?.status;
    const projectionLabel = { ready: 'Граф готов', pending: 'Обновление графа ожидается', unavailable: 'Графовая база недоступна' }[projectionStatus] || 'Состояние графовой базы не получено';
    const projectionHeading = el('p', 'knowledge-projection-heading');
    const dot = el('span', `status-dot${projectionStatus === 'ready' ? ' good' : projectionStatus === 'unavailable' ? ' bad' : ''}`); dot.setAttribute('aria-hidden', 'true');
    projectionHeading.append(dot, el('strong', '', `${projectionLabel}${data.projection?.engine === 'graphiti' ? ' · Graphiti' : ''}`)); projection.append(projectionHeading);
    if (projectionStatus === 'unavailable') projection.append(el('p', 'knowledge-freshness', 'Показан сохраненный снимок знаний. Доступность графовой базы сейчас не подтверждена.'));
    if (projectionStatus === 'pending') projection.append(el('p', 'knowledge-freshness', 'Снимок знаний доступен. Перенос последней версии в графовую базу еще не подтвержден.'));
    if (typeof data.projection?.error === 'string' && data.projection.error) projection.append(el('p', 'knowledge-projection-error', data.projection.error.slice(0, 500)));
    const snapshotDate = el('p', 'knowledge-freshness', snapshotTime ? `Снимок сформирован: ${snapshotTime}` : 'Время формирования снимка не указано.'); snapshotDate.id = 'knowledge-snapshot-time'; projection.append(snapshotDate);
    const projectedTime = knowledgeDate(data.projection?.last_projected_at);
    if (projectedTime) projection.append(el('p', 'knowledge-freshness', `Графовая база обновлена: ${projectedTime}`));
    const syncTime = knowledgeDate(data.sync?.last_exchange_at);
    projection.append(el('p', 'knowledge-freshness', syncTime ? `Последний обмен с локальным графом: ${syncTime}` : 'Обмен с локальным графом пока не зафиксирован.'));
    if (Number.isInteger(data.sync?.event_count)) projection.append(el('p', 'knowledge-freshness', `Записей в истории: ${data.sync.event_count}`));
    if (data.hash) { const version = el('details', 'knowledge-version'); version.append(el('summary', '', 'Версия снимка'), el('code', 'knowledge-hash', data.hash)); projection.append(version); }
    const conflictPanel = $('#knowledge-conflicts'); conflictPanel.replaceChildren(); conflictPanel.hidden = !conflicts.length;
    if (conflicts.length) {
      conflictPanel.append(el('h3', '', 'Есть конфликтующие версии'), el('p', '', 'Для одной записи сохранено несколько версий. Нужно определить актуальную версию.'));
      const list = el('ul');
      conflicts.forEach(conflict => {
        const item = el('li'); item.append(el('strong', '', conflict.record_id || 'Запись'));
        if (Array.isArray(conflict.event_ids)) item.append(el('span', '', `История: ${conflict.event_ids.join(', ')}`)); list.append(item);
      }); conflictPanel.append(list);
    }
    const list = $('#knowledge-nodes'); list.replaceChildren();
    if (!nodes.some(node => node.id === knowledgeState.selectedId)) knowledgeState.selectedId = nodes[0]?.id || null;
    nodes.forEach(node => {
      const item = el('li');
      const button = el('button', 'knowledge-node'); button.type = 'button'; button.dataset.nodeId = node.id;
      const selected = node.id === knowledgeState.selectedId; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
      button.append(el('strong', '', node.name || node.id), el('span', 'knowledge-node-type', KNOWLEDGE_TYPE[node.entity_type] || node.entity_type || 'Сущность'), knowledgeTags(node));
      button.addEventListener('click', () => selectKnowledgeNode(node.id)); item.append(button); list.append(item);
    });
    if (!nodes.length) list.append(el('li', 'knowledge-empty', 'Ничего не найдено.'));
    $('#knowledge-content').hidden = false; renderKnowledgeDetail();
  }
  async function loadKnowledge({ quiet = false } = {}) {
    if (!state.authenticated || !$('#knowledge-dialog').open) return;
    const request = ++knowledgeState.request;
    const query = $('#knowledge-search').value.trim();
    knowledgeState.fetching = true; $('#knowledge-refresh').disabled = true;
    $('#knowledge-content').setAttribute('aria-busy', 'true');
    if (!quiet || !knowledgeState.data) $('#knowledge-request-status').textContent = 'Получаем знания проекта…';
    setError('#knowledge-error', '');
    try {
      const data = await api(`knowledge-graph${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      if (request !== knowledgeState.request || !$('#knowledge-dialog').open) return;
      knowledgeState.data = data; knowledgeState.query = query; renderKnowledge(data);
      $('#knowledge-request-status').textContent = query ? `Результаты поиска: «${query}». Показаны совпадения и связанные сущности.` : 'Показаны сохраненные знания проекта.';
    } catch (error) {
      if (request !== knowledgeState.request || !$('#knowledge-dialog').open) return;
      setError('#knowledge-error', error.message);
      $('#knowledge-request-status').textContent = knowledgeState.data ? `Обновление не удалось. Показаны последние полученные данные${knowledgeState.query ? ` для поиска «${knowledgeState.query}»` : ''}.` : 'Знания проекта пока не получены. Повтори запрос.';
    } finally {
      if (request === knowledgeState.request) { knowledgeState.fetching = false; $('#knowledge-refresh').disabled = false; $('#knowledge-content').setAttribute('aria-busy', 'false'); }
    }
  }
  function openKnowledge() {
    const dialog = $('#knowledge-dialog'); if (dialog.open) return;
    $('#board-nav').classList.remove('active'); $('#knowledge-button').classList.add('active');
    dialog.showModal(); $('#knowledge-search').focus(); loadKnowledge();
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  async function busy(button, work) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Подожди…';
    try { return await work(); }
    finally { button.disabled = false; button.textContent = label; }
  }

  function runtimeInfo() {
    const runtime = state.runtime;
    if (!state.connected) return { title: 'Состояние Codex неизвестно', description: 'Связь с панелью потеряна. Состояние исполнителя пока не подтверждено.', kind: 'bad', login: false };
    if (runtime.stale) return { title: 'Связь с исполнителем потеряна', description: 'Последнее состояние исполнителя устарело. Проверяем подключение.', kind: 'bad', login: false };
    if (runtime.available === false) {
      const login = runtime.authenticated === false && !runtime.stale;
      const reason = runtime.error ? `${runtime.error} ` : '';
      return { title: 'Запуск задач недоступен', description: `${reason}Запуск задач пока недоступен. ${login ? 'Аккаунт Codex можно подключить сейчас.' : 'Задачи сохранены.'}`, kind: 'bad', login };
    }
    if (runtime.authenticated === false) return { title: 'Подключи Codex', description: 'Войди в аккаунт ChatGPT, чтобы команда могла начать работу.', kind: '', login: true };
    if (runtime.available && runtime.authenticated) {
      if (state.settings.paused) return { title: 'Команда на паузе', description: 'Текущий исполнитель завершит свою работу. Новые запуски приостановлены.', kind: '', login: false };
      const working = ['running', 'busy', 'working'].includes(runtime.worker_status);
      return { title: working ? 'Codex работает' : 'Codex подключен', description: working ? 'Исполнитель выполняет задачу на сервере.' : 'Исполнитель готов. Ноутбук можно выключить.', kind: 'good', login: false };
    }
    return { title: 'Проверка Codex', description: 'Получаем состояние серверного исполнителя.', kind: '', login: false };
  }
  function renderRuntime() {
    const info = runtimeInfo();
    $('#runtime-title').textContent = info.title;
    $('#runtime-description').textContent = info.description;
    $('#runtime-description').hidden = info.kind === 'good';
    $('#runtime-dot').className = `status-dot ${info.kind}`;
    $('#runtime-login-button').hidden = !info.login;
    $('#settings-login-button').hidden = !info.login;
    $('#settings-runtime').textContent = `${info.title}. ${info.description}`;
    $('#settings-repairs').textContent = `До ${state.settings.max_repairs ?? 3} возвратов из проверки. После этого задача требует внимания.`;
    $('#auto-develop').checked = Boolean(state.settings.auto_develop);
    const pause = $('#global-pause');
    const pauseIcon = el('span', '', state.settings.paused ? '▷' : 'Ⅱ'); pauseIcon.setAttribute('aria-hidden', 'true');
    pause.replaceChildren(pauseIcon, el('span', '', state.settings.paused ? 'Продолжить' : 'Пауза команды'));
    pause.title = state.settings.paused ? 'Возобновить запуск задач' : 'Приостановить новые запуски после текущей работы исполнителя';
    const notices = [];
    if (state.settings.paused) notices.push('Команда на паузе. Новые запуски ждут продолжения.');
    if (state.runtime.available === false || state.runtime.authenticated === false) notices.push(info.description);
    $('#global-notice').hidden = !notices.length;
    $('#global-notice').className = 'global-notice';
    $('#global-notice').textContent = notices.join(' ');
    const project = state.projects?.[0];
    if (project?.name) $('#project-name').textContent = project.name;
  }
  function tokenCount(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat('ru-RU').format(value) : 'Нет данных';
  }
  function usageDate(value) {
    const parsed = new Date(value || '');
    return Number.isNaN(parsed.getTime()) ? 'нет данных' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(parsed);
  }
  function quotaPercent(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null; }
  function percentage(value) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value); }
  function quotaName(limit) { return typeof limit.name === 'string' && limit.name.trim() ? /^codex$/i.test(limit.name.trim()) ? 'Codex' : limit.name.trim() : 'Codex'; }
  function quotaPeriod(window) {
    const minutes = window.window_minutes;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return window.kind === 'secondary' ? 'Дополнительный период' : 'Основной период';
    if (minutes % 1440 === 0) return `${minutes / 1440} дн.`;
    if (minutes % 60 === 0) return `${minutes / 60} ч`;
    return `${minutes} мин`;
  }
  function usageStale(subscription) { return !state.connected || Boolean(subscription?.stale) || age(subscription?.checked_at) === null || age(subscription.checked_at) > 180000; }
  function remainingBar(remaining, label) {
    const bar = el('progress', `usage-progress${remaining < 10 ? ' low' : ''}`);
    bar.max = 100; bar.value = remaining;
    bar.setAttribute('aria-label', label);
    bar.setAttribute('aria-valuetext', `Осталось ${percentage(remaining)}%`);
    return bar;
  }
  function tokenMetrics(totals = {}) {
    const metrics = el('dl', 'usage-token-grid');
    for (const [key, name, note] of [['total_tokens', 'Всего', 'Вход + выход'], ['input_tokens', 'Вход', 'Запрос и контекст'], ['output_tokens', 'Выход', 'Ответ модели'], ['cached_input_tokens', 'Из кеша', 'Часть входа'], ['reasoning_output_tokens', 'Рассуждения', 'Часть выхода']]) {
      const metric = el('div', `usage-token-metric${key === 'total_tokens' ? ' total' : ''}`);
      metric.append(el('dt', '', name), el('dd', '', tokenCount(totals[key])), el('span', '', note)); metrics.append(metric);
    }
    return metrics;
  }
  function renderUsage(force = false) {
    const subscription = state.usage?.subscription;
    const stale = usageStale(subscription);
    const checkedAfterRequest = subscription?.last_attempt_at || subscription?.checked_at;
    if (usageState.requestedAt && checkedAfterRequest && Date.parse(checkedAfterRequest) >= usageState.requestedAt) {
      usageState.requestedAt = null; usageState.message = subscription.status === 'ready' ? 'Лимиты обновлены.' : 'Проверка завершена. Лимиты пока недоступны.';
    }
    if (usageState.requestedAt && Date.now() - usageState.requestedAt > 30000) { usageState.requestedAt = null; usageState.message = 'Запрос отправлен. Проверка может занять больше времени; данные появятся автоматически.'; }
    const signature = JSON.stringify([state.usage, stale, state.connected, usageState.requesting, usageState.requestedAt, usageState.message, $('#usage-dialog').open]);
    if (!force && signature === usageState.signature) return;
    usageState.signature = signature;
    const limits = Array.isArray(subscription?.limits) ? subscription.limits : [];
    const windows = limits.flatMap(limit => (Array.isArray(limit.windows) ? limit.windows : []).map(window => ({ limit, window, remaining: quotaPercent(window.remaining_percent) })));
    const knownWindows = windows.filter(item => item.remaining !== null);
    const lowest = knownWindows.reduce((selected, item) => !selected || item.remaining < selected.remaining ? item : selected, null);
    const title = lowest ? `Осталось ${percentage(lowest.remaining)}%` : 'Остаток неизвестен';
    const note = lowest ? `${limits.length > 1 ? `${quotaName(lowest.limit)} · ` : ''}${quotaPeriod(lowest.window)}${stale ? ' · Данные устарели' : subscription?.status !== 'ready' ? ' · Последние данные' : ''}` : 'Лимиты пока недоступны';
    $('#usage-card-title').textContent = title; $('#usage-card-note').textContent = note;
    $('#usage-mobile-title').textContent = title; $('#usage-mobile-note').textContent = note;
    $('#usage-card').classList.toggle('low', Boolean(lowest && lowest.remaining < 10));
    $('#usage-mobile').classList.toggle('low', Boolean(lowest && lowest.remaining < 10));
    $('#usage-card-progress').replaceChildren(...(lowest ? [remainingBar(lowest.remaining, `Наименьший остаток лимита, ${quotaPeriod(lowest.window)}`)] : []));
    if (!$('#usage-dialog').open) return;
    $('#usage-freshness').textContent = subscription?.checked_at ? `Проверено ${usageDate(subscription.checked_at)} МСК${stale ? ' · Данные устарели' : ''}` : 'Лимиты еще не получены.';
    $('#usage-request-status').textContent = usageState.requesting ? 'Отправляем запрос…' : usageState.requestedAt ? 'Проверяем лимиты. Результат появится автоматически.' : usageState.message;
    $('#usage-refresh').disabled = usageState.requesting || Boolean(usageState.requestedAt);
    const quotas = $('#usage-subscription'); quotas.replaceChildren();
    if (!windows.length) quotas.append(el('p', 'usage-empty', 'Лимиты пока недоступны. Остаток неизвестен, это не означает, что лимит исчерпан.'));
    if (stale && windows.length) quotas.append(el('p', 'usage-warning', 'Показаны последние полученные лимиты. Текущий остаток пока не подтвержден.'));
    if (subscription?.status === 'unavailable' && subscription.error) quotas.append(el('p', 'usage-note muted', subscription.error));
    for (const limit of limits) {
      const group = el('section', 'usage-limit-group');
      const heading = el('h4', '', quotaName(limit));
      group.append(heading);
      for (const window of Array.isArray(limit.windows) ? limit.windows : []) {
        const remaining = quotaPercent(window.remaining_percent); const used = quotaPercent(window.used_percent);
        const item = el('div', 'usage-window');
        const row = el('div', 'usage-window-heading'); row.append(el('strong', '', quotaPeriod(window)), el('strong', remaining !== null && remaining < 10 ? 'usage-low-text' : '', remaining === null ? 'Остаток неизвестен' : `Осталось ${percentage(remaining)}%`));
        item.append(row);
        if (remaining !== null) item.append(remainingBar(remaining, `${quotaName(limit)}, ${quotaPeriod(window)}: остаток`));
        const meta = el('div', 'usage-window-meta'); meta.append(el('span', '', used === null ? 'Использовано: нет данных' : `Использовано ${percentage(used)}%`), el('span', '', window.resets_at ? `Обновление ${usageDate(window.resets_at)} МСК` : 'Время обновления неизвестно'));
        item.append(meta); group.append(item);
      }
      quotas.append(group);
    }
    const account = subscription?.account_usage;
    if (account?.lifetime_tokens !== null && account?.lifetime_tokens !== undefined) quotas.append(el('p', 'usage-note muted', `Всего токенов аккаунта по данным Codex: ${tokenCount(account.lifetime_tokens)}. Учитывается работа вне проекта.`));
    const factory = state.usage?.factory; const content = $('#usage-factory'); content.replaceChildren();
    if (!factory) { content.append(el('p', 'usage-empty', 'Расход команды пока не получен.')); return; }
    content.append(tokenMetrics(factory.totals || {}));
    const coverage = el('div', 'usage-coverage');
    coverage.append(el('p', '', `Подробных отчетов запусков: ${tokenCount(factory.reported_runs)} · Без подробностей: ${tokenCount(factory.unreported_runs)}`));
    if (factory.coverage_started_at) coverage.append(el('p', '', `Учет с ${usageDate(factory.coverage_started_at)} МСК. Итог включает только полученные счетчики.`));
    else coverage.append(el('p', '', 'Начало учета пока не зафиксировано. Итог включает только полученные счетчики.'));
    if (typeof factory.legacy_reports === 'number' && factory.legacy_reports > 0) coverage.append(el('p', '', `Старых отчетов: ${tokenCount(factory.legacy_reports)}. Их счетчики включены в итог; привязка к конкретным запускам не получена.`));
    content.append(coverage);
    if (Array.isArray(factory.by_role) && factory.by_role.length) {
      const roles = el('div', 'usage-role-list');
      for (const role of factory.by_role) {
        const item = el('section', 'usage-role');
        const heading = el('div', 'usage-role-heading'); heading.append(el('h4', '', ROLE[role.role] || role.role || 'Исполнитель'), el('strong', '', `${tokenCount(role.totals?.total_tokens)}${role.totals?.total_tokens === null || role.totals?.total_tokens === undefined ? '' : ' токенов'}`));
        item.append(heading, el('p', 'usage-note muted', `Вход: ${tokenCount(role.totals?.input_tokens)} · Выход: ${tokenCount(role.totals?.output_tokens)} · Кеш: ${tokenCount(role.totals?.cached_input_tokens)} · Рассуждения: ${tokenCount(role.totals?.reasoning_output_tokens)}`), el('p', 'usage-note muted', `Подробных отчетов запусков: ${tokenCount(role.reported_runs)}${typeof role.unreported_runs === 'number' ? ` · Без подробностей: ${tokenCount(role.unreported_runs)}` : ''}`));
        if (typeof role.legacy_reports === 'number' && role.legacy_reports > 0) item.append(el('p', 'usage-note muted', `Старых отчетов роли: ${tokenCount(role.legacy_reports)}. Их счетчики включены в итог; привязка к конкретным запускам не получена.`));
        roles.append(item);
      }
      content.append(roles);
    }
  }
  function openUsage() { setError('#usage-error', ''); $('#usage-dialog').showModal(); renderUsage(true); }
  async function refreshUsage() {
    if (usageState.requesting || usageState.requestedAt) return;
    usageState.requesting = true; usageState.message = ''; setError('#usage-error', ''); renderUsage(true);
    const requestedAt = Date.now();
    try {
      const result = await post('usage/refresh', {});
      if (result.requested === false) usageState.message = 'Проверка уже запрошена. Новые данные появятся автоматически.';
      else usageState.requestedAt = requestedAt;
      await loadState({ quiet: true });
    }
    catch (error) { setError('#usage-error', error.message); }
    finally { usageState.requesting = false; renderUsage(true); }
  }
  function renderRunUsage(item, run) {
    const usage = run.usage;
    if (!usage || typeof usage !== 'object') { item.append(el('p', 'run-usage', 'Токены: расход не получен.')); return; }
    const block = el('div', 'run-usage');
    block.append(el('p', '', `Токены: ${tokenCount(usage.total_tokens)} · Вход: ${tokenCount(usage.input_tokens)} · Выход: ${tokenCount(usage.output_tokens)}`), el('p', '', `Кеш: ${tokenCount(usage.cached_input_tokens)} (часть входа) · Рассуждения: ${tokenCount(usage.reasoning_output_tokens)} (часть выхода)`));
    item.append(block);
  }
  function copyProfiles(profiles) {
    if (!profiles || typeof profiles !== 'object') return null;
    const copy = {};
    for (const role of PROFILE_ROLES) {
      const profile = profiles[role];
      if (!profile || typeof profile !== 'object') return null;
      copy[role] = { model: profile.model, reasoning_effort: profile.reasoning_effort, skills: Array.isArray(profile.skills) ? [...profile.skills] : [] };
    }
    return copy;
  }
  function profileError(profiles) {
    if (!profiles) return 'Настройки ролей пока не получены. Попробуй обновить страницу.';
    const models = state.roleCatalog.models || [];
    const skills = state.roleCatalog.skills || [];
    for (const role of PROFILE_ROLES) {
      const profile = profiles[role];
      const model = models.find(item => item.id === profile.model);
      if (!model) return `${ROLE[role]}: выбери доступную модель.`;
      if (!model.reasoning_efforts?.includes(profile.reasoning_effort)) return `${ROLE[role]}: выбери доступную глубину рассуждения.`;
      if (profile.skills.some(id => !skills.some(skill => skill.id === id && skill.role === role))) return `${ROLE[role]}: выбран недоступный навык.`;
    }
    return '';
  }
  function updateProfileActions() {
    const error = profileError(state.profileDraft);
    $('#role-profiles-save').disabled = !state.profilesDirty || state.profilesSaving || Boolean(error);
    $('#role-profiles-reset').hidden = !state.profilesDirty;
    $('#role-profiles-reset').disabled = state.profilesSaving;
    $('#role-profiles-status').textContent = state.profilesSaving ? 'Сохраняем настройки…' : state.profilesDirty ? 'Есть несохраненные изменения.' : state.profileMessage;
    if (error) setError('#role-profiles-error', error);
  }
  function profilesChanged() {
    state.profilesDirty = JSON.stringify(state.profileDraft) !== JSON.stringify(copyProfiles(state.settings.role_profiles));
    state.profileSignature = JSON.stringify([state.roleCatalog, state.profileDraft]);
    state.profileMessage = '';
    setError('#role-profiles-error', '');
    updateProfileActions();
  }
  function renderProfiles(force = false) {
    const draft = !state.profilesDirty && !state.profilesSaving ? copyProfiles(state.settings.role_profiles) : state.profileDraft;
    const signature = JSON.stringify([state.roleCatalog, draft]);
    if (!force && signature === state.profileSignature) { updateProfileActions(); return; }
    state.profileDraft = draft;
    state.profileSignature = signature;
    const container = $('#role-profiles'); container.replaceChildren();
    const models = state.roleCatalog.models || [];
    if (!state.profileDraft || !models.length) {
      container.append(el('p', 'muted settings-note', 'Настройки ролей пока недоступны.'));
      updateProfileActions(); return;
    }
    PROFILE_ROLES.forEach(role => {
      const metadata = (state.roleCatalog.roles || []).find(item => item.id === role);
      const profile = state.profileDraft[role];
      const card = el('fieldset', 'role-profile');
      card.dataset.role = role;
      card.append(el('legend', '', metadata?.name || ROLE[role]));
      if (metadata?.description) card.append(el('p', 'muted role-description', metadata.description));
      if (Number.isFinite(metadata?.timeout_minutes)) card.append(el('p', 'muted', `Время работы ИИ: до ${metadata.timeout_minutes} мин.`));
      const fields = el('div', 'role-profile-fields');
      const modelField = el('div'); const modelLabel = el('label', '', 'Модель');
      const modelSelect = el('select'); modelSelect.id = `profile-${role}-model`; modelLabel.htmlFor = modelSelect.id;
      models.forEach(model => { const option = el('option', '', model.name || model.id); option.value = model.id; modelSelect.append(option); });
      modelSelect.value = profile.model;
      modelField.append(modelLabel, modelSelect);
      const effortField = el('div'); const effortLabel = el('label', '', 'Глубина рассуждения');
      const effortSelect = el('select'); effortSelect.id = `profile-${role}-effort`; effortLabel.htmlFor = effortSelect.id;
      function renderEfforts() {
        const efforts = models.find(model => model.id === profile.model)?.reasoning_efforts || [];
        effortSelect.replaceChildren();
        efforts.forEach(effort => { const option = el('option', '', EFFORT[effort] || effort); option.value = effort; effortSelect.append(option); });
        effortSelect.value = profile.reasoning_effort;
      }
      renderEfforts(); effortField.append(effortLabel, effortSelect); fields.append(modelField, effortField); card.append(fields);
      modelSelect.addEventListener('change', () => {
        profile.model = modelSelect.value;
        const efforts = models.find(model => model.id === profile.model)?.reasoning_efforts || [];
        if (!efforts.includes(profile.reasoning_effort)) profile.reasoning_effort = efforts.includes('medium') ? 'medium' : efforts[0];
        renderEfforts(); profilesChanged();
      });
      effortSelect.addEventListener('change', () => { profile.reasoning_effort = effortSelect.value; profilesChanged(); });
      const skillList = el('div', 'role-skills'); skillList.append(el('strong', 'role-skills-title', 'Навыки'));
      (state.roleCatalog.skills || []).filter(skill => skill.role === role).forEach(skill => {
        const label = el('label', 'role-skill'); const input = el('input'); input.type = 'checkbox'; input.value = skill.id; input.checked = profile.skills.includes(skill.id); input.id = `profile-${role}-${skill.id}`;
        const copy = el('span'); copy.append(el('strong', '', skill.name || skill.id));
        if (skill.description) copy.append(el('span', 'muted', skill.description));
        label.append(input, copy); skillList.append(label);
        input.addEventListener('change', () => {
          profile.skills = input.checked ? [...new Set([...profile.skills, skill.id])] : profile.skills.filter(id => id !== skill.id);
          profilesChanged();
        });
      });
      card.append(skillList); container.append(card);
    });
    $('#role-profiles-form').querySelectorAll('select, input').forEach(input => { input.disabled = state.profilesSaving; });
    updateProfileActions();
  }
  function skillName(id) { return (state.roleCatalog.skills || []).find(skill => skill.id === id)?.name || id; }
  function renderRunExecution(item, run) {
    const execution = run.execution && typeof run.execution === 'object' ? run.execution : {};
    const metadata = el('div', 'run-execution');
    if (!execution.requested_model && !execution.actual_model) {
      metadata.append(el('p', '', 'Модель и глубина этого запуска не записаны.'));
    } else {
      if (execution.requested_model) metadata.append(el('p', '', `Выбрано: ${execution.requested_model}${execution.requested_effort ? ` · Глубина: ${EFFORT[execution.requested_effort] || execution.requested_effort}` : ''}`));
      metadata.append(el('p', '', execution.actual_model ? `Фактически: ${execution.actual_model} · Глубина: ${execution.actual_effort ? EFFORT[execution.actual_effort] || execution.actual_effort : 'не записана'}` : run.status === 'running' ? 'Фактическая модель: ожидаем данные исполнителя.' : 'Фактическая модель: нет данных исполнителя.'));
    }
    const provided = Array.isArray(execution.skills) ? execution.skills : [];
    const requested = Array.isArray(execution.requested_skills) ? execution.requested_skills : [];
    if (provided.length) {
      const names = provided.map(skill => `${skillName(skill.id)}${skill.version ? ` (${skill.version})` : ''}`);
      metadata.append(el('p', '', `Предоставленные навыки: ${names.join(', ')}`));
      const hashes = provided.filter(skill => skill.sha256).map(skill => `${skillName(skill.id)}: ${skill.sha256}`);
      if (hashes.length) { const details = el('details', 'run-skill-details'); details.append(el('summary', '', 'Версии инструкций'), el('p', '', hashes.join('\n'))); metadata.append(details); }
    } else if (requested.length) metadata.append(el('p', '', `Выбранные навыки: ${requested.map(skillName).join(', ')}. Передача инструкций пока не подтверждена.`));
    else if (execution.requested_model) metadata.append(el('p', '', 'Навыки не выбраны.'));
    const knowledge = execution.project_knowledge;
    if (knowledge && typeof knowledge === 'object') {
      metadata.append(el('p', '', `Знания проекта: версия ${knowledge.version}, актуальность ${date(knowledge.updated_at)}, документов: ${knowledge.document_count}.`));
      const missing = Array.isArray(knowledge.missing_documents) ? knowledge.missing_documents : [];
      if (missing.length) metadata.append(el('p', '', `Неполные источники: ${missing.join(', ')}.`));
    } else metadata.append(el('p', '', run.status === 'running' ? 'Знания проекта: ожидаем подтверждение передачи.' : 'Знания проекта: версия для этого запуска не записана.'));
    const memory = execution.task_memory;
    if (memory && typeof memory === 'object') {
      metadata.append(el('p', '', `Решения из других задач: ${memory.answer_count}; результаты разработки и проверки: ${memory.delivery_count}. Готовые к выпуску изменения учитываются как кандидаты.`));
    }
    const graph = execution.knowledge_graph;
    if (graph && typeof graph === 'object') metadata.append(el('p', '', `Граф знаний${graph.version ? ` (версия ${graph.version})` : ''}: сущностей ${graph.node_count}, связей ${graph.edge_count}, конфликтов ${graph.conflict_count}.`));
    if (knowledge?.sha256 || memory?.sha256 || graph?.sha256) {
      const details = el('details', 'run-skill-details');
      details.append(el('summary', '', 'Версии знаний'), el('p', '', [knowledge?.sha256 && `Знания проекта: ${knowledge.sha256}`, memory?.sha256 && `Решения и результаты: ${memory.sha256}`, graph?.sha256 && `Граф знаний: ${graph.sha256}`].filter(Boolean).join('\n')));
      metadata.append(details);
    }
    item.append(metadata);
  }
  function taskColumn(task) {
    return LANES.find(lane => lane.statuses.includes(task.status))?.id || 'attention';
  }
  function boardMoves(task) {
    const own = taskColumn(task);
    return Array.isArray(task.board_moves) ? task.board_moves.filter(id => LANES.some(lane => lane.id === id)) : [own];
  }
  function boardTaskSort(a, b) {
    const ranked = task => task.board_column === taskColumn(task) && Number.isInteger(task.board_position) ? task.board_position : null;
    const left = ranked(a), right = ranked(b);
    if (left !== null || right !== null) {
      if (left === null) return 1;
      if (right === null) return -1;
      if (left !== right) return left - right;
    }
    return priority(a.priority).localeCompare(priority(b.priority)) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
  }
  function moveNote(task, columnId) {
    if (columnId === taskColumn(task)) return 'Порядок карточек сохранится на доске.';
    if (task.board_move_actions?.[columnId] === 'retry') return `${ROLE[task.board_last_failure?.role] || 'Исполнитель'} повторит остановленный этап после перемещения.`;
    if (task.board_move_actions?.[columnId] === 'resume') return 'Работа возобновится с этапа, на котором была поставлена на паузу.';
    if (columnId === 'analysis') return 'Аналитик начнет разбор задачи после перемещения.';
    if (columnId === 'working') return 'Разработчик начнет работу после перемещения.';
    return 'Этот этап начнется после завершения предыдущей работы.';
  }
  function blockedMoveNote(task, columnId) {
    if (task.board_blocked_reason) return task.board_blocked_reason;
    if (task.status === 'ready_release') return state.runtime.release_enabled === false ? 'Проверки завершены. Исполнитель публикации пока не настроен. Открой результат задачи.' : 'Для публикации открой результат и подтверди выпуск проверенной версии.';
    if (task.status === 'needs_answers') return 'Сначала ответь на вопросы аналитика.';
    if (['needs_attention', 'paused', 'cancelled'].includes(task.status)) return 'Открой задачу, чтобы продолжить или повторить работу.';
    if (columnId === 'testing') return 'Тестирование начнется после разработки.';
    if (['release', 'done'].includes(columnId)) return 'Сначала нужны результаты разработки и проверки.';
    return 'Сначала заверши текущий этап задачи.';
  }
  function finishBoardDrag() {
    boardMoveState.drag = null;
    boardMoveState.marker?.remove(); boardMoveState.marker = null;
    boardMoveState.suppressClickUntil = Date.now() + 250;
    $$('.task-card.is-dragging').forEach(card => card.classList.remove('is-dragging'));
    $$('.board-column').forEach(column => {
      column.classList.remove('drop-allowed', 'drop-blocked', 'drop-active');
      const hint = $('.board-drop-hint', column); if (hint) hint.hidden = true;
    });
    renderBoard(true);
  }
  function startBoardDrag(event, task, card) {
    if (!state.connected || boardMoveState.moving || $('#move-dialog').open || !event.dataTransfer) { event.preventDefault(); return; }
    boardMoveState.drag = { ...task };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-royal-task', task.id);
    event.dataTransfer.setData('text/plain', task.id);
    card.classList.add('is-dragging');
    const allowed = boardMoves(task);
    $$('.board-column').forEach(column => {
      const accepted = allowed.includes(column.dataset.columnId);
      column.classList.toggle('drop-allowed', accepted); column.classList.toggle('drop-blocked', !accepted);
      const hint = $('.board-drop-hint', column);
      hint.textContent = accepted ? moveNote(task, column.dataset.columnId) : blockedMoveNote(task, column.dataset.columnId);
      hint.hidden = false;
    });
  }
  function dropBefore(list, pointerY) {
    return $$('.task-card', list).filter(card => card.dataset.taskId !== boardMoveState.drag?.id).find(card => {
      const rect = card.getBoundingClientRect(); return pointerY < rect.top + rect.height / 2;
    }) || null;
  }
  function setupBoardDrop(column, list, columnId) {
    column.addEventListener('dragover', event => {
      const task = boardMoveState.drag; if (!task) return;
      if (!state.connected || boardMoveState.moving || !boardMoves(task).includes(columnId)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
        column.classList.remove('drop-active'); boardMoveState.marker?.remove(); return;
      }
      event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      $$('.board-column.drop-active').forEach(item => item.classList.remove('drop-active'));
      column.classList.add('drop-active');
      const before = dropBefore(list, event.clientY);
      if (!boardMoveState.marker) boardMoveState.marker = el('div', 'board-drop-marker');
      list.insertBefore(boardMoveState.marker, before);
      const board = $('#board'), rect = board.getBoundingClientRect();
      if (event.clientX > rect.right - 40) board.scrollLeft += 20;
      else if (event.clientX < rect.left + 40) board.scrollLeft -= 20;
    });
    column.addEventListener('dragleave', event => {
      if (event.relatedTarget instanceof Node && column.contains(event.relatedTarget)) return;
      column.classList.remove('drop-active');
      if (boardMoveState.marker?.parentNode === list) boardMoveState.marker.remove();
    });
    column.addEventListener('drop', event => {
      const task = boardMoveState.drag; if (!task) return;
      event.preventDefault();
      if (!state.connected || boardMoveState.moving || !boardMoves(task).includes(columnId)) {
        toast(!state.connected ? 'Нет связи с панелью. Попробуй после восстановления.' : blockedMoveNote(task, columnId), true);
        finishBoardDrag(); return;
      }
      const beforeId = dropBefore(list, event.clientY)?.dataset.taskId || null;
      void moveBoardTask(task, columnId, beforeId);
      finishBoardDrag();
    });
  }
  function updateMovePosition() {
    const task = boardMoveState.task; if (!task) return;
    const columnId = $('#move-column').value;
    const candidates = state.tasks.filter(item => item.id !== task.id && taskColumn(item) === columnId).sort(boardTaskSort);
    const positions = $('#move-before'); positions.replaceChildren();
    const end = el('option', '', 'В конец колонки'); end.value = ''; positions.append(end);
    candidates.forEach(item => {
      const option = el('option', '', 'Перед: ' + item.title); option.value = item.id; positions.append(option);
    });
    $('#move-note').textContent = moveNote(task, columnId);
  }
  function openMoveDialog(task) {
    if (!state.connected || boardMoveState.moving) { toast('Дождись подключения панели.', true); return; }
    boardMoveState.task = { ...task }; setError('#move-error', '');
    $('#move-task-title').textContent = task.title;
    const columns = $('#move-column'); columns.replaceChildren();
    LANES.filter(lane => boardMoves(task).includes(lane.id)).forEach(lane => {
      const option = el('option', '', lane.title); option.value = lane.id; columns.append(option);
    });
    columns.value = taskColumn(task); updateMovePosition(); $('#move-dialog').showModal();
  }
  async function moveBoardTask(task, columnId, beforeId, fromDialog = false) {
    if (boardMoveState.moving) return false;
    if (!state.connected || !boardMoves(task).includes(columnId)) {
      const message = !state.connected ? 'Нет связи с панелью. Попробуй после восстановления.' : blockedMoveNote(task, columnId);
      if (fromDialog) setError('#move-error', message); else toast(message, true);
      return false;
    }
    boardMoveState.moving = true;
    const card = $$('.task-card').find(item => item.dataset.taskId === task.id);
    card?.classList.add('is-moving');
    $('#move-submit').disabled = true; $('#move-column').disabled = true; $('#move-before').disabled = true;
    try {
      await post('tasks/' + encodeURIComponent(task.id) + '/move', { column_id: columnId, before_task_id: beforeId, expected_status: task.status });
      if (state.fetching) await loadState();
      await loadState();
      if (fromDialog) $('#move-dialog').close();
      const action = task.board_move_actions?.[columnId];
      toast(columnId === taskColumn(task) ? 'Порядок карточек сохранен' : action === 'retry' ? 'Повторный запуск поставлен в очередь' : action === 'resume' ? 'Работа возобновлена' : columnId === 'analysis' ? 'Задача передана аналитику' : columnId === 'testing' ? 'Задача передана на тестирование' : 'Задача передана в разработку');
      return true;
    } catch (error) {
      if (fromDialog && $('#move-dialog').open) setError('#move-error', error.message);
      else toast(error.message, true);
      if (state.fetching) await loadState();
      await loadState({ quiet: true });
      return false;
    } finally {
      boardMoveState.moving = false;
      $('#move-submit').disabled = false; $('#move-column').disabled = false; $('#move-before').disabled = false;
      renderBoard(true);
    }
  }
  function taskCard(task) {
    const card = el('article', 'task-card');
    card.dataset.taskId = task.id; card.dataset.status = task.status; card.dataset.priority = priority(task.priority);
    card.draggable = state.connected;
    card.addEventListener('dragstart', event => startBoardDrag(event, task, card));
    card.addEventListener('dragend', finishBoardDrag);
    const open = el('button', 'card-open'); open.type = 'button';
    open.setAttribute('aria-label', `${task.title}. ${STATUS[task.status] || task.status}`);
    open.addEventListener('click', () => { if (Date.now() > boardMoveState.suppressClickUntil && !boardMoveState.moving) openTask(task.id); });
    const top = el('div', 'card-top');
    if (['P0', 'P1'].includes(priority(task.priority))) top.append(priorityBadge(task.priority));
    const controls = el('div', 'card-actions');
    const handle = el('span', 'card-drag-handle', '⠿'); handle.setAttribute('aria-hidden', 'true'); handle.title = 'Перетащи карточку';
    const move = el('button', 'card-move-button', '↕'); move.type = 'button'; move.draggable = false;
    move.setAttribute('aria-label', 'Переместить задачу ' + task.title); move.title = 'Переместить задачу';
    move.addEventListener('click', () => openMoveDialog(task));
    controls.append(handle, move); top.append(controls); card.append(top);
    open.append(el('h3', '', task.title));
    const footer = el('div', 'card-footer');
    footer.append(badge(task.status));
    open.append(footer);
    if (task.status === 'needs_attention') open.append(el('p', 'card-status-note card-error-note', failureNote(task)));
    if (task.status === 'ready_release') open.append(el('p', 'card-status-note', state.runtime.release_enabled === false ? 'Проверено. Публикация пока не настроена.' : 'Проверено. Ожидает подтверждения выпуска.'));
    const unanswered = (task.questions || []).filter(q => q.status !== 'cancelled' && !q.answer?.trim());
    const questionCount = task.open_questions ?? unanswered.length;
    if (task.status === 'needs_answers' && questionCount) open.append(el('p', 'card-question', `Ждет ответа: ${questionCount}`));
    if (task.active_run || ['analyzing', 'developing', 'testing', 'repairing'].includes(task.status)) {
      const progress = el('div', 'card-progress'); progress.dataset.progressTask = task.id;
      renderCardProgress(progress, task); open.append(progress);
    }
    card.append(open);
    if (['needs_attention', 'paused', 'ready_release'].includes(task.status)) {
      const action = Object.values(task.board_move_actions || {}).find(value => ['retry', 'resume'].includes(value)) || (task.status === 'paused' ? 'resume' : null);
      const next = el('button', 'button quiet small card-next-action', task.status === 'ready_release' ? 'Проверить результат' : action === 'retry' ? 'Повторить запуск' : action === 'resume' ? 'Продолжить' : 'Открыть причину');
      next.type = 'button'; next.draggable = false;
      next.disabled = !state.connected;
      next.addEventListener('click', () => { if (!boardMoveState.moving && Date.now() > boardMoveState.suppressClickUntil) action ? taskAction(next, action, task.id) : openTask(task.id); });
      card.append(next);
    }
    return card;
  }
  function renderBoard(force = false) {
    if (boardMoveState.drag || boardMoveState.moving) return;
    const tasks = state.tasks;
    renderAttention();
    $('#nav-count').textContent = tasks.length;
    $('#active-count').textContent = tasks.filter(t => !['done', 'cancelled'].includes(t.status)).length;
    $('#stat-working').textContent = tasks.filter(task => activeRun(task)).length;
    $('#stat-questions').textContent = tasks.filter(t => t.status === 'needs_answers').length;
    $('#stat-release').textContent = tasks.filter(t => t.status === 'ready_release').length;
    $('#stat-done').textContent = tasks.filter(t => t.status === 'done').length;
    const signature = JSON.stringify([tasks, state.filter, state.search, state.runtime.release_enabled]);
    if (!force && state.signature === signature) return;
    state.signature = signature;
    const search = state.search.toLocaleLowerCase('ru-RU');
    const visible = tasks.filter(task => {
      if (state.filter === 'active' && ['done', 'cancelled'].includes(task.status)) return false;
      if (state.filter === 'done' && !['done', 'cancelled'].includes(task.status)) return false;
      return !search || `${task.title} ${task.description || ''} ${shortId(task.id)}`.toLocaleLowerCase('ru-RU').includes(search);
    }).sort(boardTaskSort);
    const board = $('#board');
    board.replaceChildren();
    $('#empty-state').hidden = visible.length > 0;
    board.hidden = visible.length === 0;
    if (!visible.length) {
      const firstTask = !tasks.length;
      $('#empty-title').textContent = firstTask ? 'Начнем с первой задачи' : search ? 'Ничего не найдено' : state.filter === 'done' ? 'Завершенные задачи появятся здесь' : 'Все текущие задачи завершены';
      $('#empty-description').textContent = firstTask ? 'Опиши, что хочешь изменить. Аналитик изучит задачу и предложит следующие шаги.' : search ? 'Попробуй другое название или очисти поиск.' : 'Добавь следующую идею или открой вкладку «Все».';
      $('#empty-create-button').hidden = Boolean(search) || state.filter === 'done';
      return;
    }
    const unknown = visible.filter(t => !LANES.some(lane => lane.statuses.includes(t.status)));
    LANES.forEach(lane => {
      const laneTasks = visible.filter(t => lane.statuses.includes(t.status));
      if (lane.id === 'attention') laneTasks.push(...unknown);
      if (lane.id === 'done' && state.filter === 'active') return;
      if (state.filter === 'done' && !['done', 'attention'].includes(lane.id)) return;
      if (lane.id === 'attention' && !laneTasks.length) return;
      const column = el('section', 'board-column');
      column.dataset.columnId = lane.id;
      const heading = el('div', 'column-heading');
      heading.append(el('span', `column-dot ${lane.id}`), el('h2', '', lane.title), el('span', 'column-count', laneTasks.length));
      if (lane.id === 'inbox') {
        const add = el('button', 'column-add', '+');
        add.type = 'button'; add.setAttribute('aria-label', 'Добавить задачу'); add.addEventListener('click', openCreate); heading.append(add);
      }
      const list = el('div', 'column-tasks');
      setupBoardDrop(column, list, lane.id);
      const dropHint = el('p', 'board-drop-hint'); dropHint.hidden = true;
      if (!laneTasks.length) list.append(el('div', 'column-empty', 'Пока нет задач'));
      else laneTasks.forEach(task => list.append(taskCard(task)));
      column.append(heading, dropHint, list); board.append(column);
    });
  }
  async function loadState({ quiet = false } = {}) {
    if (state.fetching) return stateLoadDone;
    state.fetching = true;
    stateLoadDone = new Promise(resolve => { stateLoadResolve = resolve; });
    const profilesVersion = state.profilesVersion;
    try {
      const result = await api('state');
      const previousTasks = state.authenticated ? new Map(state.tasks.map(task => [task.id, task.status])) : new Map();
      state.authenticated = true;
      state.connected = true;
      state.tasks = Array.isArray(result.tasks) ? result.tasks : [];
      const previousProfiles = state.settings.role_profiles;
      state.settings = result.settings || {};
      if (profilesVersion !== state.profilesVersion) state.settings.role_profiles = previousProfiles;
      state.roleCatalog = result.role_catalog || {};
      state.runtime = result.runtime || {};
      state.usage = result.usage || null;
      state.projects = result.projects || [];
      $('#boot').hidden = true;
      $('#login-screen').hidden = true;
      $('#workspace').hidden = false;
      $('#connection-status').replaceChildren(el('span', 'status-dot good'), el('span', '', 'Обновлено'));
      renderRuntime(); renderUsage(); renderProfiles(); renderBoard();
      const selected = state.tasks.find(task => task.id === state.taskId);
      if (selected && state.progressTask) state.progressTask = { ...state.progressTask, status: selected.status, active_run: selected.active_run };
      refreshProgressDisplays();
      state.tasks.filter(task => previousTasks.has(task.id) && previousTasks.get(task.id) !== task.status).slice(0, 3).forEach(task => {
        toast(`${task.title}: ${STATUS[task.status] || task.status}`, task.status === 'needs_attention', task.id);
      });
      const linkedId = linkedTaskId();
      if (linkedId && !$('#task-dialog').open) await openTask(linkedId);
      if (state.taskId && $('#task-dialog').open) await refreshTask();
    } catch (error) {
      state.connected = false; refreshProgressDisplays();
      if (state.authenticated) { renderRuntime(); renderUsage(); }
      $('#boot').hidden = true;
      if (error.status === 401) showLogin();
      else if (!state.authenticated) { showLogin(); setError('#login-error', 'Не удалось связаться с сервером. Попробуй еще раз.'); }
      else {
        $('#connection-status').replaceChildren(el('span', 'status-dot bad'), el('span', '', 'Нет связи'));
        $('#global-notice').hidden = false;
        $('#global-notice').className = 'global-notice error';
        $('#global-notice').textContent = 'Нет связи. Показаны последние данные, переподключаемся.';
        if (!quiet) toast(error.message, true);
      }
    } finally {
      state.fetching = false;
      stateLoadResolve?.(); stateLoadResolve = null; stateLoadDone = null;
    }
  }

  function openCreate() { $('#create-form').reset(); setError('#create-error', ''); $('#create-dialog').showModal(); }
  async function openTask(id) {
    const url = new URL(location.href); url.hash = `task=${encodeURIComponent(id)}`;
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    state.taskId = id; state.task = null; state.progressTask = null; state.detailConnected = true; state.detailDirty = false;
    $('#task-reference').textContent = shortId(id);
    $('#task-detail').replaceChildren(el('p', 'detail-loading', 'Открываем задачу…'));
    if (!$('#task-dialog').open) $('#task-dialog').showModal();
    await refreshTask(true);
  }
  async function refreshTask(force = false) {
    const id = state.taskId;
    if (!id) return;
    try {
      const result = await api(`tasks/${encodeURIComponent(id)}`);
      if (id !== state.taskId || !$('#task-dialog').open) return;
      const task = result.task || result;
      state.detailConnected = true; state.progressTask = task;
      if (!force && (state.detailDirty || detailSignature(task) === detailSignature(state.task || {}))) { refreshProgressDisplays(); return; }
      state.task = task; state.detailDirty = false; renderTask(task);
    } catch (error) {
      if (id !== state.taskId) return;
      state.detailConnected = false; refreshProgressDisplays();
      if (!state.task) $('#task-detail').replaceChildren(el('p', 'form-error', error.message));
      else if (force) toast(error.message, true);
    }
  }
  function section(title, count) {
    const node = el('section', 'detail-section');
    const heading = el('h3', '', title);
    if (count !== undefined) heading.append(el('span', 'section-count', count));
    node.append(heading); return node;
  }
  function disclosure(title, key, count) {
    const details = el('details', 'detail-disclosure'); details.dataset.disclosure = key;
    const summary = el('summary'); summary.append(el('span', 'section-title', title));
    if (count !== undefined) summary.append(el('span', 'section-count', count));
    const content = el('div', 'disclosure-content'); details.append(summary, content);
    return { details, content };
  }
  function appendDisclosure(container, title, key, render, count) {
    const block = disclosure(title, key, count); render(block.content); container.append(block.details);
  }
  function actionButton(label, action, className = 'quiet') {
    const button = el('button', `button ${className}`, label); button.type = 'button';
    button.addEventListener('click', () => taskAction(button, action));
    return button;
  }
  function failureNote(task) {
    if (task.board_blocked_reason) return task.board_blocked_reason;
    const error = task.board_last_failure ? task.board_last_failure.error : task.runs?.at(-1)?.error;
    if (typeof error !== 'string' || !error) return 'Этап остановился. Причина не получена. Можно повторить запуск.';
    if (/Knowledge graph/i.test(error)) return 'Не удалось сохранить знания проекта. Повтори запуск.';
    if (/time limit|timed? ?out|timeout/i.test(error)) return 'Истекло время запуска. Можно продолжить повторным запуском.';
    if (/reproducible defect|bug severity/i.test(error)) return 'Не удалось сохранить отчет проверки. Повтори тестирование.';
    if (/auth|log.?in|token.*expired/i.test(error)) return 'Исполнителю нужен повторный вход в Codex.';
    if (/rate.?limit|usage limit|quota/i.test(error)) return 'Достигнут лимит Codex. Повтори запуск после обновления лимита.';
    if (/[А-Яа-яЁё]/.test(error)) return error.length > 240 ? error.slice(0, 237) + '…' : error;
    if (task.artifact?.tester?.verification_blocked) return 'Тестировщик не смог завершить проверки. Подробности в отчете команды.';
    return 'Сбой исполнителя. Можно повторить запуск.';
  }
  async function taskAction(button, action, id = state.taskId) {
    try {
      await busy(button, () => post(`tasks/${encodeURIComponent(id)}/action`, { action }));
      toast({ analyze: 'Задача передана аналитику', start: 'Задача передана в разработку', pause: 'Задача приостановлена', resume: 'Работа возобновлена', retry: 'Повторный запуск поставлен в очередь', cancel: 'Задача отменена', approve_release: 'Выпуск поставлен в очередь' }[action]);
      if (state.taskId === id) state.detailDirty = false;
      if (state.fetching) await loadState();
      await loadState(); if (state.taskId === id) await refreshTask(true);
    } catch (error) { toast(error.message, true); }
  }
  function renderTask(task) {
    const container = $('#task-detail');
    const expanded = container.dataset.taskId === task.id ? new Set($$('details[open]', container).map(node => node.dataset.disclosure).filter(Boolean)) : new Set();
    container.dataset.taskId = task.id; container.replaceChildren();
    const badges = el('div', 'detail-badges'); badges.append(badge(task.status));
    if (['P0', 'P1'].includes(priority(task.priority))) badges.append(priorityBadge(task.priority));
    const title = el('h1', 'detail-title', task.title); title.id = 'task-title';
    container.append(badges, title);
    if (task.status === 'needs_attention') {
      const reason = el('div', 'task-stop-reason'); reason.setAttribute('role', 'alert');
      reason.append(el('strong', '', 'Почему остановилась'), el('p', 'cause-text', failureNote(task))); container.append(reason);
    }
    const progress = el('section', 'task-progress'); progress.id = 'task-progress'; progress.setAttribute('aria-label', 'Текущее выполнение задачи');
    renderTaskProgress(progress, task); container.append(progress);
    const actions = el('div', 'detail-actions');
    if (task.status === 'inbox') actions.append(actionButton('Передать аналитику', 'analyze', 'primary'));
    if (task.status === 'ready') actions.append(actionButton('Начать разработку', 'start', 'primary'));
    if (task.status === 'needs_attention') {
      const retry = actionButton('Повторить запуск', 'retry', 'primary');
      retry.disabled = Boolean(task.board_blocked_reason);
      if (task.board_blocked_reason) retry.title = task.board_blocked_reason;
      actions.append(retry);
    }
    if (task.status === 'paused') actions.append(actionButton('Продолжить', 'resume', 'primary'));
    if (task.status === 'ready_release' && state.runtime.release_enabled !== false) {
      const release = actionButton('Подтвердить выпуск', 'approve_release', 'primary');
      actions.append(release);
    }
    const extra = el('details', 'detail-actions-menu'); extra.dataset.disclosure = 'actions';
    extra.append(el('summary', 'button quiet', 'Еще действия'));
    const extraButtons = el('div', 'extra-actions');
    if (task.status === 'needs_answers') extraButtons.append(actionButton('Повторить анализ', 'analyze'));
    if (!['paused', 'done', 'cancelled', 'releasing'].includes(task.status)) extraButtons.append(actionButton('Пауза', 'pause'));
    const editButton = el('button', 'button quiet', 'Редактировать'); editButton.type = 'button';
    editButton.addEventListener('click', () => { extra.open = false; showEdit(task, editButton); }); extraButtons.append(editButton);
    if (!['done', 'cancelled', 'releasing'].includes(task.status)) extraButtons.append(actionButton('Отменить', 'cancel', 'danger'));
    extra.append(extraButtons); actions.append(extra); container.append(actions);
    let taskUsageBlock;
    if (task.usage_summary) {
      const usage = task.usage_summary; const wrapper = disclosure('Расход по задаче', 'usage'); const block = wrapper.content;
      block.append(el('p', 'usage-note muted', `Всего: ${tokenCount(usage.totals?.total_tokens)} · Вход: ${tokenCount(usage.totals?.input_tokens)} · Выход: ${tokenCount(usage.totals?.output_tokens)}`), el('p', 'section-note', `Подробных отчетов запусков: ${tokenCount(usage.reported_runs)} · Без подробностей: ${tokenCount(usage.unreported_runs)}. Итог включает только полученные счетчики.`));
      if (typeof usage.legacy_reports === 'number' && usage.legacy_reports > 0) block.append(el('p', 'section-note', `Старых отчетов: ${tokenCount(usage.legacy_reports)}. Их счетчики включены в итог; привязка к конкретным запускам не получена.`));
      const details = el('button', 'button quiet small', 'Расход и лимиты команды'); details.type = 'button'; details.addEventListener('click', openUsage); block.append(details);
      taskUsageBlock = wrapper.details;
    }
    if (task.status === 'ready_release') renderReleaseResult(container, task);
    const questions = (task.questions || []).filter(q => q.status !== 'cancelled');
    const unanswered = questions.filter(q => !q.answer?.trim());
    if (unanswered.length) renderQuestions(container, unanswered);
    const answered = questions.filter(q => q.answer?.trim());
    if (answered.length) {
      const wrapper = disclosure('Твои ответы', 'answers', answered.length); const block = wrapper.content;
      answered.forEach(q => { const item = el('div', 'answered-question'); item.append(el('strong', '', q.text), el('p', '', q.answer)); block.append(item); }); container.append(wrapper.details);
    }
    if (hasContent(task.spec)) appendDisclosure(container, 'План задачи', 'spec', content => renderSpec(content, task.spec));
    const children = state.tasks.filter(t => t.parent_id === task.id);
    if (children.length) appendDisclosure(container, 'Подзадачи', 'subtasks', content => children.forEach(child => content.append(taskCard(child))), children.length);
    const bugs = task.bugs || [];
    if (bugs.length) {
      const wrapper = disclosure('Найденные ошибки', 'bugs', bugs.length); const block = wrapper.content;
      bugs.forEach(bug => {
        const item = el('div', 'bug-card');
        item.append(el('strong', '', bug.title), el('p', 'bug-meta', `${bug.severity || 'Ошибка'} · ${bug.status === 'fixed' || bug.status === 'resolved' ? 'Исправлено' : bug.status === 'open' ? 'Открыто' : bug.status || 'Открыто'}`));
        if (bug.expected) item.append(el('p', '', `Ожидалось: ${bug.expected}`));
        if (bug.actual) item.append(el('p', '', `Получилось: ${bug.actual}`));
        if (bug.steps) item.append(el('p', '', `Как повторить: ${Array.isArray(bug.steps) ? bug.steps.join('\n') : bug.steps}`));
        block.append(item);
      }); container.append(wrapper.details);
    }
    if (hasContent(task.artifact)) appendDisclosure(container, 'Данные результата', 'artifact', content => renderArtifact(content, task.artifact));
    const runs = task.runs || [];
    if (runs.length) {
      const wrapper = disclosure('Отчеты команды', 'reports', runs.length); const block = wrapper.content;
      [...runs].reverse().forEach(run => {
        const item = el('div', 'run-item'); const heading = el('div', 'run-heading'); heading.append(el('strong', '', ROLE[run.role] || run.role || 'Исполнитель'), badge(run.status)); item.append(heading);
        renderRunExecution(item, run);
        renderRunUsage(item, run);
        if (run.summary) item.append(el('p', '', typeof run.summary === 'string' ? run.summary : JSON.stringify(run.summary, null, 2)));
        if (run.role === 'tester' && run.result?.passed === false && !run.result?.bugs?.length) {
          (run.result.artifact?.checks || []).filter(check => check.passed === false && check.name && check.detail)
            .forEach(check => item.append(el('p', 'run-error', `${check.name}: ${check.detail}`)));
        }
        if (run.error) {
          const knownErrors = { 'Codex exceeded the task time limit.': 'Шаг остановлен по лимиту времени. Частичные изменения сохранены.', 'bug severity must be nonempty text, at most 32 characters': 'Не удалось сохранить отчет тестировщика: неверно указана важность ошибки.', 'A failing QA report must contain a reproducible defect.': 'Не удалось сохранить неполный отчет проверки. Тестировщик не сообщил воспроизводимый дефект, но проверка не была завершена.' };
          item.append(el('p', 'run-error', typeof run.error === 'string' ? Object.hasOwn(knownErrors, run.error) ? knownErrors[run.error] : run.error : JSON.stringify(run.error)));
        }
        item.append(el('div', 'run-time', `${date(run.started_at, true)}${run.finished_at ? ` → ${date(run.finished_at, true)}` : ''}`)); block.append(item);
      }); container.append(wrapper.details);
    }
    const events = task.events || [];
    if (events.length) {
      const wrapper = disclosure('История задачи', 'history'); const block = wrapper.content; const list = el('div', 'event-list');
      [...events].reverse().slice(0, 50).forEach(event => {
        const item = el('div', 'event-item'); const time = el('time', '', date(event.created_at, true));
        if (event.created_at) time.dateTime = event.created_at;
        const eventNames = { task_created: 'Задача добавлена', task_updated: 'Задача обновлена', job_queued: `${ROLE[event.details?.role] || 'Исполнитель'} поставлен в очередь`, job_started: `${ROLE[event.details?.role] || 'Исполнитель'} начал работу`, job_completed: `${ROLE[event.details?.role] || 'Исполнитель'} завершил работу`, job_waiting: 'Ожидание лимита или входа', lease_expired: 'Связь с исполнителем потеряна, работа будет проверена перед повтором', job_failed: 'Запуск завершился с ошибкой', questions_answered: 'Ответы переданы аналитику', task_action: { analyze: 'Задача передана аналитику', start: 'Разработка запрошена', pause: 'Задача приостановлена', resume: 'Работа возобновлена', retry: 'Повторный запуск запрошен', cancel: 'Задача отменена' }[event.details?.action] || 'Состояние задачи изменено' };
        item.append(el('p', '', event.message && event.message !== event.type ? event.message : event.type === 'task_moved' ? 'Карточка перемещена на доске' : eventNames[event.type] || event.type), time); list.append(item);
      }); block.append(list); container.append(wrapper.details);
    }
    appendDisclosure(container, 'Описание задачи', 'description', content => {
      content.append(el('p', 'detail-description', task.description || 'Описание пока не добавлено.'));
      const meta = el('div', 'detail-meta'); meta.append(el('span', '', `Создана ${date(task.created_at, true)}`));
      if (task.updated_at) meta.append(el('span', '', `Обновлена ${date(task.updated_at, true)}`));
      meta.append(el('span', '', priority(task.priority)));
      if (task.parent_id) {
        const parent = el('button', 'button quiet small', 'Открыть родительскую задачу'); parent.type = 'button';
        parent.addEventListener('click', () => openTask(task.parent_id)); meta.append(parent);
      }
      content.append(meta);
    });
    if (taskUsageBlock) container.append(taskUsageBlock);
    $$('details[data-disclosure]', container).forEach(node => { node.open = expanded.has(node.dataset.disclosure); });
  }

  function renderQuestions(container, questions) {
    const form = el('form', 'question-box'); form.append(el('h3', '', 'Команде нужен твой ответ'), el('p', 'section-note', 'Ответь на вопросы, чтобы аналитик мог подготовить задачу к работе.'));
    questions.forEach((question, index) => {
      const item = el('div', 'question-item'); const label = el('label', '', question.text); const input = el('textarea');
      input.id = `answer-${index}`; label.htmlFor = input.id; input.name = String(question.id); input.rows = 2; input.required = true; input.maxLength = 10000; input.placeholder = 'Твой ответ'; input.addEventListener('input', () => { state.detailDirty = true; }); item.append(label, input); form.append(item);
    });
    const error = el('p', 'form-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const submit = el('button', 'button primary', 'Отправить ответы'); submit.type = 'submit'; form.append(error, submit);
    form.addEventListener('submit', async event => {
      event.preventDefault(); const id = state.taskId;
      const answers = questions.map((q, index) => ({ id: q.id, answer: $(`#answer-${index}`, form).value.trim() }));
      if (answers.some(a => !a.answer)) { error.textContent = 'Ответь на все вопросы. Если решение еще не принято, так и напиши.'; error.hidden = false; return; }
      try { await busy(submit, () => post(`tasks/${encodeURIComponent(id)}/answers`, { answers })); state.detailDirty = false; toast('Ответы переданы аналитику'); await loadState(); await refreshTask(true); }
      catch (err) { error.textContent = err.message; error.hidden = false; }
    }); container.append(form);
  }
  function renderSpec(container, spec) {
    const block = section('План и критерии приемки'); const card = el('div', 'spec-card');
    const names = { summary: 'Результат', goal: 'Цель', title: 'Название', description: 'Описание', scope: 'Объем работы', acceptance: 'Критерии приемки', acceptance_criteria: 'Критерии приемки', acceptanceCriteria: 'Критерии приемки', criteria: 'Критерии приемки', steps: 'Шаги', implementation: 'Реализация', dependencies: 'Зависимости', risks: 'Риски', assumptions: 'Допущения', non_goals: 'За рамками задачи', nonGoals: 'За рамками задачи', estimate: 'Оценка', priority: 'Приоритет', tasks: 'Декомпозиция', test_plan: 'План проверки', testPlan: 'План проверки', tests: 'Проверки', notes: 'Примечания' };
    const valueNode = value => {
      if (Array.isArray(value)) { const list = el('ul'); value.forEach(v => list.append(el('li', '', typeof v === 'object' && v !== null ? v.title || v.description || JSON.stringify(v, null, 2) : v))); return list; }
      return el('p', '', typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : value);
    };
    if (typeof spec === 'string') card.append(el('pre', '', spec));
    else if (Array.isArray(spec)) card.append(valueNode(spec));
    else Object.entries(spec).forEach(([key, value]) => { if (key === 'subtasks' || value === null || value === undefined || value === '' || Array.isArray(value) && !value.length) return; card.append(el('p', 'spec-heading', names[key] || key), valueNode(value)); });
    block.append(card); container.append(block);
    if (Array.isArray(spec.subtasks) && spec.subtasks.length) {
      const suggestions = section('Предложенная декомпозиция', spec.subtasks.length);
      suggestions.append(el('p', 'section-note', 'Создай отдельные задачи для шагов, которые хочешь передать команде независимо.'));
      spec.subtasks.forEach(subtask => {
        const title = typeof subtask === 'string' ? subtask : subtask.title || subtask.description || 'Подзадача';
        const acceptance = typeof subtask === 'object' && Array.isArray(subtask.acceptance) ? subtask.acceptance : [];
        const description = `${typeof subtask === 'string' ? '' : subtask.description || ''}${acceptance.length ? `\n\nКритерии приемки:\n${acceptance.map(item => `- ${item}`).join('\n')}` : ''}`;
        const item = el('div', 'suggested-subtask'); item.append(el('h3', '', title));
        if (description) item.append(el('p', '', description));
        const existing = state.tasks.find(t => t.parent_id === state.taskId && t.title === title);
        const button = el('button', 'button quiet small', existing ? 'Открыть подзадачу' : 'Создать подзадачу'); button.type = 'button';
        button.addEventListener('click', async () => {
          if (existing) return openTask(existing.id);
          try {
            await busy(button, () => post('tasks', { title, description, parent_id: state.taskId, priority: priority(subtask.priority || state.task?.priority) }));
            toast('Подзадача создана'); await loadState(); await refreshTask(true);
          } catch (error) { toast(error.message, true); }
        }); item.append(button); suggestions.append(item);
      }); container.append(suggestions);
    }
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }
  function renderReleaseResult(container, task) {
    const block = section('Результат для выпуска'); block.classList.add('release-result');
    block.append(el('p', 'section-note', state.runtime.release_enabled === false ? 'Публикация еще не настроена. Изменения проверены, но не установлены в игру.' : 'Изменения проверены. Подтверди выпуск, чтобы установить их в игру.'));
    container.append(block);
  }
  function renderArtifact(container, artifact) {
    const block = section('Результат разработки'); const card = el('div', 'artifact-card');
    const names = { commit: 'Версия кода', commit_sha: 'Версия кода', branch: 'Ветка', worktree: 'Рабочая копия', path: 'Путь', image: 'Образ', summary: 'Результат', preview_url: 'Предпросмотр', url: 'Ссылка', pull_request_url: 'Изменения', release_id: 'Выпуск' };
    if (typeof artifact === 'string') card.append(el('pre', '', artifact));
    else Object.entries(artifact).forEach(([key, value]) => {
      if (!value) return;
      const row = el('div', 'artifact-line'); row.append(el('span', '', names[key] || key));
      const url = typeof value === 'string' && /url$/.test(key) ? safeUrl(value) : null;
      if (url) { const link = el('a', '', 'Открыть ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); }
      else row.append(el('span', '', typeof value === 'object' ? JSON.stringify(value) : value));
      card.append(row);
    });
    block.append(card); container.append(block);
  }
  function showEdit(task, button) {
    if ($('.edit-form', $('#task-detail'))) return;
    const form = el('form', 'edit-form');
    const fields = [ ['title', 'Название', 'input'], ['description', 'Описание', 'textarea'] ];
    fields.forEach(([name, labelText, tag]) => {
      const label = el('label', '', labelText); const input = el(tag); input.id = `edit-${name}`; label.htmlFor = input.id; input.name = name; input.value = task[name] || ''; input.maxLength = name === 'title' ? 200 : 30000; if (name === 'title') input.required = true; input.addEventListener('input', () => { state.detailDirty = true; }); form.append(label, input);
    });
    const label = el('label', '', 'Приоритет'); label.htmlFor = 'edit-priority'; const select = el('select'); select.id = 'edit-priority'; select.name = 'priority';
    Object.entries({ P0: 'P0 · Критично', P1: 'P1 · Важно', P2: 'P2 · Плановое развитие', P3: 'P3 · Эксперимент' }).forEach(([value, text]) => { const option = el('option', '', text); option.value = value; select.append(option); }); select.value = priority(task.priority); select.addEventListener('change', () => { state.detailDirty = true; }); form.append(label, select);
    const error = el('p', 'form-error'); error.hidden = true; error.setAttribute('role', 'alert'); form.append(error);
    const footer = el('div', 'dialog-footer'); const cancel = el('button', 'button quiet', 'Отмена'); cancel.type = 'button'; cancel.addEventListener('click', () => { form.remove(); button.disabled = false; state.detailDirty = $$('.question-box textarea', $('#task-detail')).some(input => Boolean(input.value)); });
    const save = el('button', 'button primary', 'Сохранить'); save.type = 'submit'; footer.append(cancel, save); form.append(footer);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form)); payload.title = payload.title.trim();
      if (!payload.title) return;
      try { await busy(save, () => api(`tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })); state.detailDirty = false; toast('Задача обновлена'); await loadState(); await refreshTask(true); }
      catch (err) { error.textContent = err.message; error.hidden = false; }
    });
    button.disabled = true; state.detailDirty = true; $('.detail-actions', $('#task-detail')).after(form); $('#edit-title').focus();
  }

  function stopDevicePolling() { if (deviceTimer) clearInterval(deviceTimer); deviceTimer = null; state.deviceLogin = false; }
  function renderDeviceLogin(result) {
    const signature = JSON.stringify(result);
    if (signature === state.lastDeviceSignature) return;
    state.lastDeviceSignature = signature;
    const content = $('#codex-login-content'); content.replaceChildren();
    if (result.authenticated || result.status === 'authenticated' || result.status === 'success') {
      content.append(el('p', 'device-note', 'Codex подключен. Команда готова к работе.'));
      stopDevicePolling(); loadState(); toast('Codex подключен'); return;
    }
    if (['error', 'expired', 'failed'].includes(result.status)) {
      setError('#codex-login-error', result.error || 'Код истек. Закрой окно и начни подключение заново.'); stopDevicePolling(); return;
    }
    if (!result.code || !result.url) { content.append(el('p', 'device-note', 'Сервер готовит код входа…')); return; }
    content.append(el('code', 'device-code', result.code));
    const url = safeUrl(result.url);
    if (url) { const link = el('a', 'button primary device-login-link', 'Открыть страницу входа ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(link); }
    content.append(el('p', 'device-note', result.expires_at ? `Код действует до ${date(result.expires_at, true)}. После входа это окно обновится автоматически.` : 'После входа это окно обновится автоматически.'));
  }
  async function pollDeviceLogin() {
    if (!state.deviceLogin || document.hidden) return;
    try { renderDeviceLogin(await api('runtime/login')); }
    catch (error) { setError('#codex-login-error', error.message); if (error.status && error.status !== 503) stopDevicePolling(); }
  }
  async function startDeviceLogin() {
    const dialog = $('#codex-login-dialog'); if (dialog.open) return;
    if ($('#settings-dialog').open) $('#settings-dialog').close();
    dialog.showModal(); setError('#codex-login-error', ''); state.lastDeviceSignature = '';
    $('#codex-login-content').replaceChildren(el('p', 'device-note', 'Сервер готовит код входа…'));
    try {
      const result = await post('runtime/login', {}); state.deviceLogin = true;
      if (result.code || result.url || result.authenticated) renderDeviceLogin(result);
      await pollDeviceLogin();
      if (state.deviceLogin) deviceTimer = setInterval(pollDeviceLogin, 3000);
    } catch (error) { setError('#codex-login-error', error.message); }
  }

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); setError('#login-error', '');
    const email = $('#login-email').value.trim().toLowerCase();
    const password = $('#login-password').value;
    try {
      await busy($('#login-form button[type="submit"]'), () => setupToken ? post('setup', { token: setupToken, email, password }) : post('session', { email, password }));
      $('#login-password').value = '';
      if (setupToken) { const url = new URL(location.href); url.searchParams.delete('setup'); history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`); setupToken = null; }
      await loadState();
    } catch (error) { setError('#login-error', error.message); }
  });
  $('#create-form').addEventListener('submit', async event => {
    event.preventDefault(); setError('#create-error', '');
    const title = $('#create-title').value.trim(); if (!title) return;
    try {
      const result = await busy($('#create-form button[type="submit"]'), () => post('tasks', { title, description: $('#create-description').value.trim(), priority: $('#create-priority').value }));
      $('#create-dialog').close(); toast('Задача добавлена'); await loadState();
      const task = result.task || result; if (task.id) openTask(task.id);
    } catch (error) { setError('#create-error', error.message); }
  });
  $('#new-task-button').addEventListener('click', openCreate);
  $('#move-column').addEventListener('change', updateMovePosition);
  $('#move-form').addEventListener('submit', event => {
    event.preventDefault(); setError('#move-error', '');
    const task = boardMoveState.task; if (!task) return;
    void moveBoardTask(task, $('#move-column').value, $('#move-before').value || null, true);
  });
  $('#move-dialog').addEventListener('close', () => { boardMoveState.task = null; });
  $('#empty-create-button').addEventListener('click', openCreate);
  $('#task-close').addEventListener('click', () => $('#task-dialog').close());
  $('#task-dialog').addEventListener('close', () => {
    state.taskId = null; state.task = null; state.progressTask = null; state.detailDirty = false;
    if (linkedTaskId()) { const url = new URL(location.href); url.hash = ''; history.replaceState(null, '', `${url.pathname}${url.search}`); }
  });
  window.addEventListener('hashchange', () => { const id = linkedTaskId(); if (state.authenticated && id && id !== state.taskId) openTask(id); });
  $$('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); }));
  $$('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('[data-filter]').forEach(item => item.classList.toggle('selected', item === button)); renderBoard(true); }));
  $('#task-search').addEventListener('input', event => { state.search = event.target.value; renderBoard(true); });
  $('#board-nav').addEventListener('click', () => { $('#task-search').value = ''; state.search = ''; state.filter = 'active'; $$('[data-filter]').forEach(item => item.classList.toggle('selected', item.dataset.filter === 'active')); renderBoard(true); });
  $('#settings-button').addEventListener('click', () => { renderRuntime(); renderProfiles(); setError('#settings-error', ''); $('#settings-dialog').showModal(); });
  $('#knowledge-button').addEventListener('click', openKnowledge);
  $('#usage-button').addEventListener('click', openUsage);
  $('#usage-card').addEventListener('click', openUsage);
  $('#usage-mobile').addEventListener('click', openUsage);
  $('#usage-refresh').addEventListener('click', refreshUsage);
  $('#knowledge-refresh').addEventListener('click', () => { clearTimeout(knowledgeState.timer); knowledgeState.timer = null; loadKnowledge(); });
  $('#knowledge-search-form').addEventListener('submit', event => { event.preventDefault(); clearTimeout(knowledgeState.timer); knowledgeState.timer = null; loadKnowledge(); });
  $('#knowledge-search').addEventListener('input', () => {
    clearTimeout(knowledgeState.timer);
    knowledgeState.timer = setTimeout(() => { knowledgeState.timer = null; loadKnowledge(); }, 300);
  });
  $('#knowledge-dialog').addEventListener('close', () => {
    clearTimeout(knowledgeState.timer); knowledgeState.timer = null; knowledgeState.request += 1; knowledgeState.fetching = false;
    $('#knowledge-refresh').disabled = false; $('#knowledge-content').setAttribute('aria-busy', 'false');
    $('#knowledge-button').classList.remove('active'); $('#board-nav').classList.add('active');
  });
  $('#role-profiles-reset').addEventListener('click', () => { state.profilesDirty = false; state.profileDraft = null; state.profileMessage = ''; setError('#role-profiles-error', ''); renderProfiles(true); });
  $('#role-profiles-form').addEventListener('submit', async event => {
    event.preventDefault(); setError('#role-profiles-error', '');
    const profiles = copyProfiles(state.profileDraft); const error = profileError(profiles);
    if (error) { setError('#role-profiles-error', error); return; }
    if (!state.profilesDirty || state.profilesSaving) return;
    state.profilesSaving = true; state.profilesVersion += 1; renderProfiles(true);
    try {
      await post('settings', { role_profiles: profiles });
      state.profilesVersion += 1;
      state.settings.role_profiles = profiles; state.profileDraft = copyProfiles(profiles); state.profilesDirty = false; state.profileMessage = 'Настройки сохранены. Они применятся к новым запускам.';
      toast('Настройки ролей сохранены');
      await loadState();
    } catch (error) { setError('#role-profiles-error', error.message); }
    finally { state.profilesSaving = false; renderProfiles(true); }
  });
  $('#global-pause').addEventListener('click', async () => {
    try { await busy($('#global-pause'), () => post('settings', { paused: !state.settings.paused })); await loadState(); toast(state.settings.paused ? 'Новые запуски приостановлены' : 'Команда продолжает работу'); }
    catch (error) { toast(error.message, true); }
  });
  $('#auto-develop').addEventListener('change', async event => {
    const input = event.target; input.disabled = true; setError('#settings-error', '');
    try { await post('settings', { auto_develop: input.checked }); await loadState(); toast(input.checked ? 'Автоматическая разработка включена' : 'Разработка начинается по твоей команде'); }
    catch (error) { input.checked = Boolean(state.settings.auto_develop); setError('#settings-error', error.message); }
    finally { input.disabled = false; }
  });
  async function logout() { try { await post('session/logout', {}); state.tasks = []; state.signature = ''; showLogin(); } catch (error) { toast(error.message, true); } }
  $('#logout-button').addEventListener('click', logout);
  $('#settings-logout-button').addEventListener('click', logout);
  $('#runtime-login-button').addEventListener('click', startDeviceLogin);
  $('#settings-login-button').addEventListener('click', startDeviceLogin);
  $('#codex-login-dialog').addEventListener('close', stopDevicePolling);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.authenticated) { loadState({ quiet: true }); pollDeviceLogin(); if (!knowledgeState.fetching && !knowledgeState.timer) loadKnowledge({ quiet: true }); } });
  setInterval(() => { if (state.authenticated && !document.hidden) loadState({ quiet: true }); }, 5000);
  setInterval(() => { if (state.authenticated && !document.hidden && !knowledgeState.fetching && !knowledgeState.timer) loadKnowledge({ quiet: true }); }, 30000);
  setInterval(() => { if (state.authenticated && !document.hidden) { refreshProgressDisplays(); renderUsage(); } }, 1000);
  if (setupToken) showLogin(); else loadState({ quiet: true });
})();
