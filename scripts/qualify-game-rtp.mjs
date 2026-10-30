import {qualifyWildNudge} from './game-math/rtp-wild-nudge.mjs';
import {qualifyFlagBattle} from './game-math/rtp-flag-battle.mjs';
import {readFile} from 'node:fs/promises';
import {CASCADE_METHOD,qualifyTempleCascade} from './game-math/rtp-temple-cascade.mjs';
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
import {qualifyTsuEFa} from './game-math/rtp-tsu-e-fa.mjs';
import {qualifyCosmic} from './game-math/rtp-cosmic.mjs';
import {qualifyTemple} from './game-math/rtp-temple.mjs';
import {qualifyForestHeart} from './game-math/rtp-forest-heart.mjs';
import {qualifyCaribbean} from './game-math/rtp-caribbean.mjs';
import {qualifyJackie} from './game-math/rtp-jackie.mjs';
import {preflightAfterglow,simulateAfterglow} from './game-math/rtp-afterglow.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), args = process.argv.slice(2);
const index = args.indexOf('--game'), gameId = index < 0 ? undefined : args[index + 1];
assert(['studio-wild-nudge','tsu-e-fa','flag-battle','original-jackie-chan','royal-roulette','studio-forest-heart','studio-flooded-temple','studio-afterglow','studio-caribbean-treasures','studio-neopolis','studio-dracona','studio-cosmic-escape','mortal-kombat','hockey','pool','chess','durak','transfer-durak','crazy-eights'].includes(gameId), 'Choose a registered paid game');
const registry=JSON.parse(await readFile(resolve(root,'scripts/game-math/rtp-policy.json'),'utf8'));
const rulesIndex=args.indexOf('--rules');
const versions=rulesIndex>=0?[Number(args[rulesIndex+1])]:[registry.profiles[gameId].rulesVersion,...Object.keys(registry.versionProfiles?.[gameId]??{}).map(Number)];
for(const rulesVersion of versions){
const inputs = await rtpInputs(root, gameId,rulesVersion), startedAt = new Date().toISOString();
const exact = gameId==='tsu-e-fa'?qualifyTsuEFa(gameId,inputs.policy):gameId==='studio-wild-nudge'?await qualifyWildNudge(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='flag-battle'?qualifyFlagBattle(inputs.policy):gameId==='original-jackie-chan'?await qualifyJackie(inputs.policy):gameId==='royal-roulette'?await qualifyRoulette(inputs.policy):gameId==='studio-forest-heart'?await qualifyForestHeart(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='studio-flooded-temple'?(inputs.policy.method===CASCADE_METHOD?await qualifyTempleCascade(inputs.policy,value=>console.log(JSON.stringify(value))):await qualifyTemple(inputs.policy,value=>console.log(JSON.stringify(value)))):gameId==='studio-neopolis'&&inputs.policy.method==='neopolis-variable-stake-conditional-v4'?qualifyNeopolisV4(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='studio-caribbean-treasures'?await qualifyCaribbean(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='studio-cosmic-escape'?await qualifyCosmic(inputs.policy,value=>console.log(JSON.stringify(value))):gameId==='mortal-kombat'?qualifyCombat(inputs.policy):inputs.policy.method==='exhaustive-virtual-pvp-pot'?qualifyVirtualPvp(gameId,inputs.policy):undefined;
const serverReplayChecks = exact?.serverReplayChecks??(gameId==='studio-afterglow'?preflightAfterglow(inputs.policy):preflight(gameId, inputs.policy));
console.log(JSON.stringify({ gameId, phase: 'server-replay', serverReplayChecks }));
const sample = exact??(gameId==='studio-afterglow'?simulateAfterglow:gameId === 'studio-neopolis' ? simulateNeopolis : simulateDracona)(inputs.policy, value => console.log(JSON.stringify(value)));
assert.deepEqual(await rtpInputs(root, gameId,rulesVersion), inputs, 'Sources changed during qualification');
const proof = { schemaVersion: 1, gameId, rulesVersion: inputs.policy.rulesVersion, progressVersion: inputs.policy.progressVersion,
  startedAt, completedAt: new Date().toISOString(), sourceHashes: inputs.sourceHashes, policySha256: inputs.policySha256, serverReplayChecks, ...sample };
const artifactIndex=args.indexOf('--artifact-dir');
const artifact = resolve(root,artifactIndex<0?'artifacts/rtp-qualification':args[artifactIndex+1], (rulesVersion===registry.profiles[gameId].rulesVersion?gameId:gameId+'-rules-'+rulesVersion)+'.json');
await mkdir(dirname(artifact), { recursive: true }); await writeFile(artifact, JSON.stringify(proof,null,2)+'\n');
validateRtpProof(gameId, inputs, proof);
if (args.includes('--write-proof')) {
  const target = resolve(root, inputs.policy.proof); await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(proof,null,2)+'\n');
}
console.log(JSON.stringify({ gameId, qualified: true, results: proof.results.map(row => ({ choice: row.choice, stakeUnits: row.stakeUnits, paidRounds: row.paidRounds, rtp: row.rtp, interval95: row.interval95,rtpBounds:row.rtpBounds })) }));

}
