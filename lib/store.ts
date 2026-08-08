import { randomBytes } from 'crypto';
import { supabase } from './supabase';
import { VIBE_MODEL_VERSION } from './vibe-constants';
import { SECURITY_MODEL_VERSION } from './security-headers';
import type { AnalysisResult } from '@/types/analysis';

export type Plan = 'free' | 'pro' | 'team';

export class StoreError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: Plan;
  avatarColor?: string;
  avatarUrl?: string;
  bio?: string;
  notifEmail: boolean;
  notifInApp: boolean;
  policyVersion: string | null;
  policyAcceptedAt: number | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: number;
}

export interface StoredScan {
  id: string;
  result: AnalysisResult;
  userId?: string;
  isPublic: boolean;
  roasts: string[];
  createdAt: number;
}

function genId(len = 10): string {
  return randomBytes(Math.ceil(len * 3 / 4)).toString('base64url').slice(0, len);
}

function todayKey(id: string): string {
  return `${id}:${new Date().toISOString().slice(0, 10)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    plan: row.plan as Plan,
    avatarColor: row.avatar_color ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    bio: row.bio ?? undefined,
    notifEmail: row.notif_email ?? false,
    notifInApp: row.notif_inapp ?? true,
    policyVersion: typeof row.policy_version === 'string' ? row.policy_version : null,
    policyAcceptedAt: typeof row.policy_accepted_at === 'number' ? row.policy_accepted_at : null,
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    createdAt: row.created_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isRecord(value) || typeof value.url !== 'string' || typeof value.scannedAt !== 'string') return false;
  if (!isRecord(value.vibe) || !isRecord(value.security) || !isRecord(value.hosting)) return false;
  if (typeof value.vibe.score !== 'number' || !Number.isFinite(value.vibe.score) || value.vibe.score < 0 || value.vibe.score > 100) return false;
  if (
    typeof value.vibe.label !== 'string'
    || typeof value.vibe.confidence !== 'string'
    || !Array.isArray(value.vibe.reasons)
    || !value.vibe.reasons.every(reason => typeof reason === 'string')
  ) return false;
  if (typeof value.security.score !== 'number' || !Number.isFinite(value.security.score) || value.security.score < 0 || value.security.score > 100) return false;
  if (typeof value.security.riskLevel !== 'string' || typeof value.security.httpsEnabled !== 'boolean' || !Array.isArray(value.security.headers)) return false;
  if (!value.security.headers.every(header => isRecord(header) && typeof header.name === 'string' && typeof header.present === 'boolean')) return false;
  if (!Array.isArray(value.hosting.indicators) || !value.hosting.indicators.every(indicator => typeof indicator === 'string')) return false;
  if (value.hosting.provider !== null && typeof value.hosting.provider !== 'string') return false;
  return Array.isArray(value.techStack)
    && value.techStack.every(item => isRecord(item) && typeof item.name === 'string')
    && Array.isArray(value.publicFiles)
    && value.publicFiles.every(item => isRecord(item) && typeof item.path === 'string' && typeof item.accessible === 'boolean')
    && Array.isArray(value.publicKeys)
    && value.publicKeys.every(item => isRecord(item) && typeof item.type === 'string' && typeof item.risk === 'string');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToScan(row: any): StoredScan | undefined {
  if (!row || typeof row.id !== 'string' || typeof row.is_public !== 'boolean' || !isStoredAnalysisResult(row.result)) {
    return undefined;
  }
  return {
    id: row.id,
    result: row.result,
    userId: typeof row.user_id === 'string' ? row.user_id : undefined,
    isPublic: row.is_public,
    roasts: Array.isArray(row.roasts) ? row.roasts.filter((value: unknown): value is string => typeof value === 'string') : [],
    createdAt: typeof row.created_at === 'number' ? row.created_at : 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsToScans(rows: any[]): StoredScan[] {
  return rows.map(rowToScan).filter((scan): scan is StoredScan => scan !== undefined);
}

// ── Users ─────────────────────────────────────────────────────────────────

type CreateUserData = Omit<User, 'id' | 'createdAt' | 'policyVersion' | 'policyAcceptedAt'> & {
  policyVersion: string;
  policyAcceptedAt: number;
};

export async function createUser(data: CreateUserData): Promise<User> {
  const user: User = { ...data, id: genId(), createdAt: Date.now() };
  const { error } = await supabase.from('users').insert({
    id: user.id,
    email: user.email,
    name: user.name,
    password_hash: user.passwordHash,
    plan: user.plan,
    notif_email: user.notifEmail,
    notif_inapp: user.notifInApp,
    policy_version: user.policyVersion,
    policy_accepted_at: user.policyAcceptedAt,
    stripe_customer_id: user.stripeCustomerId ?? null,
    stripe_subscription_id: user.stripeSubscriptionId ?? null,
    created_at: user.createdAt,
  });
  if (error) throw new StoreError(error.message, error.code);
  return user;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToUser(data) : undefined;
}

export async function getUserByName(name: string): Promise<User | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    // Exact matching avoids treating user-controlled `%` and `_` characters as
    // ILIKE wildcards. A dedicated normalized profile slug is planned.
    .eq('name', name)
    .maybeSingle();
  if (error) throw new StoreError(error.message, error.code);
  return data ? rowToUser(data) : undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToUser(data) : undefined;
}

export async function updateUser(id: string, patch: Partial<User>): Promise<User | undefined> {
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.avatarColor !== undefined) updates.avatar_color = patch.avatarColor;
  if ('avatarUrl' in patch) updates.avatar_url = patch.avatarUrl ?? null;
  if (patch.bio !== undefined) updates.bio = patch.bio;
  if (patch.notifEmail !== undefined) updates.notif_email = patch.notifEmail;
  if (patch.notifInApp !== undefined) updates.notif_inapp = patch.notifInApp;
  if (patch.plan !== undefined) updates.plan = patch.plan;
  if (patch.stripeCustomerId !== undefined) updates.stripe_customer_id = patch.stripeCustomerId;
  if ('stripeSubscriptionId' in patch)
    updates.stripe_subscription_id = patch.stripeSubscriptionId ?? null;
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new StoreError(error.message, error.code);
  return data ? rowToUser(data) : undefined;
}

export async function getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToUser(data) : undefined;
}

// ── Scans ─────────────────────────────────────────────────────────────────

export async function saveScan(data: Omit<StoredScan, 'id' | 'createdAt'>): Promise<StoredScan> {
  const scan: StoredScan = { ...data, id: genId(10), createdAt: Date.now() };
  const { error } = await supabase.from('scans').insert({
    id: scan.id,
    result: scan.result,
    user_id: scan.userId ?? null,
    is_public: scan.isPublic,
    roasts: scan.roasts,
    created_at: scan.createdAt,
  });
  if (error) throw new Error(error.message);
  return scan;
}

export async function getScan(id: string): Promise<StoredScan | undefined> {
  const { data, error } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToScan(data) : undefined;
}

export async function updateScan(id: string, patch: Partial<Pick<StoredScan, 'isPublic'>>): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (patch.isPublic !== undefined) updates.is_public = patch.isPublic;
  const { error } = await supabase.from('scans').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

function dedupeByDomain(scans: StoredScan[]): StoredScan[] {
  const seen = new Map<string, StoredScan>();
  for (const scan of scans) {
    try {
      const domain = new URL(scan.result.url).hostname;
      if (!seen.has(domain)) seen.set(domain, scan);
    } catch {
      // keep scans with unparseable URLs as-is using id as key
      if (!seen.has(scan.id)) seen.set(scan.id, scan);
    }
  }
  return [...seen.values()];
}

export function usesCurrentScoringResult(result: unknown): result is AnalysisResult {
  if (!isStoredAnalysisResult(result)) return false;
  return result.vibe.breakdown?.modelVersion === VIBE_MODEL_VERSION
    && result.security.modelVersion === SECURITY_MODEL_VERSION;
}

export function usesCurrentScoring(scan: StoredScan): boolean {
  return usesCurrentScoringResult(scan.result);
}

export async function getPublicScans(limit = 30, since?: number): Promise<StoredScan[]> {
  let query = supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit * 5); // fetch extra so dedup still returns enough
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const deduped = dedupeByDomain(rowsToScans(data ?? []).filter(usesCurrentScoring));
  return deduped.slice(0, limit);
}

export async function getTopVibeScans(limit = 10, since?: number): Promise<StoredScan[]> {
  let query = supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(500);
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // Compare only the latest result per domain under the current model. Taking
  // each domain's historic maximum biases frequently scanned sites upward, and
  // scores from different model versions are not mathematically comparable.
  const latest = new Map<string, StoredScan>();
  for (const scan of rowsToScans(data ?? [])) {
    if (!usesCurrentScoring(scan)) continue;
    try {
      const domain = new URL(scan.result.url).hostname;
      if (!latest.has(domain)) latest.set(domain, scan);
    } catch { /* skip */ }
  }
  return [...latest.values()]
    .sort((a, b) => b.result.vibe.score - a.result.vibe.score)
    .slice(0, limit);
}

export async function getTopSecureScans(limit = 10, since?: number): Promise<StoredScan[]> {
  let query = supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(200);
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const latest = new Map<string, StoredScan>();
  for (const scan of rowsToScans(data ?? [])) {
    if (!usesCurrentScoring(scan)) continue;
    try {
      const domain = new URL(scan.result.url).hostname;
      if (!latest.has(domain)) latest.set(domain, scan);
    } catch { /* skip */ }
  }
  return [...latest.values()]
    .sort((a, b) => b.result.security.score - a.result.security.score)
    .slice(0, limit);
}

export async function getMostScannedDomains(
  limit = 10,
  since?: number
): Promise<{ domain: string; count: number; latestScan: StoredScan }[]> {
  let query = supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(500);
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const counts = new Map<string, { count: number; latestScan: StoredScan }>();
  for (const row of data ?? []) {
    const scan = rowToScan(row);
    if (!scan || !usesCurrentScoring(scan)) continue;
    try {
      const domain = new URL(scan.result.url).hostname;
      const existing = counts.get(domain);
      if (!existing || scan.createdAt > existing.latestScan.createdAt) {
        counts.set(domain, { count: (existing?.count ?? 0) + 1, latestScan: scan });
      } else {
        counts.set(domain, { ...existing, count: existing.count + 1 });
      }
    } catch {
      // skip invalid URLs
    }
  }
  return [...counts.entries()]
    .map(([domain, d]) => ({ domain, ...d }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getPublicScansByUser(userId: string, limit = 20): Promise<StoredScan[]> {
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit * 5);
  if (error) throw new Error(error.message);
  return rowsToScans(data ?? []).filter(usesCurrentScoring).slice(0, limit);
}

export async function getScansByUser(userId: string, limit = 50): Promise<StoredScan[]> {
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return rowsToScans(data ?? []);
}


export async function getDeepScanById(id: string, userId: string) {
  const { data, error } = await supabase
    .from('deep_scans')
    .select('id, domain, result, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ── Usage / Rate limits ───────────────────────────────────────────────────

export async function getDailyCount(id: string): Promise<number> {
  const { data, error } = await supabase
    .from('daily_usage')
    .select('count')
    .eq('key', todayKey(id))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.count as number) ?? 0;
}

export async function incrementUsage(id: string): Promise<void> {
  const { error } = await supabase.rpc('increment_usage', { usage_key: todayKey(id) });
  if (error) throw new Error(error.message);
}

/** Atomically consumes one daily allowance and returns scans remaining, or -1 when denied. */
export async function consumeUsage(id: string, limit: number): Promise<number> {
  const { data, error } = await supabase.rpc('consume_usage', {
    usage_key: todayKey(id),
    usage_limit: limit,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : Number(data ?? -1);
}

export async function refundUsage(id: string): Promise<void> {
  const { error } = await supabase.rpc('refund_usage', { usage_key: todayKey(id) });
  if (error) throw new Error(error.message);
}

export async function getRemainingScans(id: string, plan: Plan): Promise<number | null> {
  if (plan === 'pro' || plan === 'team') return null;
  const used = await getDailyCount(`user:${id}`);
  return Math.max(0, 5 - used);
}

// ── Rank snapshots ────────────────────────────────────────────────────────

export async function saveRankSnapshot(
  entries: { domain: string; rank: number; score: number }[],
  category: 'vibe' | 'secure',
  timeFilter: 'today' | 'week' | 'all',
): Promise<void> {
  if (!entries.length) return;
  const today = new Date().toISOString().split('T')[0];
  const scoringVersion = category === 'vibe' ? VIBE_MODEL_VERSION : SECURITY_MODEL_VERSION;
  const rows = entries.map(e => ({
    domain: e.domain,
    category,
    time_filter: timeFilter,
    rank_position: e.rank,
    score: e.score,
    scoring_version: scoringVersion,
    snapshot_date: today,
  }));
  const { error } = await supabase
    .from('rank_snapshots')
    .upsert(rows, { onConflict: 'domain,category,time_filter,scoring_version,snapshot_date' });
  if (error) throw new Error(error.message);
}

export async function getRankDeltas(
  domains: string[],
  category: 'vibe' | 'secure',
  timeFilter: 'today' | 'week' | 'all',
): Promise<Map<string, number>> {
  if (!domains.length) return new Map();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
  const scoringVersion = category === 'vibe' ? VIBE_MODEL_VERSION : SECURITY_MODEL_VERSION;
  const { data, error } = await supabase
    .from('rank_snapshots')
    .select('domain, rank_position')
    .in('domain', domains)
    .eq('category', category)
    .eq('time_filter', timeFilter)
    .eq('scoring_version', scoringVersion)
    .eq('snapshot_date', yesterday);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map(r => [r.domain as string, r.rank_position as number]));
}

export async function getTopRankStreak(
  domain: string,
  category: 'vibe' | 'secure',
  timeFilter: 'today' | 'week' | 'all',
): Promise<number> {
  const scoringVersion = category === 'vibe' ? VIBE_MODEL_VERSION : SECURITY_MODEL_VERSION;
  const { data, error } = await supabase
    .from('rank_snapshots')
    .select('snapshot_date')
    .eq('domain', domain)
    .eq('category', category)
    .eq('time_filter', timeFilter)
    .eq('scoring_version', scoringVersion)
    .eq('rank_position', 1)
    .order('snapshot_date', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  if (!data?.length) return 0;
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < data.length; i++) {
    const expected = new Date(today);
    expected.setUTCDate(today.getUTCDate() - i);
    const expectedStr = expected.toISOString().split('T')[0];
    if ((data[i].snapshot_date as string) === expectedStr) streak++;
    else break;
  }
  return streak;
}

export async function getHourlyScanCount(): Promise<number> {
  const since = Date.now() - 3_600_000;
  const { count, error } = await supabase
    .from('scans')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
