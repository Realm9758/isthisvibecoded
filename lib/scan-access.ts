import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifyToken } from './auth';
import { getScan, type StoredScan } from './store';

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
  if (scan.isPublic) return scan;

  const userId = await getCurrentUserId();
  return userId && scan.userId === userId ? scan : undefined;
}

export async function getPublicScan(id: string): Promise<StoredScan | undefined> {
  const scan = await getScan(id);
  return scan?.isPublic ? scan : undefined;
}
