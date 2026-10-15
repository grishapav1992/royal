import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runBasic } from './basic.mjs';
import { runCombinatorics } from './combinatorics.mjs';
import { runCrashStudy } from './crash.mjs';
import { runCardsSlots } from './cards-slots.mjs';
import { runRisk } from './risk.mjs';

const outputDir = 'artifacts/game-math';
mkdirSync(outputDir, { recursive: true });
const startedAt = new Date().toISOString();
const iterations = [];
for (const run of [runBasic, runCombinatorics, runCrashStudy, runCardsSlots, runRisk]) {
  const result = run();
  for (const iteration of result.iterations) {
    assert.equal(iteration.id, iterations.length + 1, 'The study must have exactly ten ordered iterations');
    assert.ok(iteration.checks.length > 0, 'Every iteration needs evidence');
    assert.ok(iteration.checks.every(check => check.passed === true), 'Every required check must pass');
    const record = { ...iteration, completedAt: new Date().toISOString(), status: 'verified' };
    iterations.push(record);
    writeFileSync(`${outputDir}/iteration-${String(record.id).padStart(2, '0')}.json`, JSON.stringify(record, null, 2) + '\n');
    console.log(`${record.id}/10: ${record.title ?? record.game}: ${record.checks.length} check groups passed`);
  }
}
assert.equal(iterations.length, 10);
const sourcePaths = ['scripts/game-math/rational.mjs', 'scripts/game-math/basic.mjs', 'scripts/game-math/combinatorics.mjs', 'scripts/game-math/crash.mjs', 'scripts/game-math/cards-slots.mjs', 'scripts/game-math/risk.mjs', 'scripts/game-math/run.mjs'];
const result = {
  objective: 'изучать математику игр, сделай 10 итераций',
  studyDate: '2026-10-07', startedAt, completedAt: new Date().toISOString(),
  iterationCount: iterations.length,
  checkGroupCount: iterations.reduce((n, iteration) => n + iteration.checks.length, 0),
  productionEconomicsChanged: false,
  sampleTargetRtp: '97/100',
  assumptions: ['Новые таблицы являются собственными исследовательскими примерами, без изменения работающих правил.', 'Каждая итерация содержит расчёт, воспроизводимые проверки и границы выводов.', 'Полный перебор применяется к указанным конечным доменам; аналитические большие домены и симуляции описаны отдельно.'],
  sources: sourcePaths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
  iterations,
};
const json = JSON.stringify(result, null, 2) + '\n';
assert.ok(!json.includes(String.fromCharCode(0x2014)), 'Forbidden punctuation');
writeFileSync(`${outputDir}/study-results.json`, json);
console.log(`Verified ${result.iterationCount} iterations and ${result.checkGroupCount} check groups.`);
