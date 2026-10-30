/** Keep every existing game byte and replace only the three skin-renderer entry points. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import ts from 'typescript';
import assert from 'node:assert/strict';

export function patchSkinClient(source, renderer) {
  const namespace = '__royalSkinWalkAlignment20261030';
  assert(!source.includes(namespace), 'The renderer patch is already present');
  const tree = ts.createSourceFile('published-client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0, 'Published client must parse');
  const declarations = [];
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name && node.body) declarations.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  const unique = rows => { assert.equal(rows.length, 1, 'The skin entry point must be unambiguous'); return rows[0]; };
  const load = unique(declarations.filter(n => n.body.getText(tree).includes('Invalid skin atlas') && n.body.getText(tree).includes('Skin artwork unavailable')));
  const draw = unique(declarations.filter(n => n.body.getText(tree).includes('[0,1,1,0,2,2]') && n.body.getText(tree).includes('drawImage') && n.body.getText(tree).includes('roundRect')));
  let map;
  const findMap = node => {
    if (!map && ts.isPropertyAccessExpression(node) && node.name.text === 'has' && ts.isIdentifier(node.expression)) map = node.expression.text;
    ts.forEachChild(node, findMap);
  };
  findMap(load.body); assert(map, 'Missing original sheet cache');
  const has = unique(declarations.filter(n => n.body.statements.length === 1 && n.body.getText(tree).replace(/\s/g, '') === `{return${map}.has(${n.parameters[0]?.name.getText(tree)})}`));
  const changes = [[load, 'loadSkinSheet'], [has, 'hasSkinSheet'], [draw, 'drawGeneratedSkin']].map(([node, method]) => ({
    start: node.getStart(tree), end: node.end, method, name: node.name.text,
    oldSha256: createHash('sha256').update(node.getText(tree)).digest('hex'),
    next: `function ${node.name.text}(...args){return ${namespace}.${method}(...args)}`,
  })).sort((a, b) => a.start - b.start);
  let previous = 0, patched = '';
  for (const row of changes) { assert(row.start >= previous); patched += source.slice(previous, row.start) + row.next; previous = row.end; }
  patched += source.slice(previous);
  const result = renderer + '\n' + patched;
  const parsed = ts.createSourceFile('skin-client.js', result, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(parsed.parseDiagnostics.length, 0, 'Patched client must parse');
  return { code: result, changes: changes.map(({ next, ...row }) => row), untouchedBytes: Buffer.byteLength(source) - changes.reduce((n, c) => n + Buffer.byteLength(source.slice(c.start, c.end)), 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const work = process.argv[2]; assert(work, 'Pass a task-owned artifact directory');
  const old = await fs.readFile(work + '/original-client.js', 'utf8');
  const compiled = await build({ entryPoints: ['src/game/generatedSkinArt.ts'], bundle: true, platform: 'browser', format: 'iife',
    globalName: '__royalSkinWalkAlignment20261030', target: 'es2022', minify: true, write: false, metafile: true });
  assert.deepEqual(Object.keys(compiled.metafile.inputs).sort(), ['src/game/generatedSkinArt.ts', 'src/game/skinPoseAlignment.ts', 'src/shared/skinAssetUrl.ts']);
  const renderer = compiled.outputFiles[0].text, result = patchSkinClient(old, renderer);
  const sha = createHash('sha256').update(result.code).digest('hex'), file = `assets/main-skin-walk-${sha.slice(0, 12)}.js`;
  const original = JSON.parse(await fs.readFile(work + '/original-client.json', 'utf8'));
  assert.equal(createHash('sha256').update(old).digest('hex'), original.sha256);
  const index = await fs.readFile(work + '/original-index.html', 'utf8');
  assert.equal(index.split(original.url).length, 2, 'One index entry must change');
  await fs.mkdir(work + '/patched/assets', { recursive: true });
  await fs.writeFile(work + '/patched/' + file, result.code);
  await fs.writeFile(work + '/patched/index.html', index.replace(original.url, '/' + file));
  const evidence = { original, file, sha256: sha, rendererBytes: Buffer.byteLength(renderer), changes: result.changes, untouchedBytes: result.untouchedBytes,
    inputs: Object.fromEntries(await Promise.all(Object.keys(compiled.metafile.inputs).map(async p => [p, createHash('sha256').update(await fs.readFile(p)).digest('hex')])))};
  await fs.writeFile(work + '/client-patch.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ file, rendererBytes: evidence.rendererBytes, replacedFunctions: result.changes.length, untouchedBytes: evidence.untouchedBytes }));
}
