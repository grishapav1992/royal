import { build, version as esbuildVersion } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const configPath = resolve(root, 'games/girlhub/package.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.gameId !== 'studio-afterglow' || !/^\d+\.\d+\.\d+$/.test(config.version) || config.apiVersion !== 1 || config.rulesVersion !== 2 || config.progressVersion !== 3) throw Error('Unsupported module contract');
const sentinel = '__ROYAL_GIRLHUB_MODULE_MEDIA__';
const bridgeModules = new Map([
 ['src/wallet/ExpansionClient', ['expansionClient']],
 ['src/wallet/WalletClient', ['demoWallet', 'coins']],
 ['src/game/GameAudio', ['gameAudio']],
 ['src/i18n/index', ['language', 'locale', 't', 'tr', 'translateMessage', 'resolveLanguage', 'LANGUAGE_KEY', 'isUserMessage', 'installLanguageSwitcher']],
 ['src/ui/gameReactions', ['GAME_REACTION_EVENT', 'resetGameOutcomes', 'emitGameReaction', 'gameReactionForAmounts', 'emitGameOutcome', 'observeGameOutcome', 'observeExpansionOutcome']],
]);
const buildScript = await readFile(fileURLToPath(import.meta.url));
const result = await build({
 absWorkingDir: root, entryPoints: [resolve(root, 'games/girlhub', config.entry)],
 bundle: true, write: false, metafile: true, outfile: 'module.js',
 format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none',
 plugins: [{ name: 'royal-host-and-module-media', setup(builder) {
  builder.onResolve({ filter: /^\./ }, args => {
   const path = relative(root, resolve(args.resolveDir, args.path)).replace(/\.ts$/, '');
   if (bridgeModules.has(path)) return { path, namespace: 'royal-host' };
  });
  builder.onLoad({ filter: /.*/, namespace: 'royal-host' }, args => {
   const names = bridgeModules.get(args.path);
   const field = name => args.path === 'src/i18n/index' ? 'i18n.' + name : args.path === 'src/ui/gameReactions' ? 'reactions.' + name : name === 'coins' ? 'walletCoins' : name;
   return { contents: `const h=globalThis[Symbol.for('royal.game-host.v1')];if(!h||h.apiVersion!==1)throw Error('Game host is unavailable');\n` + names.map(name => `export const ${name}=h.${field(name)};`).join('\n'), loader: 'js' };
  });
  builder.onLoad({ filter: /\.(?:ts|css)$/ }, async args => {
   const contents = (await readFile(args.path, 'utf8')).replaceAll('/assets/afterglow/', sentinel + '/');
   return { contents, loader: args.path.endsWith('.css') ? 'css' : 'ts', resolveDir: dirname(args.path) };
  });
 } }],
});
const inputs = Object.keys(result.metafile.inputs).filter(x => !x.startsWith('royal-host:')).sort();
if (inputs.some(x => x.startsWith('server/') || bridgeModules.has(x.replace(/\.ts$/, '')) || /src\/ui\/(?:CosmicEscapeUI|CaramelCarnivalUI|VelvetReignUI|LastConvoyUI|MemeOverloadUI|NitroRunUI)\.ts$/.test(x))) throw Error('Module imported a forbidden host or game implementation');
const sourceFiles = Object.fromEntries(await Promise.all(inputs.map(async name => [name, sha(await readFile(resolve(root, name)))])));
const mediaRoot = resolve(root, 'public/assets/afterglow');
async function walk(directory, prefix = '') {
 const files = [];
 for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (item.isSymbolicLink()) throw Error('Module resource symlinks are not allowed');
  const path = resolve(directory, item.name), name = prefix + item.name;
  if (item.isDirectory()) files.push(...await walk(path, name + '/'));
  else if (item.isFile()) files.push([name, path]);
 }
 return files;
}
const media = await walk(mediaRoot);
const mediaHashes = Object.fromEntries(await Promise.all(media.map(async ([name, path]) => ['media/' + name, sha(await readFile(path))])));
const sourceSha256 = sha(JSON.stringify({ config, esbuildVersion, script: sha(buildScript), sourceFiles, media: mediaHashes }));
const version = config.version + '-' + sourceSha256.slice(0, 12);
const urlRoot = `/game-modules/${config.gameId}/versions/${version}/`;
const destination = resolve(root, 'module-dist', config.gameId, 'versions', version);
await mkdir(destination, { recursive: true });
const files = {};
for (const output of result.outputFiles) {
 const bytes = Buffer.from(output.text.replaceAll(sentinel, urlRoot + 'media'));
 const css = output.path.endsWith('.css');
 const name = (css ? 'style-' : 'entry-') + sha(bytes).slice(0, 16) + (css ? '.css' : '.js');
 await writeFile(resolve(destination, name), bytes); files[name] = sha(bytes);
}
for (const [name, path] of media) {
 const target = resolve(destination, 'media', name); await mkdir(dirname(target), { recursive: true });
 await copyFile(path, target); files['media/' + name] = mediaHashes['media/' + name];
}
const manifest = { format: 1, gameId: config.gameId, version, apiVersion: config.apiVersion,
 rulesVersion: config.rulesVersion, progressVersion: config.progressVersion, sourceSha256,
 entry: Object.keys(files).find(x => x.endsWith('.js')), styles: Object.keys(files).filter(x => x.endsWith('.css')),
 files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
const json = JSON.stringify(manifest, null, 2) + '\n';
await writeFile(resolve(destination, 'manifest.json'), json);
await writeFile(resolve(root, 'module-dist', config.gameId, 'active.json'), JSON.stringify({ format: 1, gameId: config.gameId, manifest: urlRoot + 'manifest.json', sha256: sha(json) }, null, 2) + '\n');
await mkdir(resolve(root, 'module-build'), { recursive: true });
await writeFile(resolve(root, 'module-build/girlhub-proof.json'), JSON.stringify({ version, sourceSha256, sourceFiles,
 hostSingletonsExternalized: true, gameRulesAndWalletUnmodified: true, bytes: (await Promise.all(Object.keys(files).map(async name => (await stat(resolve(destination, name))).size))).reduce((a, b) => a + b, 0), files: Object.keys(files).length }, null, 2) + '\n');
console.log(JSON.stringify({ gameId: config.gameId, version, directory: destination, files: Object.keys(files).length }));
