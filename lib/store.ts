import { randomBytes } from 'crypto';
import { supabase } from './supabase';
import type { AnalysisResult } from '@/types/analysis';

export type Plan = 'free' | 'pro' | 'team';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: Plan;
  avatarColor?: string;
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
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToScan(row: any): StoredScan {
  return {
    id: row.id,
    result: row.result as AnalysisResult,
    userId: row.user_id ?? undefined,
    isPublic: row.is_public,
    roasts: row.roasts as string[],
    createdAt: row.created_at,
  };
}

// ── Users ─────────────────────────────────────────────────────────────────

export async function createUser(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
  const user: User = { ...data, id: genId(), createdAt: Date.now() };
  const { error } = await supabase.from('users').insert({
    id: user.id,
    email: user.email,
    name: user.name,
    password_hash: user.passwordHash,
    plan: user.plan,
    stripe_customer_id: user.stripeCustomerId ?? null,
    stripe_subscription_id: user.stripeSubscriptionId ?? null,
    created_at: user.createdAt,
  });
  if (error) throw new Error(error.message);
  return user;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const { data } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  return data ? rowToUser(data) : undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  return data ? rowToUser(data) : undefined;
}

export async function updateUser(id: string, patch: Partial<User>): Promise<User | undefined> {
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.avatarColor !== undefined) updates.avatar_color = patch.avatarColor;
  if (patch.plan !== undefined) updates.plan = patch.plan;
  if (patch.stripeCustomerId !== undefined) updates.stripe_customer_id = patch.stripeCustomerId;
  if ('stripeSubscriptionId' in patch)
    updates.stripe_subscription_id = patch.stripeSubscriptionId ?? null;
  const { data } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  return data ? rowToUser(data) : undefined;
}

export async function getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
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
  const { data } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  return data ? rowToScan(data) : undefined;
}

export async function updateScan(id: string, patch: Partial<Pick<StoredScan, 'isPublic'>>): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (patch.isPublic !== undefined) updates.is_public = patch.isPublic;
  await supabase.from('scans').update(updates).eq('id', id);
}

export async function getPublicScans(limit = 30): Promise<StoredScan[]> {
  const { data } = await supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map(rowToScan);
}

export async function getTopVibeScans(limit = 10): Promise<StoredScan[]> {
  const { data } = await supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? [])
    .map(rowToScan)
    .sort((a, b) => b.result.vibe.score - a.result.vibe.score)
    .slice(0, limit);
}

export async function getTopSecureScans(limit = 10): Promise<StoredScan[]> {
  const { data } = await supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? [])
    .map(rowToScan)
    .sort((a, b) => b.result.security.score - a.result.security.score)
    .slice(0, limit);
}

export async function getMostScannedDomains(
  limit = 10
): Promise<{ domain: string; count: number; latestScan: StoredScan }[]> {
  const { data } = await supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(500);

  const counts = new Map<string, { count: number; latestScan: StoredScan }>();
  for (const row of data ?? []) {
    const scan = rowToScan(row);
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

// ── Usage / Rate limits ───────────────────────────────────────────────────

export async function getDailyCount(id: string): Promise<number> {
  const { data } = await supabase
    .from('daily_usage')
    .select('count')
    .eq('key', todayKey(id))
    .maybeSingle();
  return (data?.count as number) ?? 0;
}

export async function incrementUsage(id: string): Promise<void> {
  await supabase.rpc('increment_usage', { usage_key: todayKey(id) });
}

export async function getRemainingScans(id: string, plan: Plan): Promise<number | null> {
  if (plan === 'pro' || plan === 'team') return null;
  const used = await getDailyCount(id);
  return Math.max(0, 5 - used);
}
