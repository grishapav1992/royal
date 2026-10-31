import { build, version as esbuildVersion } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, lstat, rename, rm } from 'node:fs/promises';
import { resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkGameRtp } from './game-math/rtp-gate.mjs';
import { moduleFingerprinter, cachedModule } from './module-build-cache.mjs';
import { readHostProjection } from './build-host-projection.mjs';
import {projectedModuleContract,moduleProjectionCatalog,projectedModuleAsset} from './module-source-projection.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const buildScript = await readFile(fileURLToPath(import.meta.url));
const catalogPath = resolve(root, 'src/modules/GameModuleCatalog.ts');
const catalogBuild = await build({ entryPoints: [catalogPath], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { GAME_MODULES } = await import('data:text/javascript;base64,' + Buffer.from(catalogBuild.outputFiles[0].contents).toString('base64'));
const catalog = new Map(GAME_MODULES.map(game => [game.slug, game]));
const started = performance.now();
const args = process.argv.slice(2);
const projectionFlag=args.indexOf('--source-projection');
let projection;
if(projectionFlag>=0){const name=args[projectionFlag+1];if(!name)throw Error('Missing module source projection');args.splice(projectionFlag,2);projection=await readHostProjection(root,name,{strictOrigins:true});}
const projectedAssets={};
async function sourceBytes(path){return projection?projection.read(relative(root,resolve(path)).replaceAll('\\','/')):readFile(path);}
async function mediaBytes(path){
 if(!projection)return readFile(path);
 const name=relative(root,path).replaceAll('\\','/'),bytes=await projectedModuleAsset(root,name,projection);
 projectedAssets[name]=sha(bytes);return bytes;
}
const force = args.includes('--force');
if (force) args.splice(args.indexOf('--force'), 1);
const all = args.length === 1 && args[0] === '--all';
let selection;
if (args[0] === '--games' && args.length > 1) selection = [...new Set(args.slice(1))];
else if (args[0] === '--game' && args.length === 2) selection = args[1];
else if (args.length === 1 && !args[0].startsWith('-')) selection = args[0];
else if (!args.length) selection = dirname(process.cwd()) === resolve(root, 'games') ? basename(process.cwd()) : 'girlhub';
const selected = all ? [...catalog.keys()] : Array.isArray(selection) ? selection : [selection];
if(projection&&JSON.stringify([...selected].sort())!==JSON.stringify([...(projection.metadata.moduleGames??[])].sort()))throw Error('Projection must build exactly its reviewed module list');
if(projection){
 const projected=await moduleProjectionCatalog(projection);
 for(const slug of selected){const actual=projected.find(game=>game.slug===slug);
  catalog.set(slug,projectedModuleContract(catalog.get(slug),actual,projection.metadata.moduleContracts));}
}
if (selected.some(slug => !catalog.has(slug))) throw Error('Choose registered packages with --game <slug>, --games <slug...>, or --all');
await checkGameRtp(root, GAME_MODULES, selected.map(slug => catalog.get(slug).gameId));
const fingerprint = moduleFingerprinter(root, { esbuildVersion, node: process.version, platform: process.platform });
const report = [];

const bridgeModules = new Map([
 ['src/wallet/FlagToteClient', ['flagToteClient']],
 ['src/wallet/ExpansionClient', ['expansionClient']],
 ['src/wallet/WalletClient', ['demoWallet', 'coins']],
 ['src/wallet/ProgressionClient', ['progression']],
 ['src/wallet/MinesClient', ['minesClient']],
 ['src/wallet/CasinoClient', ['casinoClients']],
 ['src/wallet/NilePlayClient', ['nilePlay']],
 ['src/wallet/UsdtClient', ['usdtWallet']],
 ['src/wallet/CryptoClient', ['cryptoWallet']],
 ['src/wallet/FlightClient', ['flightClient']],
 ['src/game/GameAudio', ['gameAudio']],
 ['src/game/demoGames', ['DEMO_CATALOG_URL', 'DEMO_CATEGORIES', 'getDemoGames', 'prefetchDemoGames', 'getCabinetDemoGame', 'getDemoGame', 'selectCabinetDemoGame', 'watchCabinetDemoGame']],
 ['src/i18n/index', ['language', 'locale', 't', 'tr', 'translateMessage', 'resolveLanguage', 'LANGUAGE_KEY', 'isUserMessage', 'installLanguageSwitcher']],
 ['src/ui/gameReactions', ['GAME_REACTION_EVENT', 'resetGameOutcomes', 'emitGameReaction', 'gameReactionForAmounts', 'emitGameOutcome', 'observeGameOutcome', 'observeExpansionOutcome']],
 ['phaser', ['Phaser']],
]);
const allowedResources = /\.(?:webp|png|jpe?g|avif|gif|svg|mp4|mp3|ogg|wav|m4a|json|woff2?|ttf|otf)$/;
const nativeEntries = ['AfterglowUI', 'CosmicEscapeUI', 'CaramelCarnivalUI', 'VelvetReignUI', 'LastConvoyUI', 'NitroRunUI', 'MemeOverloadUI', 'LastExitUI', 'CrLeoUI', 'VolcanicPlinkoUI'];
// Existing shared presentation helpers use these pure probability functions in both browser and server builds.
const backendImplementation = name => name.startsWith('server/') && !name.startsWith('server/games/vfair/');

async function walk(directory, prefix = '') {
 const files = [];
 const info = await lstat(directory);
 if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Module media root must be a regular directory');
 for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (item.isSymbolicLink()) throw Error('Module resource symlinks are not allowed');
  const path = resolve(directory, item.name), name = prefix + item.name;
  if (item.isDirectory()) files.push(...await walk(path, name + '/'));
  else if (item.isFile() && allowedResources.test(name)) {
   // Unpackageable sync copies must not enter the inventory or block local builds.
   if (!/^[a-zA-Z0-9_./-]+$/.test(name)) continue;
   files.push([name, await mediaBytes(path)]);
  }
 }
 return files;
}

async function renameBuilt(source, destination) {
 // Windows scanners can briefly hold a newly written file or directory.
 for (let attempt = 0; ; attempt++) {
  try { await rename(source, destination); return; }
  catch (error) {
   if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 4) throw error;
   await delay(50 * 2 ** attempt);
  }
 }
}

async function atomicFile(path, bytes) {
 const temporary = path + '.pending-' + randomUUID();
 await writeFile(temporary, bytes, { flag: 'wx' });
 await renameBuilt(temporary, path);
}

async function referencedMedia(outputs, sentinel, assetRoots, assetFiles) {
 const references = [...new Set(outputs.flatMap(output => [...output.text.matchAll(new RegExp(sentinel + '/([a-zA-Z0-9_./-]*)', 'g'))].map(match => match[1])))].sort();
 const collected = new Map();
 const dynamicDirectories = new Set();
 for (const name of references) {
  if ((!assetRoots.includes(name.split('/')[0]) && !assetFiles.includes(name)) || name.split('/').some(part => part === '..' || part === '.')) throw Error('Invalid module media reference: ' + name);
  const path = resolve(root, 'public/assets', name);
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (info?.isSymbolicLink()) throw Error('Module resource symlinks are not allowed');
  if (info?.isFile()) {
   if (!allowedResources.test(name)) throw Error('Unsupported module media reference: ' + name);
   // Reject symlinked parents for directly referenced resources as well as directory walks.
   let parent = dirname(path);
   while (parent !== resolve(root, 'public/assets')) {
    if ((await lstat(parent)).isSymbolicLink()) throw Error('Module resource symlinks are not allowed');
    parent = dirname(parent);
   }
   collected.set(name, await mediaBytes(path));
  } else {
   if (!info && allowedResources.test(name)) throw Error('Referenced module media is missing: ' + name);
   // A template or concatenation ends at its static prefix. Keep its directory's
   // resources, for example the dynamically selected meme audio or portrait frames.
   const directory = info?.isDirectory() || name.endsWith('/') ? name.replace(/\/$/, '') : dirname(name);
   if (!assetRoots.includes(directory.split('/')[0])) throw Error('Dynamic module media escaped its declared root');
   dynamicDirectories.add(directory);
  }
 }
 for (const directory of [...dynamicDirectories].sort()) {
  for (const [name, bytes] of await walk(resolve(root, 'public/assets', directory), directory + '/')) collected.set(name, bytes);
 }
 return { media: [...collected.entries()].sort(([a], [b]) => a.localeCompare(b)), references, dynamicDirectories: [...dynamicDirectories].sort() };
}

async function buildGame(slug) {
 const gameStarted = performance.now();
 const registered = catalog.get(slug);
 const packageRoot = resolve(root, 'games', slug);
 const config = JSON.parse(await sourceBytes(resolve(packageRoot, 'package.json')));
 if (!/^\d+\.\d+\.\d+$/.test(config.version) || !['gameId', 'apiVersion', 'rulesVersion', 'progressVersion'].every(key => config[key] === registered[key])) throw Error('Unsupported module contract: ' + slug);
 if (config.entry !== 'entry.ts' || !Array.isArray(config.assetRoots) || new Set(config.assetRoots).size !== config.assetRoots.length || !config.assetRoots.every(name => typeof name === 'string' && /^[a-z0-9-]+$/.test(name))) throw Error('Invalid module entry or asset roots: ' + slug);
 const assetFiles = config.assetFiles ?? [];
 if (!Array.isArray(assetFiles) || new Set(assetFiles).size !== assetFiles.length || !assetFiles.every(name => typeof name === 'string' && /^[a-zA-Z0-9_./-]+$/.test(name) && !name.split('/').some(part => part === '..' || part === '.') && allowedResources.test(name))) throw Error('Invalid module asset files: ' + slug);
 const cached = force || projection ? null : await cachedModule(root, config, registered, fingerprint);
 if (cached) {
  await atomicFile(resolve(root, 'module-dist', config.gameId, 'active.json'), JSON.stringify(cached.pointer, null, 2) + '\n');
  const result = { gameId: config.gameId, version: cached.proof.version, directory: cached.folder,
   files: cached.proof.files, reused: true, durationMs: Math.round(performance.now() - gameStarted) };
  report.push(result); console.log(JSON.stringify(result)); return;
 }
 const sentinel = '__ROYAL_MODULE_MEDIA_' + sha(config.gameId).slice(0, 16) + '__';
 const result = await build({
  absWorkingDir: root, entryPoints: [resolve(packageRoot, config.entry)],
  bundle: true, write: false, metafile: true, outfile: 'module.js',
  format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none',
  ...(projection ? {tsconfigRaw:projection.read('tsconfig.json').toString('utf8')} : {}),
  plugins: [{ name: 'royal-host-and-module-media', setup(builder) {
   builder.onResolve({ filter: /^phaser$/ }, () => ({ path: 'phaser', namespace: 'royal-host' }));
   builder.onResolve({ filter: /^\./ }, args => {
    const path = relative(root, resolve(args.resolveDir, args.path)).replaceAll('\\', '/').replace(/\.ts$/, '');
    if (bridgeModules.has(path)) return { path, namespace: 'royal-host' };
    if(projection){const name=relative(root,resolve(args.resolveDir,args.path)).replaceAll('\\','/');const candidates=[name,...['.ts','.tsx','.js','.css','.json'].map(ext=>name+ext),name+'/index.ts'];
      const match=candidates.find(n=>Object.hasOwn(projection.metadata.files,n));if(!match)throw Error('Unreviewed projected module import: '+name);return{path:resolve(root,match)};}
   });
   builder.onLoad({ filter: /.*/, namespace: 'royal-host' }, args => {
    if (args.path === 'phaser') return { contents: "const h=globalThis[Symbol.for('royal.game-host.v1')];if(!h||h.apiVersion!==1||!h.Phaser)throw Error('Game host is unavailable');export default h.Phaser;", loader: 'js' };
    const names = bridgeModules.get(args.path);
    const field = name => args.path === 'src/i18n/index' ? 'i18n.' + name : args.path === 'src/ui/gameReactions' ? 'reactions.' + name : args.path === 'src/game/demoGames' ? 'demoGames.' + name : name === 'coins' ? 'walletCoins' : name;
    return { contents: `const h=globalThis[Symbol.for('royal.game-host.v1')];if(!h||h.apiVersion!==1)throw Error('Game host is unavailable');\n` + names.map(name => `export const ${name}=h.${field(name)};`).join('\n'), loader: 'js' };
   });
   builder.onLoad({ filter: /\.(?:ts|tsx|js|json|css)$/ }, async args => {
    let contents = (await sourceBytes(args.path)).toString('utf8');
    for (const assetRoot of config.assetRoots) contents = contents.replaceAll('/assets/' + assetRoot + '/', sentinel + '/' + assetRoot + '/');
    for (const assetFile of assetFiles) contents = contents.replaceAll('/assets/' + assetFile, sentinel + '/' + assetFile);
    return { contents, loader: args.path.endsWith('.css') ? 'css' : args.path.endsWith('.json') ? 'json' : args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.js') ? 'js' : 'ts', resolveDir: dirname(args.path) };
   });
   // Absolute versioned media URLs are served by the game host, never bundled as JS imports.
   builder.onResolve({ filter: /^__ROYAL_MODULE_MEDIA_/ }, args => ({ path: args.path, external: true }));
  } }],
 });
 const inputs = Object.keys(result.metafile.inputs).filter(name => !name.startsWith('royal-host:')).sort();
 const ownNative = nativeEntries.filter(name => inputs.includes(`src/ui/${name}.ts`));
 if (inputs.some(name => backendImplementation(name) || bridgeModules.has(name.replace(/\.ts$/, '')) || /^src\/modules\/(?:GameHostRuntime|IndependentGameUI)\.ts$/.test(name)) || ownNative.length > 1) throw Error('Module imported a forbidden host or unrelated native game implementation: ' + slug);
 const remainingAssets = result.outputFiles.flatMap(output => [...output.text.matchAll(/\/assets\/([a-zA-Z0-9_./-]+)/g)].map(match => match[1]));
 if (remainingAssets.length) throw Error('Module references media outside its declared asset roots: ' + slug + ': ' + [...new Set(remainingAssets)].join(', '));
 const sourceFiles = Object.fromEntries(await Promise.all(inputs.map(async name => [name, sha(await sourceBytes(resolve(root, name)))])));
 const { media, references: mediaReferences, dynamicDirectories } = await referencedMedia(result.outputFiles, sentinel, config.assetRoots, assetFiles);
 const mediaHashes = Object.fromEntries(media.map(([name, bytes]) => ['media/' + name, sha(bytes)]));
 const preload = config.preload;
 if (preload !== undefined && (!Array.isArray(preload) || preload.length > 16 || new Set(preload).size !== preload.length
  || !preload.every(name => typeof name === 'string' && /\.(?:webp|png|jpe?g|avif|gif|svg)$/.test(name)
   && Object.hasOwn(mediaHashes, 'media/' + name)))) throw Error('Invalid startup image hints: ' + slug);
 const sourceSha256 = sha(JSON.stringify({ config, contract: registered, esbuildVersion, script: sha(buildScript), sourceFiles, media: mediaHashes }));
 const version = config.version + '-' + sourceSha256.slice(0, 12);
 const urlRoot = `/game-modules/${config.gameId}/versions/${version}/`;
 const outputs = new Map();
 for (const output of result.outputFiles) {
  const bytes = Buffer.from(output.text.replaceAll(sentinel, urlRoot + 'media'));
  const css = output.path.endsWith('.css');
  const name = (css ? 'style-' : 'entry-') + sha(bytes).slice(0, 16) + (css ? '.css' : '.js');
  outputs.set(name, bytes);
 }
 for (const [name, bytes] of media) outputs.set('media/' + name, bytes);
 const files = Object.fromEntries([...outputs.entries()].map(([name, bytes]) => [name, sha(bytes)]).sort(([a], [b]) => a.localeCompare(b)));
 const manifest = { format: 1, gameId: config.gameId, version, apiVersion: config.apiVersion,
  rulesVersion: config.rulesVersion, progressVersion: config.progressVersion, sourceSha256,
  entry: Object.keys(files).find(name => name.endsWith('.js')), styles: Object.keys(files).filter(name => /^style-/.test(name)), files,
  ...(preload ? { preload: preload.map(name => 'media/' + name) } : {}) };
 const totalBytes = [...outputs.values()].reduce((total, bytes) => total + bytes.length, 0);
 if (Object.keys(files).length < 2 || Object.keys(files).length > 256 || manifest.styles.length !== 1 || totalBytes > 64 * 1024 * 1024) throw Error('Module package exceeds publication limits: ' + slug);
 const json = JSON.stringify(manifest, null, 2) + '\n';
 outputs.set('manifest.json', Buffer.from(json));
 const versions = resolve(root, 'module-dist', config.gameId, 'versions');
 const destination = resolve(versions, version);
 await mkdir(versions, { recursive: true });
 let existing;
 try { existing = await lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
 if (existing) {
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw Error('Invalid immutable module directory');
  const actual = [];
  async function inventory(folder, prefix = '') {
   for (const item of await readdir(folder, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw Error('Immutable module resource symlink rejected');
    if (item.isDirectory()) await inventory(resolve(folder, item.name), prefix + item.name + '/');
    else if (item.isFile()) actual.push(prefix + item.name);
   }
  }
  await inventory(destination);
  if (actual.length !== outputs.size || actual.some(name => !outputs.has(name))) throw Error('Immutable module version inventory mismatch');
  for (const [name, bytes] of outputs) if (sha(await readFile(resolve(destination, name))) !== sha(bytes)) throw Error('Immutable module version collision: ' + name);
 } else {
  const temporary = resolve(versions, '.pending-' + randomUUID());
  await mkdir(temporary);
  try {
   for (const [name, bytes] of outputs) { const target = resolve(temporary, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' }); }
   await renameBuilt(temporary, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
 }
 await atomicFile(resolve(root, 'module-dist', config.gameId, 'active.json'), JSON.stringify({ format: 1, gameId: config.gameId, manifest: urlRoot + 'manifest.json', sha256: sha(json) }, null, 2) + '\n');
 await mkdir(resolve(root, 'module-build'), { recursive: true });
 await atomicFile(resolve(root, 'module-build', slug + '-proof.json'), JSON.stringify({ gameId: config.gameId, version, sourceSha256, sourceFiles,
  hostSingletonsExternalized: [...bridgeModules.keys()].every(name => !inputs.includes(name + '.ts')),
  hostBridges: Object.keys(result.metafile.inputs).filter(name => name.startsWith('royal-host:')).sort(),
  nativeImplementations: ownNative, serverImplementationIncluded: inputs.some(backendImplementation),
  sharedMathInputs: inputs.filter(name => name.startsWith('server/games/vfair/')),
  assetRoots: config.assetRoots, assetFiles, mediaReferences, dynamicMediaDirectories: dynamicDirectories,
  startupImages: manifest.preload ?? [],
  bytes: totalBytes, files: Object.keys(files).length,
  ...(projection?{sourceProjection:{config:projection.config,sha256:projection.sha256,productionCommit:projection.metadata.productionCommit,inputs:{...projection.inputs},origins:{...projection.origins},assets:{...projectedAssets}}}:{}),
  cache: { format: projection ? 0 : 1, fingerprint: await fingerprint(config, registered, inputs),
   outputs: Object.fromEntries([...outputs].map(([name, bytes]) => [name, sha(bytes)])) } }, null, 2) + '\n');
 const resultRow = { gameId: config.gameId, version, directory: destination, files: Object.keys(files).length,
  reused: false, durationMs: Math.round(performance.now() - gameStarted) };
 report.push(resultRow); console.log(JSON.stringify(resultRow));
}

for (const slug of selected) await buildGame(slug);
if(projection){
 const modules={};for(const slug of selected){const proof=JSON.parse(await readFile(resolve(root,'module-build',slug+'-proof.json'),'utf8'));const pointer=JSON.parse(await readFile(resolve(root,'module-dist',proof.gameId,'active.json'),'utf8'));const manifestPath=pointer.manifest.replace('/game-modules/','module-dist/');const bytes=await readFile(resolve(root,manifestPath));modules[proof.gameId]={version:proof.version,sourceFiles:proof.sourceFiles,hostBridges:proof.hostBridges,manifestPath,manifestSha256:sha(bytes),files:JSON.parse(bytes).files};}
 await atomicFile(resolve(root,'module-build/source-projection-report.json'),JSON.stringify({config:projection.config,sha256:projection.sha256,productionCommit:projection.metadata.productionCommit,inputs:projection.inputs,origins:projection.origins,assets:projectedAssets,builderSha256:sha(buildScript),modules},null,2)+'\n');
}
await mkdir(resolve(root, 'module-dist'), { recursive: true });
await atomicFile(resolve(root, 'module-dist/host-contracts.json'), JSON.stringify({ format: 1, games: Object.fromEntries(GAME_MODULES.map(({ gameId, apiVersion, rulesVersion, progressVersion }) => [gameId, { apiVersion, rulesVersion, progressVersion }])) }, null, 2) + '\n');
const summary = { format: 1, durationMs: Math.round(performance.now() - started),
 built: report.filter(row => !row.reused).length, reused: report.filter(row => row.reused).length, games: report };
await atomicFile(resolve(root, 'module-build/build-report.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ moduleBuild: { built: summary.built, reused: summary.reused, durationMs: summary.durationMs } }));
