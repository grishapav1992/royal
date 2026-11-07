import { writeAuditOutput } from './export-file';
import { AuditPlayerReportError } from './report-player';

export async function writeAuditJson(input: { destination: string; value: unknown; maxBytes: number; signal: AbortSignal }) {
  const check = () => input.signal.throwIfAborted();
  check();
  const json = JSON.stringify(input.value);
  if (!input.destination || typeof json !== 'string' || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) {
    throw new Error('Invalid audit JSON export');
  }
  const payload = json + '\n';
  const bytes = Buffer.byteLength(payload, 'utf8');
  if (bytes > input.maxBytes) throw new AuditPlayerReportError('byte-limit', null);
  return writeAuditOutput(input.destination, check, async file => {
    await file.writeFile(payload, 'utf8');
    return { bytes };
  });
}
