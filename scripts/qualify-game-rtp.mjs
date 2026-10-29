import {qualifyRoulette} from './game-math/rtp-roulette.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rtpInputs, validateRtpProof } from './game-math/rtp-gate.mjs';
import { preflight, simulateDracona, simulateNeopolis } from './game-math/rtp-simulation.mjs';
import { qualifyNeopolisV4 } from './game-math/rtp-neopolis-v4.mjs';
import { qualifyCombat } from './game-math/rtp-combat.mjs';
import {qualifyVirtualPvp} from './game-math/rtp-virtual-pvp.mjs';
import {qualifyCosmic} from './game-math/rtp-cosmic.mjs';
import {qualifyForestHeart} from './game-math/rtp-forest-heart.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), args = process.argv.slice(2);
const index = args.indexOf('--game'), gameId = index < 0 ? undefined : args[index + 1];
assert(['royal-roulette','studio-forest-heart','studio-neopolis','studio-dracona','studio-cosmic-escape','mortal-kombat','hockey','pool','chess','durak','transfer-durak','crazy-eights'].includes(gameId), 'Choose a registered paid game');
const inputs = await rtpInputs(root, gameId), startedAt = new Date().toISOString();
const exact = gameId==='royal-roulette'?await qualifyRoulette(inputs.policy):gameId==='studio-forest-heart'?await qualifyForestHeart(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='studio-neopolis'&&inputs.policy.method==='neopolis-variable-stake-conditional-v4'?qualifyNeopolisV4(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='studio-cosmic-escape'?await qualifyCosmic(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='mortal-kombat'?qualifyCombat(inputs.policy):inputs.policy.method==='exhaustive-virtual-pvp-pot'?qualifyVirtualPvp(gameId,inputs.policy):undefined;
const serverReplayChecks = exact?.serverReplayChecks??preflight(gameId, inputs.policy);
console.log(JSON.stringify({ gameId, phase: 'server-replay', serverReplayChecks }));
const sample = exact??(gameId === 'studio-neopolis' ? simulateNeopolis : simulateDracona)(inputs.policy, value => console.log(JSON.stringify(value)));
assert.deepEqual(await rtpInputs(root, gameId), inputs, 'Sources changed during qualification');
const proof = { schemaVersion: 1, gameId, rulesVersion: inputs.policy.rulesVersion, progressVersion: inputs.policy.progressVersion,
  startedAt, completedAt: new Date().toISOString(), sourceHashes: inputs.sourceHashes, policySha256: inputs.policySha256, serverReplayChecks, ...sample };
const artifact = resolve(root, 'artifacts/rtp-qualification', gameId + '.json');
await mkdir(dirname(artifact), { recursive: true }); await writeFile(artifact, JSON.stringify(proof,null,2)+'\n');
validateRtpProof(gameId, inputs, proof);
if (args.includes('--write-proof')) {
  const target = resolve(root, inputs.policy.proof); await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(proof,null,2)+'\n');
}
console.log(JSON.stringify({ gameId, qualified: true, results: proof.results.map(row => ({ choice: row.choice, stakeUnits: row.stakeUnits, paidRounds: row.paidRounds, rtp: row.rtp, interval95: row.interval95,rtpBounds:row.rtpBounds })) }));
