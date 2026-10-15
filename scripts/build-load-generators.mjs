import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerArguments = "['--import', 'tsx', 'scripts/load-websocket-worker.ts']";
const metricsGuard = 'if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {';
const optionalImports = new Set(['bufferutil', 'utf-8-validate']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function transformGeneratorSource(source) {
  if (source.split(workerArguments).length !== 2) throw new Error('Generator worker arguments changed; review the portable build');
  return "import { fileURLToPath as portableWorkerFileURLToPath } from 'node:url';\n"
    + source.replace(workerArguments, "[portableWorkerFileURLToPath(new URL('./worker.mjs', import.meta.url))]");
}

export function transformMetricsSource(source) {
  if (source.split(metricsGuard).length !== 2) throw new Error('Metrics entrypoint guard changed; review the portable build');
  return source.replace(metricsGuard, 'if (false) {');
}

export async function buildLoadGenerators(directory) {
  const output = resolve(directory);
  const parent = await lstat(dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(dirname(output)) !== dirname(output)) {
    throw new Error('Canonical existing output parent required');
  }
  // Never remove or overwrite an existing directory, including a symlink.
  await mkdir(output, { mode: 0o700 });
  if ((await lstat(output)).mode & 0o077 || await realpath(output) !== output) throw new Error('Private canonical output required');
  const lockBytes = await readFile(join(project, 'package-lock.json'));
  const lock = JSON.parse(lockBytes), packageJson = JSON.parse(await readFile(join(project, 'package.json')));
  const inputs = new Map(), packages = new Map(), outputs = {};
  const transformations = { workerArguments: 0, metricsGuards: 0 };
  const plugins = [{ name: 'portable-generator-entrypoints', setup(context) {
    context.onLoad({ filter: /[/\\]load-websocket-generators\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8'); transformations.workerArguments++;
      return { contents: transformGeneratorSource(source), loader: 'ts', resolveDir: dirname(path) };
    });
    context.onLoad({ filter: /[/\\]load-server-metrics\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8'); transformations.metricsGuards++;
      return { contents: transformMetricsSource(source), loader: 'ts', resolveDir: dirname(path) };
    });
  } }];
  for (const [name, source] of [['generators', 'load-websocket-generators.ts'], ['worker', 'load-websocket-worker.ts']]) {
    const outfile = join(output, name + '.mjs');
    const result = await build({ absWorkingDir: project, entryPoints: [join(project, 'scripts', source)], outfile,
      bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false, metafile: true,
      external: [...optionalImports], plugins, logLevel: 'silent',
      banner: { js: "import { createRequire as portableCreateRequire } from 'node:module'; const require = portableCreateRequire(import.meta.url);" } });
    if (result.outputFiles.length !== 1 || result.outputFiles[0].path !== outfile) throw new Error('Unexpected portable build outputs');
    const bytes = result.outputFiles[0].contents;
    const external = [...new Set(Object.values(result.metafile.outputs).flatMap(item => item.imports
      .filter(item => item.external).map(item => item.path)))].sort();
    if (external.some(name => !isBuiltin(name) && !optionalImports.has(name))) throw new Error('Unexpected portable runtime dependency');
    for (const input of Object.keys(result.metafile.inputs)) {
      const path = resolve(project, input), key = relative(project, path).replaceAll('\\', '/');
      if (key.startsWith('../') || /\.(?:node|wasm|so|dll|dylib)$/i.test(key)) throw new Error('Non-portable bundle input');
      inputs.set(key, hash(await readFile(path)));
      const packagePath = key.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
      if (packagePath && !packages.has(packagePath)) {
        const installed = JSON.parse(await readFile(join(project, packagePath, 'package.json'))), item = lock.packages?.[packagePath];
        if (!item?.version || installed.version !== item.version || !item.integrity) throw new Error('Installed bundle dependency differs from lock');
        packages.set(packagePath, { package: installed.name, version: installed.version, integrity: item.integrity });
      }
    }
    await writeFile(outfile, bytes, { mode: 0o600, flag: 'wx' });
    outputs[name + '.mjs'] = { bytes: bytes.length, sha256: hash(bytes), externalImports: external };
  }
  if (transformations.workerArguments !== 1 || transformations.metricsGuards !== 2) throw new Error('Portable entrypoint transformations incomplete');
  const metadata = { protocol: 1, purpose: 'Portable isolated SDK generators, no game or database process',
    target: 'node22', format: 'esm', bundle: true, packageName: packageJson.name, packageVersion: packageJson.version,
    lockSha256: hash(lockBytes), esbuildVersion, transformations, outputs,
    inputs: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))),
    bundledPackages: Object.fromEntries([...packages].sort(([a], [b]) => a.localeCompare(b))),
    optionalRuntimeImports: [...optionalImports].sort(),
    workload: { unchanged: true, loopbackOnly: true, batchClients: 4, minimumBatchIntervalMs: 200,
      packetsPerSecondPerClient: 30, stepsPerPacket: 2, ackDrainMs: 2000,
      supportedInputModes: ['stress', 'browser-window'], criteriaSource: 'load-stand-contract.ts' },
    notes: ['Only the sibling worker entry path and imported metrics main guard are transformed.',
      'SDK and ws JavaScript are bundled; optional ws native accelerators may be absent and use JavaScript fallback.',
      'No npm install, networking, game startup, database startup or production credentials are used by this build.'] };
  await writeFile(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return metadata;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Build portable Node 22 SDK generators: node scripts/build-load-generators.mjs --out-dir /private/path/FRESH_DIRECTORY');
    console.log('Run node FRESH_DIRECTORY/generators.mjs with the existing generator arguments. No npm installation is needed at runtime.');
    return;
  }
  if (args.length !== 2 || args[0] !== '--out-dir' || !args[1] || args[1].startsWith('--')) throw new Error('Fresh --out-dir required');
  const metadata = await buildLoadGenerators(args[1]);
  console.log(JSON.stringify({ output: resolve(args[1]), lockSha256: metadata.lockSha256, outputs: metadata.outputs }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error(JSON.stringify({ ok: false, code: 'portable-generator-build-failed' })); process.exitCode = 1;
});
