import 'server-only';
import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifyToken } from './auth';
import { supabase } from './supabase';
import type { DeepScanResult } from '@/types/deep-scan';
import type { ScanLane } from './scan-lanes';

/**
 * Reads over `deep_scans`, the single store for both lanes.
 *
 * Every row is private to its owner. A surface scan can describe a site the
 * scanner's user does not own, so there is no public read path at all: no
 * feed, no shareable result page, no way to enumerate which sites were found
 * wanting. That is a deliberate constraint, not a missing feature.
 */

export interface StoredScanRow {
  id: string;
  domain: string;
  userId: string | null;
  lane: ScanLane;
  result: DeepScanResult;
  createdAt: number;
}

interface RawRow {
  id: string;
  domain: string;
  user_id: string | null;
  lane: string | null;
  result: DeepScanResult;
  created_at: number;
}

function toStored(row: RawRow): StoredScanRow {
  return {
    id: row.id,
    domain: row.domain,
    userId: row.user_id,
    // Rows written before the lane split are deep scans by definition.
    lane: (row.lane as ScanLane | null) ?? 'deep',
    result: row.result,
    createdAt: Number(row.created_at),
  };
}

export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.userId ?? null;
}

/** A scan is visible only to the account that owns it. */
export async function getOwnedScan(id: string): Promise<StoredScanRow | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('deep_scans')
    .select('id, domain, user_id, lane, result, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return toStored(data as RawRow);
}

/**
 * The scan immediately before this one, for the same owner, domain, and lane.
 * Lanes are kept apart because a surface grade and a deep grade are different
 * measurements, and comparing them would invent findings that never appeared.
 */
export async function getPreviousScan(scan: StoredScanRow): Promise<DeepScanResult | null> {
  if (!scan.userId) return null;

  const { data, error } = await supabase
    .from('deep_scans')
    .select('result')
    .eq('user_id', scan.userId)
    .eq('domain', scan.domain)
    .eq('lane', scan.lane)
    .lt('created_at', scan.createdAt)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { result: DeepScanResult }).result;
}

export async function listScansForUser(userId: string, limit = 50): Promise<StoredScanRow[]> {
  const { data, error } = await supabase
    .from('deep_scans')
    .select('id, domain, user_id, lane, result, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as RawRow[]).map(toStored);
}
