import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GAME_MODULES, type IndependentGameId } from '../src/modules/GameModuleCatalog';
import { moduleRoot, validModuleManifest, validModulePointer } from '../src/modules/GameModuleManifest';
import { STUDIO_GAMES } from '../src/shared/studioGames';
import { EXPANSION_GAMES } from '../src/shared/casinoExpansion';
import { SESSION_GAMES } from '../src/shared/casinoSessions';
import { GITHUB_GAME_IDS } from '../src/shared/githubGames';
import { GAME_CATALOG } from '../src/shared/gameCore';
import { ACTIVITIES } from '../src/shared/activities';
import { CABINETS } from '../src/shared/cabinets';
import { isRetiredArcadeGame } from '../src/shared/arcadeCatalog';
import { isRetiredCardGame } from '../src/shared/cardTables';
import { build } from 'esbuild';

const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const version = '1.0.0-123456789abc';
const entry = 'entry-123456789abcdef0.js';
const style = 'style-123456789abcdef0.css';
function manifest(gameId: IndependentGameId) {
 const contract = GAME_MODULES.find(game => game.gameId === gameId)!;
 return { format: 1, gameId, version, apiVersion: contract.apiVersion, rulesVersion: contract.rulesVersion,
  progressVersion: contract.progressVersion, sourceSha256: 'a'.repeat(64), entry, styles: [style],
  files: { [entry]: 'b'.repeat(64), [style]: 'c'.repeat(64) } };
}

test('every defined game has a distinct module package and matching public contract', async () => {
 const required = [...new Set([
  ...EXPANSION_GAMES, ...SESSION_GAMES, ...GITHUB_GAME_IDS, ...GAME_CATALOG.map(game => game.id),
  ...Object.keys(ACTIVITIES), 'casinoapipro', 'luelon', 'breaker', 'orbit', 'drift', 'pixel',
 ])].sort();
 assert.equal(required.length, 116);
 assert.deepEqual(GAME_MODULES.map(game => game.gameId).sort(), required);
 assert.ok(STUDIO_GAMES.every(id => required.includes(id)));
 for (const cabinet of CABINETS) {
  assert.ok(required.includes(cabinet.id), `Visible cabinet has no independent package: ${cabinet.id}`);
  assert.equal(isRetiredArcadeGame(cabinet.id), false, cabinet.id);
  assert.equal(isRetiredCardGame(cabinet.id), false, cabinet.id);
 }
 assert.equal(CABINETS.length, 24, 'The single Nile wallet catalogue hides separate-credit providers and practice chip tables');
 assert.equal(new Set(GAME_MODULES.map(game => game.slug)).size, GAME_MODULES.length);
 for (const game of GAME_MODULES) {
  const config = JSON.parse(await readFile(resolve('games', game.slug, 'package.json'), 'utf8'));
  for (const key of ['gameId', 'apiVersion', 'rulesVersion', 'progressVersion'] as const) assert.equal(config[key], game[key], `${game.gameId} ${key}`);
  assert.ok(config.entry);
 }
});

test('manifests and active pointers are bound to the requested game', () => {
 for (const game of GAME_MODULES) {
  const metadata = manifest(game.gameId), root = moduleRoot(version, game.gameId);
  const pointer = { format: 1, gameId: game.gameId, manifest: root + 'manifest.json', sha256: 'd'.repeat(64) };
  assert.equal(validModuleManifest(metadata, pointer.manifest, game.gameId), true, game.gameId);
  assert.equal(validModulePointer(pointer, game.gameId), true, game.gameId);
  const other = GAME_MODULES.find(candidate => candidate.gameId !== game.gameId)!;
  assert.equal(validModuleManifest(metadata, pointer.manifest, other.gameId), false);
  assert.equal(validModulePointer(pointer, other.gameId), false);
  assert.equal(validModuleManifest({ ...metadata, rulesVersion: game.rulesVersion + 1 }, pointer.manifest, game.gameId), false);
  assert.equal(validModuleManifest({ ...metadata, progressVersion: game.progressVersion + 1 }, pointer.manifest, game.gameId), false);
 }
});

test('module metadata rejects traversal, foreign origins, missing files and malformed digests', () => {
 const game = 'studio-signal-fox', root = moduleRoot(version, game), good = manifest(game);
 for (const path of ['/game-modules/studio-signal-fox/versions/../manifest.json', 'https://example.test' + root + 'manifest.json', root + 'manifest.json?other=1']) {
  assert.equal(validModuleManifest(good, path, game), false, path);
  assert.equal(validModulePointer({ format: 1, gameId: game, manifest: path, sha256: 'd'.repeat(64) }, game), false, path);
 }
 for (const name of ['media/../../secret.json', 'media/./secret.json', '/secret.json', 'media/%2e%2e/secret.json', 'media/secret.env']) {
  assert.equal(validModuleManifest({ ...good, files: { ...good.files, [name]: 'e'.repeat(64) } }, root + 'manifest.json', game), false, name);
 }
 assert.equal(validModuleManifest({ ...good, files: { [entry]: 'b'.repeat(64) } }, root + 'manifest.json', game), false);
 assert.equal(validModuleManifest({ ...good, sourceSha256: 'not-a-digest' }, root + 'manifest.json', game), false);
 assert.throws(() => moduleRoot('../../outside', game));
});

test('optional startup hints stay inside the verified image inventory', () => {
 const game = 'studio-signal-fox', path = moduleRoot(version, game) + 'manifest.json';
 const image = 'media/signal-fox/board.webp';
 const good = { ...manifest(game), files: { ...manifest(game).files, [image]: 'e'.repeat(64) } };
 assert.equal(validModuleManifest(good, path, game), true);
 assert.equal(validModuleManifest({ ...good, preload: [image] }, path, game), true);
 for (const preload of [[entry], [style], ['https://example.test/board.webp'], ['/assets/board.webp'],
  ['media/missing.webp'], [image, image], Array.from({ length: 17 }, () => image), 'all']) {
  assert.equal(validModuleManifest({ ...good, preload }, path, game), false, JSON.stringify(preload));
 }
});

test('all built game packages pass runtime validation and every inventoried byte matches its digest', async () => {
 for (const game of GAME_MODULES) {
  const pointer = JSON.parse(await readFile(resolve('module-dist', game.gameId, 'active.json'), 'utf8'));
  assert.equal(validModulePointer(pointer, game.gameId), true, game.gameId);
  const directory = resolve('module-dist', game.gameId, 'versions', pointer.manifest.split('/')[4]);
  const bytes = await readFile(resolve(directory, 'manifest.json'));
  assert.equal(sha(bytes), pointer.sha256, game.gameId);
  const metadata = JSON.parse(bytes.toString());
  assert.equal(validModuleManifest(metadata, pointer.manifest, game.gameId), true, game.gameId);
  for (const [name, expected] of Object.entries(metadata.files)) assert.equal(sha(await readFile(resolve(directory, name))), expected, `${game.gameId}/${name}`);
  const proof = JSON.parse(await readFile(resolve('module-build', game.slug + '-proof.json'), 'utf8'));
  assert.equal(proof.version, metadata.version, game.gameId);
  assert.equal(proof.sourceSha256, metadata.sourceSha256, game.gameId);
  assert.equal(proof.hostSingletonsExternalized, true, game.gameId);
  assert.equal(proof.serverImplementationIncluded, false, game.gameId);
  assert.ok(proof.nativeImplementations.length <= 1, game.gameId);
  for (const [name, expected] of Object.entries(proof.sourceFiles)) assert.equal(sha(await readFile(resolve(name))), expected, `${game.gameId} has stale source ${name}`);
 }
});

test('portrait MP4 resources are accepted without widening resource paths', () => {
 const game = 'royal-plinko', root = moduleRoot(version, game), good = manifest(game);
 const withVideo = (name: string) => ({ ...good, files: { ...good.files, [name]: 'e'.repeat(64) } });
 assert.equal(validModuleManifest(withVideo('media/arcane-plinko/vespera-idle.mp4'), root + 'manifest.json', game), true);
 for (const name of ['media/../secret.mp4', 'media/./clip.mp4', 'media/clip.mp4.exe', 'https://example.test/clip.mp4']) {
  assert.equal(validModuleManifest(withVideo(name), root + 'manifest.json', game), false, name);
 }
});

test('the hall bundle contains host services without importing any independent game renderer', async () => {
 const implementations = new Set<string>();
 for (const game of GAME_MODULES) {
  const config = JSON.parse(await readFile(resolve('games', game.slug, 'package.json'), 'utf8'));
  const source = await readFile(resolve('games', game.slug, config.entry), 'utf8');
  for (const match of source.matchAll(/from\s+['"]\.\.\/\.\.\/(src\/(?:ui|game)\/[^'"]+)['"]/g)) implementations.add(match[1].endsWith('.ts') ? match[1] : match[1] + '.ts');
 }
 assert.ok(implementations.size > 20, 'The inventory must identify actual renderer boundaries');
 const result = await build({ entryPoints: ['src/main.ts'], bundle: true, write: false, metafile: true, packages: 'external', platform: 'browser', format: 'esm', loader: { '.css': 'empty' }, logLevel: 'silent' });
 const eager = Object.keys(result.metafile!.inputs).filter(name => implementations.has(name));
 assert.deepEqual(eager, [], 'Independent game implementations must enter through their versioned packages');
});
