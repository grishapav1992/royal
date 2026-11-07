import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('Usage: npm run audit:viewer -- --output <new HTML file>');
const browserDigest = resolve(root, 'src/audit/replay-browser-digest.ts');
const bundle = await build({
  absWorkingDir: root, entryPoints: ['src/audit/replay-viewer.ts'], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2022', legalComments: 'inline', minify: true,
  plugins: [{ name: 'offline-replay-digest', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/replay-digest$/ }, args => {
      if (args.importer === resolve(root, 'server/audit/replay-package.ts')) return { path: browserDigest };
    });
  } }],
});
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/\r\n?/g, '\n');
const digest = createHash('sha256').update(script, 'utf8').digest('base64');
const template = await readFile(resolve(root, 'src/audit/replay-viewer.html'), 'utf8');
const output = template.replace('SCRIPT_HASH', digest).replace('<!-- REPLAY_SCRIPT -->', () => '<script>' + script + '</script>');
await writeFile(resolve(values.output), output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
