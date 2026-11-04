import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {STAKE_PRECISION_METHOD} from './rtp-stakes.mjs';

// Existing definitions with separate historical terms remain verifiable.
// This is not an RTP exemption or permission to publish or reopen them.
// Do not extend this set to admit a new game with separate stake terms.
const priorSeparateStakeDefinitions = new Set([
  'mortal-kombat', 'tsu-e-fa', 'studio-wild-nudge', 'flag-tote',
]);

export async function stakeAdmissionRuntime(root) {
  const result = await build({
    stdin: {
      contents: "export * from './src/shared/gameStakes.ts'; export {ROYAL_PLATFORM_GAMES} from './src/shared/arcadeCatalog.ts';",
      resolveDir: root,
    },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
}

export function validateStakeAdmission(catalog, legacyGames, registry, runtime) {
  assert.equal(runtime.GAME_STAKE_CENTS[0], 10, 'The common minimum stake must remain ten cents');
  assert.equal(runtime.DEFAULT_GAME_STAKE, '10', 'New games must default to ten cents');
  assert.equal(runtime.DEFAULT_GAME_BET, .1, 'The common dollar default must be ten cents');
  const legacy = new Set(legacyGames);
  const modules = new Set(catalog.map(game => game.gameId));
  const nonWagered = id => !registry.profiles[id] && typeof registry.nonWagered[id] === 'string'
    && registry.nonWagered[id].trim().length >= 20;
  const required = new Set(runtime.ROYAL_PLATFORM_GAMES.filter(id => !nonWagered(id)));
  for (const {gameId,rulesVersion} of catalog) {
    if (gameId==='tsu-e-fa'&&rulesVersion>=3 || !legacy.has(gameId) && !priorSeparateStakeDefinitions.has(gameId) && !nonWagered(gameId)) required.add(gameId);
  }
  for (const id of required) {
    assert(modules.has(id), 'Playable game has no independent module: ' + id);
    const policy = registry.stakePolicies?.[id];
    assert(policy, 'New or playable wagered game requires the common ten-cent stake policy: ' + id);
    assert(runtime.usesGameStakes(id), 'Register the game in the common stake runtime: ' + id);
    assert.equal(policy.method, STAKE_PRECISION_METHOD, 'Complete-round precision qualification is required: ' + id);
    assert.equal(policy.stakePolicyVersion, 1, 'Use the qualified common stake policy: ' + id);
    assert.deepEqual(policy.stakes, runtime.GAME_STAKE_CENTS, 'Every common denomination must be qualified: ' + id);
    if(policy.kind!=='pvp'){
      assert.deepEqual(policy.manualStakeRange,{minimumCents:10,maximumCents:5000,stepCents:1},'Qualify the complete manual stake range: '+id);
      assert(policy.sources.includes('scripts/game-math/manual-stakes.mjs'),'Bind manual stake qualification: '+id);
    }
    assert.equal(policy.ordinaryStakeBasis ?? 'total-round', 'total-round', 'The ordinary stake funds the complete round, including every selected line: ' + id);
    for (const source of ['src/shared/gameStakes.ts', 'src/shared/roundPrecision.ts']) {
      assert(policy.sources.includes(source), 'Bind common money sources into stake qualification: ' + id + ': ' + source);
    }
  }
  return required.size;
}
