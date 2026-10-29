import { readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const helper = dirname(fileURLToPath(import.meta.url)), root = resolve(helper, '../../..');
const baseline = JSON.parse(readFileSync(resolve(helper, 'financial-baseline.json'))).files;
const scope = JSON.parse(readFileSync(resolve(helper, 'scope.json')));
const digest = data => createHash('sha256').update(data).digest('hex');

export async function buildFinancial({ before, entryPoints = ['scripts/finance-nile-play.ts'], ...options }) {
  const inputs = {}, origins = {}, used = new Set();
  const retained = new Map();
  for (const [file, row] of Object.entries(baseline)) {
    assert(!scope.allowedSource.includes(file));
    execFileSync(process.env.ROYAL_GIT_BINARY || 'git', ['merge-base', '--is-ancestor', row.commit, scope.base], { cwd: root });
    const bytes = execFileSync(process.env.ROYAL_GIT_BINARY || 'git', ['show', row.commit + ':' + file], { cwd: root });
    assert.equal(digest(bytes), row.sha256, file);
    assert([before.financeSource[file]?.sha256, before.financeSource[file]?.lf].includes(row.sha256), file);
    retained.set(file, bytes);
  }
  const result = await build({ absWorkingDir: root, entryPoints, bundle: true, platform: 'node', external: ['pg', 'pg-native'],
    format: 'esm', outfile: 'dist-server/nile-play.js', write: false, metafile: true, ...options,
    plugins: [{ name: 'retained-financial-inputs', setup(builder) {
      builder.onLoad({ filter: /\.(ts|json)$/ }, args => {
        const file = relative(root, args.path).split('\\').join('/');
        if (file.startsWith('../') || file.includes('node_modules/')) return;
        const bytes = retained.get(file) || readFileSync(args.path), sha = digest(Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')));
        inputs[file] = sha;
        if (retained.has(file)) { origins[file] = baseline[file]; used.add(file); }
        else if (!scope.allowedSource.includes(file) && !file.startsWith('server-tests/'))
          assert([before.financeSource[file]?.sha256, before.financeSource[file]?.lf].includes(sha), 'Unreviewed financial input: ' + file);
        return { contents: bytes.toString('utf8'), loader: file.endsWith('.json') ? 'json' : 'ts', resolveDir: dirname(args.path) };
      });
    } }],
  });
  if (entryPoints.length === 1 && entryPoints[0] === 'scripts/finance-nile-play.ts')
    assert.deepEqual([...used].sort(), Object.keys(baseline).sort());
  return { ...result, financialInputs: inputs, retainedOrigins: origins };
}
