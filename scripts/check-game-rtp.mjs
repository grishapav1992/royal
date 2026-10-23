import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGameRtp } from './game-math/rtp-gate.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ entryPoints: [resolve(root, 'src/modules/GameModuleCatalog.ts')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { GAME_MODULES } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
console.log(JSON.stringify(await checkGameRtp(root, GAME_MODULES)));
