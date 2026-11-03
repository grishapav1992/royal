import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { posix, matchesGlob, resolve } from 'node:path';
import { readGraphSeed } from '../ai-factory/lib/knowledge-graph.mjs';

export const BRAIN_SCHEMA = 1;
export const knowledgeSeed = 'ai-factory/project-knowledge/graph-seed.json';
export const mathPolicy = 'scripts/game-math/rtp-policy.json';
const idFor = key => 'royal_brain_' + createHash('sha256').update(key).digest('hex').slice(0, 24);
const clean = text => String(text).replaceAll('\u2014', '-');

export async function collectBrain(root, input, provenance) {
  const files = new Map(input.inputs.map(file => [file.path, file]));
  const records = [], edges = [], fileLinks = [], unresolved = [];
  const byKey = new Map();
  const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  function record(kind, key, title, source, details = {}) {
    if (byKey.has(key)) throw Error('Duplicate project brain key: ' + key);
    const value = { id: idFor(key), kind, key, title: clean(title), source, ...details, links: [] };
    records.push(value); byKey.set(key, value); return value;
  }
  function connect(source, target, relation, evidence) {
    edges.push({ source: source.id, target: target.id, relation, confidence: 'EXTRACTED',
      source_file: evidence, source_location: 'L1', _origin: 'ast' });
    source.links.push({ relation, record: target.key, title: target.title });
  }
  function linkFile(source, path, relation, evidence = source.source) {
    const normalized = posix.normalize(path);
    if (!files.has(normalized)) {
      unresolved.push({ record: source.key, path: normalized, relation, state: 'not_indexed' });
      return;
    }
    fileLinks.push({ source: source.id, path: normalized, relation, evidence });
    source.links.push({ relation, path: normalized, sha256: files.get(normalized).sha256 });
  }
  const project = record('repository', 'project:royal', 'Рояль: исходники проекта', 'AGENTS.md',
    { summary: 'Текущий снимок кода и документов. Наличие исходников не подтверждает публикацию.', ...provenance });
  for (const path of ['AGENTS.md', 'README.md', 'deployment/SERVER.md', 'docs/development-workflow.md']) {
    linkFile(project, path, 'documented_by');
  }
  const packages = [];
  for (const path of files.keys()) {
    if (posix.basename(path) !== 'package.json') continue;
    const pkg = await json(path), directory = posix.dirname(path);
    packages.push({ path, directory, pkg });
    if (!/^games\/[^/]+\/package\.json$/.test(path) || typeof pkg.gameId !== 'string') continue;
    const module = record('module', 'module:' + pkg.gameId, 'Модуль ' + pkg.gameId, path, {
      summary: 'Независимый пакет в исходниках. Доступность для игроков здесь не определяется.',
      gameId: pkg.gameId, version: pkg.version, apiVersion: pkg.apiVersion,
      rulesVersion: pkg.rulesVersion, progressVersion: pkg.progressVersion, directory,
    });
    connect(project, module, 'declares_module', path);
    linkFile(module, path, 'declared_in');
    if (typeof pkg.entry === 'string') linkFile(module, posix.join(directory, pkg.entry), 'entry');
    for (const source of input.sources) if (source.startsWith(directory + '/')) linkFile(module, source, 'contains_source');
  }
  for (const { path, directory, pkg } of packages) {
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (typeof command !== 'string') continue;
      const script = record('command', 'command:' + path + ':' + name, 'npm ' + (directory === '.' ? '' : directory + ' ') + name, path,
        { summary: 'Команда из package.json. Её наличие не означает успешное выполнение.' });
      connect(project, script, 'declares_command', path);
      linkFile(script, path, 'declared_in');
      const module = byKey.get('module:' + pkg.gameId);
      if (module) connect(module, script, 'declares_command', path);
      const tokens = command.match(/[A-Za-z0-9_./*?{}-]+\.(?:mjs|cjs|js|tsx|ts|py|sh|json)\b/g) ?? [];
      for (const token of new Set(tokens)) {
        const pattern = posix.normalize(posix.join(directory, token));
        if (pattern.startsWith('../') || posix.isAbsolute(pattern)) continue;
        for (const candidate of files.keys()) if (matchesGlob(candidate, pattern)) linkFile(script, candidate, 'references_source');
      }
      for (const match of command.matchAll(/\bnpm run ([\w:-]+)/g)) {
        script.commandReferences ??= []; script.commandReferences.push('command:' + path + ':' + match[1]);
      }
    }
  }
  for (const item of records.filter(item => item.kind === 'command')) {
    for (const key of new Set(item.commandReferences ?? [])) {
      if (byKey.has(key)) connect(item, byKey.get(key), 'references_command', item.source);
    }
    delete item.commandReferences;
  }
  if (files.has(mathPolicy)) {
    const policy = await json(mathPolicy);
    const profiles = [];
    for (const group of ['profiles', 'stakePolicies', 'nonWagered']) {
      for (const [gameId, profile] of Object.entries(policy[group] ?? {})) profiles.push({ group, gameId,
        profile: typeof profile === 'string' ? { note: profile } : profile });
    }
    for (const [gameId, versions] of Object.entries(policy.versionProfiles ?? {})) {
      for (const [version, profile] of Object.entries(versions)) profiles.push({ group: 'versionProfiles/' + version, gameId, profile });
    }
    for (const { group, gameId, profile } of profiles) {
      const item = record('math_policy', 'math:' + group + ':' + gameId, 'Математическая политика ' + gameId + ' (' + group + ')', mathPolicy,
        { summary: group === 'nonWagered' ? 'Декларация бесплатной механики: ' + profile.note
          : 'Декларация политики и ссылок на доказательства. Актуальность квалификации проверяет check:rtp.',
          gameId, group, rulesVersion: profile.rulesVersion, progressVersion: profile.progressVersion,
          declaredTarget: profile.target, qualificationState: 'not_evaluated' });
      connect(project, item, 'declares_math_policy', mathPolicy);
      const module = byKey.get('module:' + gameId);
      if (module) connect(module, item, 'declared_policy', mathPolicy);
      linkFile(item, mathPolicy, 'declared_in');
      for (const path of profile.sources ?? []) linkFile(item, path, 'declares_rule_source');
      if (profile.qualificationSource) linkFile(item, profile.qualificationSource, 'qualification_program');
      if (profile.proof) linkFile(item, profile.proof, 'declared_proof');
    }
  }
  const evidenceDrift = new Map();
  if (files.has(knowledgeSeed)) {
    const seed = await json(knowledgeSeed);
    const entries = await readGraphSeed(resolve(root, knowledgeSeed));
    for (const entry of entries) {
      const review = seed.record_reviews?.[entry.id];
      const evidence = entry.evidence.map(proof => {
        const path = proof.path.startsWith('project-knowledge/') ? 'ai-factory/' + proof.path : proof.path;
        const actual = files.get(path)?.sha256 ?? null;
        const state = !actual ? 'not_indexed' : actual === proof.sha256 ? 'matches_recorded_hash' : 'changed';
        const result = { path, expected: proof.sha256, actual, state };
        if (state !== 'matches_recorded_hash') evidenceDrift.set(path, result);
        return result;
      });
      const state = evidence.every(proof => proof.state === 'matches_recorded_hash') ? 'matches_recorded_hash' : 'needs_review';
      const title = entry.kind === 'entity' ? entry.name : entry.source + ' ' + entry.predicate + ' ' + entry.target;
      const item = record('knowledge', 'knowledge:' + entry.id, title + (state === 'needs_review' ? ' [требует пересмотра]' : ''), knowledgeSeed,
        { summary: entry.summary ?? entry.text, recordedStatus: entry.status, recordedEnvironment: entry.environment,
          seedVersion: review?.version ?? seed.legacy_record_version ?? seed.version,
          knowledgeSetVersion: seed.version, reviewedAt: review?.checked_at, reviewedSourceCommit: review?.source_commit,
          evidenceState: state, evidence,
          liveProductionState: 'not_checked', originalId: entry.id, originalKind: entry.kind });
      connect(project, item, 'records_knowledge', knowledgeSeed);
      for (const proof of evidence) linkFile(item, proof.path, 'cites_evidence', knowledgeSeed);
    }
    for (const entry of entries.filter(entry => entry.kind === 'relation')) {
      const relation = byKey.get('knowledge:' + entry.id);
      connect(relation, byKey.get('knowledge:' + entry.source), 'recorded_subject', knowledgeSeed);
      connect(relation, byKey.get('knowledge:' + entry.target), 'recorded_object', knowledgeSeed);
    }
  }
  const counts = Object.fromEntries(['repository', 'module', 'command', 'math_policy', 'knowledge']
    .map(kind => [kind, records.filter(item => item.kind === kind).length]));
  const index = { schemaVersion: BRAIN_SCHEMA, provenance, counts, records,
    evidenceDrift: [...evidenceDrift.values()], unresolvedReferences: unresolved,
    reviewedKnowledge: records.filter(item => item.reviewedAt).length,
    knowledgeNeedingReview: records.filter(item => item.evidenceState === 'needs_review').length };
  const nodes = records.map(item => ({ id: item.id,
    label: item.title + (item.kind === 'knowledge' ? ' [запись ' + item.seedVersion + '; ' + item.evidenceState + ']' : ''), file_type: 'concept',
    source_file: item.source, source_location: 'L1', _origin: 'ast', brain_kind: item.kind,
    evidence_state: item.evidenceState ?? 'declared_in_source' }));
  return { index, nodes, edges, fileLinks };
}

export function formatBrainQuery(index, question) {
  const normalize = value => clean(value).toLowerCase().replaceAll('ё', 'е');
  const ignored = new Set(['что', 'как', 'где', 'для', 'или', 'это', 'есть', 'проекта', 'проект', 'the', 'how', 'what', 'does', 'with']);
  const words = [...new Set(normalize(question).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].filter(word => !ignored.has(word));
  const exact = normalize(question).trim();
  const precise = exact ? index.records.filter(item => normalize(item.title + ' ' + item.key).includes(exact)) : [];
  const candidates = precise.length ? precise : index.records;
  const ranked = candidates.map(item => {
    const title = normalize(item.title + ' ' + item.key), body = normalize(item.summary ?? '');
    const score = words.reduce((sum, word) => sum + (title.includes(word) ? 10 : body.includes(word) ? 1 : 0), 0);
    return { item, score };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.item.key.localeCompare(b.item.key));
  const lines = ['Снимок репозитория grishapav1992/royal, коммит ' + index.provenance.commit + '.',
    index.provenance.workingTreeModified ? 'Карта содержит локальные изменения отслеживаемых файлов.' : 'Карта построена из закоммиченных файлов.',
    'Статус production здесь не проверяется. Совпадение хеша документа не подтверждает актуальность всех его утверждений.', ''];
  for (const { item } of ranked.slice(0, 6)) {
    lines.push('[' + item.kind + '] ' + item.title, 'Источник: ' + item.source, item.summary ?? '');
    if (item.evidence) {
      lines.push('Зафиксированный статус: ' + item.recordedStatus + ', окружение: ' + item.recordedEnvironment + ', версия знаний: ' + item.seedVersion + '.');
      if (item.reviewedAt) lines.push('Пересмотр по исходникам: ' + item.reviewedAt + ', коммит ' + item.reviewedSourceCommit + '.');
      for (const proof of item.evidence) lines.push('  Доказательство: ' + proof.path + ' [' + proof.state + ']');
    }
    if (item.kind === 'module') lines.push('Версия пакета: ' + item.version + ', правила: ' + item.rulesVersion + ', прогресс: ' + item.progressVersion + '.');
    for (const link of item.links.slice(0, 8)) lines.push('  ' + link.relation + ': ' + (link.path ?? link.title));
    if (item.links.length > 8) lines.push('  Ещё связей: ' + (item.links.length - 8) + '. Полный список находится в project-brain.json и graph.json.');
    lines.push('');
  }
  if (!ranked.length) lines.push('Совпадений в предметном слое нет. Используй graph:query для поиска по коду и документации.');
  if (ranked.length > 6) lines.push('Показано 6 из ' + ranked.length + ' совпадений. Уточни название или идентификатор.');
  return { text: clean(lines.join('\n')), found: ranked.length > 0 };
}

export function brainReport(index) {
  const { counts, provenance } = index;
  const lines = ['# Знания проекта «Рояль»', '', 'Коммит: `' + provenance.commit + '`. Git tree: `' + provenance.tree + '`.',
    '', provenance.workingTreeModified ? 'Включены локальные изменения отслеживаемых файлов.' : 'Основа: закоммиченные файлы текущей версии проекта.',
    '', '## Что связано', '', '| Объекты | Количество |', '| --- | --- |',
    '| Независимые игровые пакеты | ' + counts.module + ' |', '| Команды из package.json | ' + counts.command + ' |',
    '| Декларации математических политик | ' + counts.math_policy + ' |', '| Сохранённые сущности и отношения знаний | ' + counts.knowledge + ' |',
    '', '```mermaid', 'flowchart LR', '  Git["Git: текущий коммит"] --> Sources["Исходники и документы"]',
    '  Sources --> Structure["Функции, импорты, ссылки"]', '  Packages["Пакеты игр"] --> Sources',
    '  Commands["Команды проверок"] --> Sources', '  Policies["Математические политики"] --> Sources',
    '  Knowledge["Сохранённые факты"] --> Evidence["Источники и хеши"]', '  Evidence --> Sources',
    '  Structure --> Queries["Поиск и проверка связей"]', '```', '', '## Что требует внимания', '',
    'Записей знаний, чьи источники требуют пересмотра: ' + index.knowledgeNeedingReview + '.',
    'Записей с отдельной датой и коммитом проверки по исходникам: ' + index.reviewedKnowledge + '.',
    'Ссылок на исключённые или отсутствующие в выбранной карте файлы: ' + index.unresolvedReferences.length + '.', ''];
  for (const proof of index.evidenceDrift) lines.push('- `' + proof.path + '`: ' + proof.state + '. Старый хеш сохранён, запись не обновлялась автоматически.');
  lines.push('', 'Совпадение хеша означает только совпадение текста с зафиксированным источником. Это не новая проверка утверждения или работающего сервера.',
    'Пакет игры в исходниках не означает её доступность игрокам. Декларация политики не заменяет `npm run check:rtp`.',
    'История старых коммитов, незавершённые ветки, чаты и локальные данные Graphiti в этот снимок не включены.',
    '', '## Использование', '', '```sh', 'npm run brain:query -- "кошелёк"', 'npm run brain:query -- "studio-forest-heart"',
    'npm run graph:explain -- "loadGameModule"', 'npm run brain:status', '```', '',
    'Предметные связи включены в тот же `graph.json`. `project-brain.json` содержит компактный индекс, источники и состояния доказательств.', '');
  return clean(lines.join('\n'));
}
