import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifyToken } from './auth';
import { getScan, usesCurrentScoring, type StoredScan } from './store';

export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.userId ?? null;
}

export async function getVisibleScan(id: string): Promise<StoredScan | undefined> {
  const scan = await getScan(id);
  if (!scan) return undefined;
  if (scan.isPublic && usesCurrentScoring(scan)) return scan;

  const userId = await getCurrentUserId();
  // Legacy rows may carry a public flag from the old auto-public behaviour.
  // Their owner can still see them, but no surface should describe them as
  // published until a current-model scan is deliberately published.
  return userId && scan.userId === userId ? { ...scan, isPublic: false } : undefined;
}

export async function getPublicScan(id: string): Promise<StoredScan | undefined> {
  const scan = await getScan(id);
  return scan?.isPublic && usesCurrentScoring(scan) ? scan : undefined;
}
