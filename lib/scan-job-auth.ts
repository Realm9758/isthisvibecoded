import 'server-only';
import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';

export async function currentScanJobUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return (await verifyToken(token))?.userId ?? null;
}
