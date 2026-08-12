import { randomBytes } from 'crypto';
import { supabase } from './supabase';
import { freeLifetimeKey, remainingFreeScans } from './scan-quota';
import { decodeScanResultFromStorage } from './scan-result-storage';

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

export async function getDeepScanById(id: string, userId: string) {
  const { data, error } = await supabase
    .from('deep_scans')
    .select('id, domain, result, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return data;
  const result = decodeScanResultFromStorage(data.result);
  return result ? { ...data, result } : undefined;
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

/**
 * Reserves one allowance unit, returning the remaining count, or null when the
 * reservation could not be evaluated at all. A null means the limiter itself is
 * broken, meaning an unapplied migration or an unreachable database, not that the
 * caller is over quota, so callers answer 503 rather than 429. The underlying
 * cause is logged here because every caller discards it to avoid leaking
 * database internals to the client.
 */
export async function reserveUsage(id: string, limit: number, tag: string): Promise<number | null> {
  try {
    return await consumeUsage(id, limit);
  } catch (error) {
    console.error('Usage reservation failed', {
      tag,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function refundUsage(id: string): Promise<void> {
  const { error } = await supabase.rpc('refund_usage', { usage_key: todayKey(id) });
  if (error) throw new Error(error.message);
}

export async function getRemainingScans(id: string, plan: Plan): Promise<number | null> {
  if (plan === 'pro' || plan === 'team') return null;
  const { data, error } = await supabase
    .from('daily_usage')
    .select('count')
    .eq('key', freeLifetimeKey(id))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return remainingFreeScans(Number(data?.count ?? 0));
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
