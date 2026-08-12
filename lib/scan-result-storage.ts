import type { DeepScanResult } from '@/types/deep-scan';

/**
 * Supabase's edge firewall inspects PostgREST request bodies. A security report
 * can legitimately contain strings resembling SQL, XSS, traversal, or header
 * injection payloads, which can make the firewall reject the final insert even
 * though it came from our backend. Store the already-redacted report in an
 * opaque envelope so those strings do not cross the firewall in plain text.
 *
 * This is transport encoding, not encryption. Scan rows remain private through
 * the service-role-only data path and are decoded before they reach the UI.
 */
const STORAGE_FORMAT = 'ironclad-scan-base64url-json-v1';

interface StoredScanEnvelope {
  format: typeof STORAGE_FORMAT;
  data: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeScanResult(value: unknown): value is DeepScanResult {
  if (!isObject(value) || typeof value.domain !== 'string') return false;
  if (!isObject(value.summary) || !Array.isArray(value.findings) || !Array.isArray(value.checked)) return false;
  return true;
}

export function encodeScanResultForStorage(result: DeepScanResult): StoredScanEnvelope {
  return {
    format: STORAGE_FORMAT,
    data: Buffer.from(JSON.stringify(result), 'utf8').toString('base64url'),
  };
}

/** Accepts both newly encoded rows and every legacy plain-JSON result. */
export function decodeScanResultFromStorage(value: unknown): DeepScanResult | null {
  if (looksLikeScanResult(value)) return value;
  if (!isObject(value) || value.format !== STORAGE_FORMAT || typeof value.data !== 'string') return null;

  try {
    const decoded = JSON.parse(Buffer.from(value.data, 'base64url').toString('utf8')) as unknown;
    return looksLikeScanResult(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Keep upstream HTML block pages and infrastructure details out of logs. */
export function summarizeScanStorageError(error: {
  message?: string;
  code?: string;
}): { reason: string; code: string | null } {
  const message = error.message ?? 'Unknown storage error';
  const blocked = /cloudflare|sorry, you have been blocked|attention required/i.test(message);
  return {
    reason: blocked ? 'Upstream storage firewall rejected the request body' : message.slice(0, 500),
    code: error.code ?? null,
  };
}
