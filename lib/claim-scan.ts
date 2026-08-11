import { apiPath } from './site';
/** Held so a visitor who signs up can claim the scan they already ran. */
export const CLAIM_STORAGE_KEY = 'ironclad:claim';

export interface HeldClaim {
  scanId: string;
  claimToken: string;
}

export function holdClaim(claim: HeldClaim): void {
  try {
    sessionStorage.setItem(CLAIM_STORAGE_KEY, JSON.stringify(claim));
  } catch {
    // A blocked sessionStorage costs the claim, not the report.
  }
}

/**
 * Attaches a scan run before signing up to the account that just appeared,
 * and returns where to send them next.
 *
 * Every failure path returns the fallback. A claim that does not land is a
 * missing shortcut, never a reason to strand somebody on a blank screen right
 * after they gave you their email.
 */
export async function claimHeldScan(fallback = '/'): Promise<string> {
  let held: HeldClaim | null = null;
  try {
    const raw = sessionStorage.getItem(CLAIM_STORAGE_KEY);
    held = raw ? (JSON.parse(raw) as HeldClaim) : null;
  } catch {
    return fallback;
  }
  if (!held?.claimToken) return fallback;

  try {
    sessionStorage.removeItem(CLAIM_STORAGE_KEY);
  } catch {
    // Removal failing only risks a second claim, which the server rejects.
  }

  try {
    const res = await fetch(apiPath('/api/scans/claim'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimToken: held.claimToken }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return typeof data?.scanId === 'string' ? `/result/${data.scanId}` : fallback;
  } catch {
    return fallback;
  }
}
