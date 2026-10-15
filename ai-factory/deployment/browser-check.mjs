import { constants } from 'node:fs';
import { lstat, realpath, readFile, writeFile, mkdtemp, mkdir, rm, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TEST = /^tests\/[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.spec\.ts$/;
const BROWSER = '/opt/pw-browsers/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell';
const clean = {
  PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp/royal-browser-home',
  LANG: 'C.UTF-8', NODE_ENV: 'test', TMPDIR: '/tmp',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', NODE_OPTIONS: '--max-old-space-size=192',
};
let request, directory, postgres, before, testExit = null, detail = '', startedTests = false;

function run(binary, args, { cwd, env = clean, maxBytes = 1024 * 1024, timeoutMs = 500000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0, limited = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    const collect = chunk => {
      bytes += chunk.length;
      if (bytes <= maxBytes) chunks.push(chunk);
      else if (!limited) { limited = true; child.kill('SIGTERM'); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      resolveResult({ code, output: Buffer.concat(chunks).toString('utf8'), limited, timedOut });
    });
  });
}

async function canonical(path, type = 'directory') {
  const info = await lstat(path);
  if (info.isSymbolicLink() || await realpath(path) !== path || (type === 'directory' ? !info.isDirectory() : !info.isFile())) {
    throw new Error('The browser check path is not canonical.');
  }
}

async function git(cwd, args) {
  const result = await run('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.pager=cat', ...args], { cwd, timeoutMs: 15000 });
  if (result.code !== 0 || result.limited || result.timedOut) throw new Error('Candidate Git verification failed.');
  return result.output;
}

async function fingerprint(cwd) {
  if ((await git(cwd, ['rev-parse', 'HEAD'])).trim() !== request.candidate_commit) throw new Error('The candidate commit changed.');
  if ((await git(cwd, ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=all'])).trim()) throw new Error('The candidate has unconfirmed source changes.');
  const names = (await git(cwd, ['ls-files', '-z'])).split('\0').filter(Boolean);
  if (names.length > 20000) throw new Error('The candidate contains too many source files.');
  const hash = createHash('sha256');
  let bytes = 0;
  for (const name of names.sort()) {
    const path = resolve(cwd, name);
    if (!path.startsWith(cwd + '/') || name.includes('\0')) throw new Error('Invalid candidate source path.');
    await canonical(path, 'file');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 32 * 1024 * 1024 || (bytes += info.size) > 128 * 1024 * 1024) throw new Error('Invalid candidate source file.');
      const content = await file.readFile();
      hash.update(JSON.stringify([name, info.mode & 0o777, createHash('sha256').update(content).digest('hex')]) + '\n');
    } finally { await file.close(); }
  }
  hash.update((await git(cwd, ['rev-parse', 'HEAD^{tree}'])).trim());
  return hash.digest('hex');
}

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'candidate_commit,request_id,requirements_version,task_id,tests'
    || !UUID.test(value.request_id) || !UUID.test(value.task_id) || !/^[a-f0-9]{40}$/.test(value.candidate_commit)
    || !Number.isSafeInteger(value.requirements_version) || value.requirements_version < 1
    || !Array.isArray(value.tests) || value.tests.length < 1 || value.tests.length > 8
    || new Set(value.tests).size !== value.tests.length || value.tests.some(name => typeof name !== 'string' || !TEST.test(name))) {
    throw new Error('Invalid browser check request.');
  }
}

function redact(value) {
  return value.replace(/\u2014/g, '-').replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/((?:password|secret|token|api_key)\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
}

let result;
try {
  request = JSON.parse(process.argv[2]); validate(request);
  const cwd = '/workspaces/' + request.task_id;
  if (process.getuid() !== 1000 || process.cwd() !== cwd) throw new Error('Browser checks must use the unprivileged candidate workspace.');
  await canonical(cwd);
  for (const name of ['.git', '.factory', '.codex', '.agents', '.aws', 'tests']) await canonical(join(cwd, name));
  for (const name of request.tests) await canonical(join(cwd, name), 'file');
  await canonical(BROWSER, 'file');
  before = await fingerprint(cwd);
  await mkdir(clean.HOME, { recursive: true });
  const require = createRequire(join(cwd, 'package.json'));
  // This positive control separates browser startup failures from game assertions.
  // A short-lived process releases Playwright's memory before running scenarios.
  const control = await run(process.execPath, ['-e', `
    const {createRequire} = require('node:module');
    const {chromium} = createRequire(process.argv[1] + '/package.json')('playwright-core');
    (async () => {
      const browser = await chromium.launch({executablePath:process.argv[2],headless:true,chromiumSandbox:false,timeout:30000});
      try {
        const page = await browser.newPage();
        await page.goto('data:text/html,<title>isolated browser control</title>');
        if (await page.title() !== 'isolated browser control') throw new Error('Browser positive control failed.');
      } finally { await browser.close(); }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `, cwd, BROWSER], { cwd, timeoutMs:45000 });
  if (control.code !== 0 || control.limited || control.timedOut) {
    detail = control.output;
    throw new Error('The isolated browser positive control failed.');
  }
  directory = await mkdtemp('/tmp/royal-browser-');
  // Build before starting the browser and database to keep memory bounded.
  const build = await run('/usr/local/bin/npm', ['run', 'build'], { cwd, env:{...clean,NODE_ENV:'production',NODE_OPTIONS:'--max-old-space-size=384'},timeoutMs:180000 });
  if (build.code !== 0 || build.limited || build.timedOut) {
    detail = build.output;
    throw new Error('The isolated browser candidate build did not complete.');
  }
  const { default: EmbeddedPostgres } = await import(require.resolve('embedded-postgres'));
  const reservation = createServer();
  await new Promise((yes, no) => { reservation.once('error', no); reservation.listen(0, '127.0.0.1', yes); });
  const port = reservation.address().port;
  await new Promise(yes => reservation.close(yes));
  const password = randomBytes(32).toString('hex');
  const nativeLibraries = join(cwd, 'node_modules/@embedded-postgres/linux-x64/native/lib');
  await canonical(nativeLibraries);
  // This process is the credential-free check container, not the Codex controller.
  process.env.LD_LIBRARY_PATH = nativeLibraries;
  // These credentials belong exclusively to a disposable database in this container.
  postgres = new EmbeddedPostgres({ databaseDir: join(directory, 'pg'), port, user: 'postgres', password,
    persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'shared_buffers=32MB'], onLog: () => {}, onError: () => {} });
  await postgres.initialise(); await postgres.start(); await postgres.createDatabase('royal_test');
  const config = join(directory, 'playwright.config.mjs');
  const reportPath = join(directory, 'report.json');
  await writeFile(config, `import {defineConfig} from ${JSON.stringify(join(cwd, 'node_modules/@playwright/test/index.mjs'))};
export default defineConfig({testDir:${JSON.stringify(join(cwd, 'tests'))},timeout:90000,globalTimeout:480000,workers:1,maxFailures:1,
outputDir:${JSON.stringify(join(directory, 'results'))},reporter:[['line'],['json',{outputFile:${JSON.stringify(reportPath)}}]],
use:{baseURL:'http://127.0.0.1:2567',headless:true,viewport:{width:1440,height:1000},launchOptions:{executablePath:${JSON.stringify(BROWSER)},chromiumSandbox:false}},
webServer:{command:'node dist-server/index.js',cwd:${JSON.stringify(cwd)},url:'http://127.0.0.1:2567/healthz',reuseExistingServer:false,timeout:60000}});
`, { mode: 0o600 });
  const env = { ...clean, DATABASE_URL: '', DATABASE_URL_FILE: '', PGHOST: '127.0.0.1', PGPORT: String(port),
    PGDATABASE: 'royal_test', PGUSER: 'postgres', PGPASSWORD: password, PGPASSWORD_FILE: '', PGSSLMODE: 'disable',
    CODEX_SALE_API_KEY: '', LD_LIBRARY_PATH: nativeLibraries };
  startedTests = true;
  const selectors = request.tests.map(name => '(?:^|/)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  const tests = await run(process.execPath, [join(cwd, 'node_modules/@playwright/test/cli.js'), 'test', '--config', config, ...selectors], { cwd, env });
  testExit = tests.code; detail = tests.output;
  if (tests.limited || tests.timedOut) throw new Error('Browser check exceeded its output or execution bound.');
  await canonical(reportPath, 'file');
  const reportInfo = await lstat(reportPath);
  if (reportInfo.size > 2 * 1024 * 1024) throw new Error('The browser report exceeded its bound.');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const count = ['expected', 'unexpected', 'flaky'].reduce((total, name) => total + (Number.isSafeInteger(report.stats?.[name]) ? report.stats[name] : 0), 0);
  const setupErrors = (report.errors || []).filter(error => {
    const message = String(error.message || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    return !(report.stats?.unexpected > 0 && message === 'Testing stopped early after 1 maximum allowed failures.');
  });
  if (count < 1 || setupErrors.length) throw new Error('Browser checks did not run scenarios or failed during setup.');
  const errors = [], contexts = [];
  const collectErrors = suites => {
    for (const suite of suites || []) {
      collectErrors(suite.suites);
      for (const spec of suite.specs || []) for (const test of spec.tests || []) for (const result of test.results || []) {
        for (const error of result.errors || []) errors.push(String(error.message || ''));
        for (const attachment of result.attachments || []) {
          if (attachment.name === 'error-context' && typeof attachment.path === 'string') contexts.push(attachment.path);
        }
      }
    }
  };
  collectErrors(report.suites);
  for (const path of contexts.slice(0, 1)) {
    if (!path.startsWith(join(directory, 'results') + '/') || !path.endsWith('/error-context.md')) continue;
    try {
      await canonical(path, 'file');
      const info = await lstat(path);
      if (info.nlink === 1 && info.size <= 32768) detail += '\nBrowser failure context:\n' + (await readFile(path, 'utf8')).slice(0, 4000);
    } catch { /* A missing snapshot never changes the measured scenario result. */ }
  }
  if (errors.some(message => /browserType\.launch|Executable doesn't exist|browser has been closed|page crashed|WebServer.*(?:timeout|failed)/i.test(message))) {
    throw new Error('Browser check infrastructure failed during a scenario.');
  }
  if (before !== await fingerprint(cwd)) throw new Error('Browser checks changed candidate source files.');
  result = { status: 'completed', passed: testExit === 0, exit_code: testExit, fingerprint: before, detail: redact(detail).slice(-16000) };
} catch (error) {
  result = { status: 'error', passed: false, exit_code: testExit, detail: redact((error?.message || 'Browser check setup failed.') + '\n' + detail).slice(-16000) };
} finally {
  if (postgres) try { await postgres.stop(); } catch { result = { status: 'error', passed: false, exit_code: testExit, detail: 'The temporary browser database did not stop cleanly.' }; }
  if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
}
// Child output is never forwarded directly to the host response parser.
console.log(JSON.stringify({ ...result, request_id: request?.request_id || null, candidate_commit: request?.candidate_commit || null, started_tests: startedTests }));
// Embedded Postgres installs an exit hook. Keep the measured result authoritative.
process.exit(result.status === 'completed' && result.passed ? 0 : 1);
