import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const snapshot = process.env.ROYAL_MODULE_BASELINE;
test('module migration preserves the current production backend, wallet, rules and required assets', { skip: !snapshot }, async context => {
 const baseline = JSON.parse(await readFile(resolve(snapshot!), 'utf8')) as { source: Record<string, string> };
 const migratedViews = new Set([
  'ActivitiesUI', 'StudioGamesUI', 'OriginalGames', 'CasinoExpansionUI', 'LuelonGameRouter',
  'DiceSlotUI', 'GithubGames', 'CasinoApiProUI', 'CasinoVariantsUI', 'CasinoNextVariantsUI',
  'CasinoBatchVariantsUI', 'RoyalCoins',
 ].map(name => `src/ui/${name}.ts`));
 migratedViews.add('src/ui/slotKit/nativeSlots.ts');
 const protectedSource = Object.entries(baseline.source).filter(([name]) => !/\.(?:orig|bak)$/.test(name) && (
  name.startsWith('server/') && name !== 'server/gameModuleAssets.ts'
  || name.startsWith('src/shared/') || name.startsWith('src/wallet/') || name.startsWith('src/i18n/')
  || name.startsWith('public/') || name.startsWith('src/game/')
  || name.startsWith('src/ui/') && !migratedViews.has(name)
  || /^src\/[^/]+\.css$/.test(name)),
 );
 assert.ok(protectedSource.length > 500, 'The fresh production fingerprint must cover the complete release');
 context.diagnostic(`Protected production files: ${protectedSource.length}`);
 const changed: string[] = [];
 for (const [name, expected] of protectedSource) {
  try {
   const hash = createHash('sha256').update(await readFile(resolve(name))).digest('hex');
   if (hash !== expected) changed.push(name);
  } catch { changed.push(name + ' (missing)'); }
 }
 assert.deepEqual(changed, [], 'Modular packaging must preserve current production behavior and assets');
});
