import { parseArgs } from 'node:util';
import { databaseConfig } from '../server/database';
import { AuditPlayerReportError, exportAuditPlayer, type AuditDetailLookupFilters, type AuditReportFilters } from '../server/audit/report-player';
import { readAuditDetail, requestAuditPeriodReconcile, requestAuditReconcile } from '../server/audit/report-investigation';
import { exportAuditReplay } from '../server/audit/report-replay';
import { readAuditSummary } from '../server/audit/report-summary';

const scope = '--schema <audit-schema> --dataset <uuid>';
const period = scope + ' --from <ISO timestamp with timezone> --to <ISO timestamp with timezone>';
const optionalFilters = '[--category <casino|pvp|totalizator>] [--game <id>] [--mode <id>] [--asset <code>] [--contour <virtual|test|real>]';
const anchor = scope + ' --source <ledger namespace> --posting <row id>';
const usage = 'npm run audit -- player ' + period + ' --account <id> --output <new CSV file> ' + optionalFilters + '\n' +
  'npm run audit -- summary ' + period + ' [--account <id>] ' + optionalFilters + '\n' +
  'npm run audit -- detail ' + anchor + '\n' +
  'npm run audit -- detail ' + scope + ' --source <ledger namespace> ' +
    '(--operation <id> | --round <id> | --match <uuid> | --ticket <uuid>) [--account <id>]\n' +
  'npm run audit -- replay ' + scope + ' --replay <uuid> --output <new JSON file>\n' +
  'npm run audit -- reconcile ' + anchor + ' [--wait] [--refresh]\n' +
  'npm run audit -- reconcile ' + period + ' --source <ledger namespace> [--account <id>] [--wait] [--refresh]';
const invalid = () => new Error('Invalid audit report arguments');
const identifierToken = /^[a-zA-Z0-9._:-]{1,128}$/;

function timestamp(value: string) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (!match) throw new Error('Invalid audit report time');
  const day = new Date(match[1] + '-' + match[2] + '-' + match[3] + 'T00:00:00Z');
  const at = Date.parse(value);
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error('Invalid audit report time');
  }
  return at;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean' },
    schema: { type: 'string' }, dataset: { type: 'string' }, account: { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, output: { type: 'string' },
    category: { type: 'string' }, game: { type: 'string' }, mode: { type: 'string' },
    asset: { type: 'string' }, contour: { type: 'string' },
    source: { type: 'string' }, posting: { type: 'string' }, replay: { type: 'string' },
    operation: { type: 'string' }, round: { type: 'string' }, match: { type: 'string' }, ticket: { type: 'string' },
    wait: { type: 'boolean' }, refresh: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); return; }
  const { schema, dataset, account, from, to, output, category, game, mode, asset, contour, posting, replay, wait, refresh } = values;
  const kind = positionals[0];
  if (positionals.length !== 1 || !schema || !dataset ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(dataset)) throw invalid();
  const connection = process.env.ROYAL_AUDIT_DB_URL_FILE;
  if (!connection) throw new Error('An explicit operator connection is required');
  const config = databaseConfig({
    DATABASE_URL_FILE: connection,
    PGSSLMODE: process.env.ROYAL_AUDIT_PGSSLMODE,
    PGSSLROOTCERT: process.env.ROYAL_AUDIT_PGSSLROOTCERT,
  });
  const permits = (...names: string[]) => Object.keys(values).every(key => key === 'schema' || key === 'dataset' || names.includes(key));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const input = { schema, datasetId: dataset, signal: controller.signal };
    let result;
    if (kind === 'player' || kind === 'summary') {
      const flags = ['from','to','account','category','game','mode','asset','contour'];
      if (kind === 'player') flags.push('output');
      if (!permits(...flags) || !from || !to || (kind === 'player' && (!account || !output)) ||
          (category !== undefined && !['casino','pvp','totalizator'].includes(category)) ||
          (contour !== undefined && !['virtual','test','real'].includes(contour))) throw invalid();
      const filters: AuditReportFilters = {
        accountId: account, fromMs: timestamp(from), toMs: timestamp(to), category: category as AuditReportFilters['category'],
        gameId: game, modeId: mode, asset, contour: contour as AuditReportFilters['contour'],
      };
      result = kind === 'player'
        ? await exportAuditPlayer(config, { ...input, filters: { ...filters, accountId: account! }, destination: output! })
        : await readAuditSummary(config, { ...input, filters });
    } else if (kind === 'detail' || kind === 'reconcile') {
      const source = values.source;
      if (!source || !/^[a-z_][a-z_0-9]{0,62}[.][a-z_][a-z_0-9]{0,62}$/.test(source)) throw invalid();
      if (posting !== undefined) {
        if (!permits(...(kind === 'detail' ? ['source','posting'] : ['source','posting','wait','refresh'])) ||
            !/^[1-9][0-9]{0,18}$/.test(posting) || BigInt(posting) > 9223372036854775807n) throw invalid();
        const filters = { source, postingId: posting };
        result = kind === 'detail' ? await readAuditDetail(config, { ...input, filters })
          : await requestAuditReconcile(config, { ...input, filters: { ...filters, ...(refresh ? { refresh: true } : {}) },
            waitMs: wait ? 40_000 : 0 });
      } else if (kind === 'reconcile') {
        if (!permits('source','from','to','account','wait','refresh') || !from || !to ||
            (account !== undefined && !identifierToken.test(account))) throw invalid();
        result = await requestAuditPeriodReconcile(config, { ...input, filters: {
          source, fromMs: timestamp(from), toMs: timestamp(to),
          ...(account === undefined ? {} : { accountId: account }), ...(refresh ? { refresh: true } : {}),
        }, waitMs: wait ? 40_000 : 0 });
      } else {
        const selectors = (['operation','round','match','ticket'] as const).filter(key => values[key] !== undefined);
        if (selectors.length !== 1 || !permits('source', selectors[0], 'account')) throw invalid();
        const lookupKind = selectors[0], lookupId = values[lookupKind]!;
        if (!identifierToken.test(lookupId) || (account !== undefined && !identifierToken.test(account)) ||
            ((lookupKind === 'match' || lookupKind === 'ticket') &&
              !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(lookupId))) throw invalid();
        const filters: AuditDetailLookupFilters = { source, lookupKind, lookupId, ...(account === undefined ? {} : { accountId: account }) };
        result = await readAuditDetail(config, { ...input, filters });
      }
    } else if (kind === 'replay') {
      if (!permits('replay','output') || !replay || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(replay) || !output) throw invalid();
      result = await exportAuditReplay(config, { ...input, filters: { replayId: replay.toLowerCase() }, destination: output });
    } else throw invalid();
    console.log(JSON.stringify(result));
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

try { await main(); }
catch (error) {
  if (error instanceof AuditPlayerReportError) {
    console.error(JSON.stringify({ error: error.code, jobId: error.jobId }));
    process.exitCode = error.code === 'cancelled' ? 130 : 1;
  } else {
    console.error('Invalid audit arguments or operator connection configuration.');
    console.error(usage);
    process.exitCode = 2;
  }
}
