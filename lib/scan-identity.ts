import { SCANNER_INFO_URL } from '@/lib/site';
import type { ScanLane } from '@/lib/scan-lanes';

export const LANE_USER_AGENTS: Record<ScanLane, string> = {
  surface: `Ironclad-Surface/2.0 (+${SCANNER_INFO_URL})`,
  deep: `Ironclad-Deep/2.0 (authorized domain-control scan; +${SCANNER_INFO_URL})`,
};

export const DEEP_SCANNER_USER_AGENT = LANE_USER_AGENTS.deep;
export const DEEP_SCANNER_ID_HEADER = 'x-ironclad-scanner';
export const DEEP_SCANNER_ID_VALUE = 'authorized-deep-scan-v2';

/** Fail closed in production until the queue migration and fixed-egress worker are live. */
export function durableDeepScanEnabled(): boolean {
  return process.env.NODE_ENV !== 'production'
    || process.env.IRONCLAD_DURABLE_SCANNER_ENABLED === 'true';
}

export function scannerEgressIps(): string[] {
  return [...new Set((process.env.IRONCLAD_SCANNER_EGRESS_IPS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0))];
}
