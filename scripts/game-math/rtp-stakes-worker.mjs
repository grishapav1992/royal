import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parentPort,workerData} from 'node:worker_threads';
import {legacySampleStream} from './rtp-stakes-sampler.mjs';
const files=["server/games/caramelCarnival.ts","server/games/lastConvoy.ts","server/games/nitroRun.ts","server/games/velvetReign.ts","server/games/velvetMath.ts","src/shared/caramelCarnival.ts","src/shared/lastConvoy.ts","src/shared/nitroRun.ts","src/shared/velvetReign.ts","src/shared/velvetReignHistory.ts","scripts/game-math/rtp-stakes-sampler.mjs"];const hashes=Object.fromEntries(files.map(f=>[f,createHash("sha256").update(readFileSync(new URL("../../"+f,import.meta.url))).digest("hex")]));
try{const result=legacySampleStream(workerData.game,workerData.choice,workerData.seed,workerData.rounds,p=>parentPort.postMessage({progress:p}));parentPort.postMessage({result:{...result,sourceHashes:hashes}});}catch(error){parentPort.postMessage({error:error.stack});}
