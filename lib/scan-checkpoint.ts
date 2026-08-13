import type { CheckCoverage, DeepFinding, ScanPhaseCheckpoint } from '@/types/deep-scan';

const FORMAT = 'ironclad-phase-checkpoint-v1';
const MAX_CHECKPOINT_BYTES = 2_000_000;

type Envelope = { format: typeof FORMAT; data: string };

function finiteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function coverage(value: unknown): value is CheckCoverage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CheckCoverage>;
  return typeof item.phaseId === 'string'
    && finiteCount(item.requestsAttempted)
    && finiteCount(item.requestsCompleted)
    && finiteCount(item.requestsFailed)
    && finiteCount(item.requestsBlocked)
    && typeof item.complete === 'boolean'
    && (item.reason === null || typeof item.reason === 'string');
}

function finding(value: unknown): value is DeepFinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<DeepFinding>;
  return typeof item.id === 'string'
    && typeof item.category === 'string'
    && typeof item.severity === 'string'
    && typeof item.title === 'string'
    && typeof item.description === 'string'
    && typeof item.remediation === 'string';
}

function checkpoint(value: unknown): value is ScanPhaseCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<ScanPhaseCheckpoint>;
  return typeof item.phaseId === 'string'
    && Array.isArray(item.findings)
    && item.findings.every(finding)
    && coverage(item.coverage)
    && item.coverage.phaseId === item.phaseId
    && finiteCount(item.transportAttempts)
    && finiteCount(item.retries);
}

export function encodeScanCheckpoints(items: readonly ScanPhaseCheckpoint[]): string {
  const unique = [...new Map(items.map(item => [item.phaseId, item])).values()];
  const json = JSON.stringify(unique);
  if (Buffer.byteLength(json, 'utf8') > MAX_CHECKPOINT_BYTES) {
    throw new Error('The scan checkpoint exceeded its private storage limit.');
  }
  const envelope: Envelope = { format: FORMAT, data: Buffer.from(json, 'utf8').toString('base64url') };
  return JSON.stringify(envelope);
}

export function decodeScanCheckpoints(value: unknown): ScanPhaseCheckpoint[] {
  if (typeof value !== 'string' || value.length === 0 || value.length > 3_000_000) return [];
  try {
    const envelope = JSON.parse(value) as Partial<Envelope>;
    if (envelope.format !== FORMAT || typeof envelope.data !== 'string') return [];
    const decoded = JSON.parse(Buffer.from(envelope.data, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(decoded) || !decoded.every(checkpoint)) return [];
    return [...new Map(decoded.map(item => [item.phaseId, item])).values()];
  } catch {
    return [];
  }
}
