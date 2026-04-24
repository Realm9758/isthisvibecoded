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
  avatarUrl?: string;
  bio?: string;
  notifEmail: boolean;
  notifInApp: boolean;
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
    notif_email: user.notifEmail,
    notif_inapp: user.notifInApp,
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

export async function getUserByName(name: string): Promise<User | undefined> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .ilike('name', name)
    .maybeSingle();
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
  if (patch.avatarUrl !== undefined) updates.avatar_url = patch.avatarUrl;
  if (patch.bio !== undefined) updates.bio = patch.bio;
  if (patch.notifEmail !== undefined) updates.notif_email = patch.notifEmail;
  if (patch.notifInApp !== undefined) updates.notif_inapp = patch.notifInApp;
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

export async function getPublicScans(limit = 30, since?: number): Promise<StoredScan[]> {
  let query = supabase
    .from('scans')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit * 5); // fetch extra so dedup still returns enough
  if (since) query = query.gte('created_at', since);
  const { data } = await query;
  const deduped = dedupeByDomain((data ?? []).map(rowToScan));
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
  const { data } = await query;
  // Per domain: keep the scan with the highest vibe score
  const best = new Map<string, StoredScan>();
  for (const scan of (data ?? []).map(rowToScan)) {
    try {
      const domain = new URL(scan.result.url).hostname;
      const existing = best.get(domain);
      if (!existing || scan.result.vibe.score > existing.result.vibe.score) {
        best.set(domain, scan);
      }
    } catch { /* skip */ }
  }
  return [...best.values()]
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
  const { data } = await query;
  const best = new Map<string, StoredScan>();
  for (const scan of (data ?? []).map(rowToScan)) {
    try {
      const domain = new URL(scan.result.url).hostname;
      const existing = best.get(domain);
      if (!existing || scan.result.security.score > existing.result.security.score) {
        best.set(domain, scan);
      }
    } catch { /* skip */ }
  }
  return [...best.values()]
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
  const { data } = await query;

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

export async function getPublicScansByUser(userId: string, limit = 20): Promise<StoredScan[]> {
  const { data } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map(rowToScan);
}

// ── Community Posts ───────────────────────────────────────────────────────

export type ReactionType = 'solid_build' | 'interesting_stack' | 'surprised';

export interface CommunityPost {
  id: string;
  deepScanId: string;
  userId: string;
  posterName: string;
  domain: string;
  caption: string | null;
  score: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  certified: boolean;
  createdAt: number;
  reactions: Record<ReactionType, number>;
  myReactions: ReactionType[];
  commentCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPost(row: any, names: Map<string, string>, reactions: Map<string, Record<ReactionType, number>>, myRxns: Map<string, ReactionType[]>, commentCounts: Map<string, number>): CommunityPost {
  return {
    id: row.id,
    deepScanId: row.deep_scan_id,
    userId: row.user_id,
    posterName: names.get(row.user_id) ?? 'Anonymous',
    domain: row.domain,
    caption: row.caption ?? null,
    score: row.score,
    passCount: row.pass_count,
    warnCount: row.warn_count,
    failCount: row.fail_count ?? 0,
    certified: (row.fail_count ?? 0) === 0,
    createdAt: row.created_at,
    reactions: reactions.get(row.id) ?? { solid_build: 0, interesting_stack: 0, surprised: 0 },
    myReactions: myRxns.get(row.id) ?? [],
    commentCount: commentCounts.get(row.id) ?? 0,
  };
}

async function enrichPosts(rows: Record<string, unknown>[], currentUserId: string | null): Promise<CommunityPost[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id as string);
  const userIds = [...new Set(rows.map(r => r.user_id as string))];

  const [{ data: userRows }, { data: rxnRows }, { data: commentRows }] = await Promise.all([
    supabase.from('users').select('id, name').in('id', userIds),
    supabase.from('community_reactions').select('post_id, user_id, type').in('post_id', ids),
    supabase.from('comments').select('scan_id').in('scan_id', ids),
  ]);

  const names = new Map((userRows ?? []).map(u => [u.id as string, u.name as string]));

  const reactionMap = new Map<string, Record<ReactionType, number>>();
  const myRxnMap = new Map<string, ReactionType[]>();
  for (const r of rxnRows ?? []) {
    const pid = r.post_id as string;
    const t = r.type as ReactionType;
    const cur = reactionMap.get(pid) ?? { solid_build: 0, interesting_stack: 0, surprised: 0 };
    cur[t]++;
    reactionMap.set(pid, cur);
    if (currentUserId && r.user_id === currentUserId) {
      const mine = myRxnMap.get(pid) ?? [];
      mine.push(t);
      myRxnMap.set(pid, mine);
    }
  }

  const commentCountMap = new Map<string, number>();
  for (const c of commentRows ?? []) {
    const sid = c.scan_id as string;
    commentCountMap.set(sid, (commentCountMap.get(sid) ?? 0) + 1);
  }

  return rows.map(r => rowToPost(r, names, reactionMap, myRxnMap, commentCountMap));
}

export async function getCommunityPosts(
  sort: 'new' | 'trending' | 'discussed' | 'score',
  limit: number,
  currentUserId: string | null,
): Promise<CommunityPost[]> {
  const { data: rows } = await supabase
    .from('community_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(sort === 'new' || sort === 'score' ? limit : limit * 3);

  const posts = await enrichPosts(rows ?? [], currentUserId);

  if (sort === 'trending') {
    return posts
      .sort((a, b) => {
        const ta = Object.values(a.reactions).reduce((s, n) => s + n, 0);
        const tb = Object.values(b.reactions).reduce((s, n) => s + n, 0);
        return tb - ta;
      })
      .slice(0, limit);
  }
  if (sort === 'discussed') {
    return posts.sort((a, b) => b.commentCount - a.commentCount).slice(0, limit);
  }
  if (sort === 'score') {
    return posts.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  return posts.slice(0, limit);
}

export async function createCommunityPost(data: {
  deepScanId: string;
  userId: string;
  domain: string;
  caption: string | null;
  score: number;
  passCount: number;
  warnCount: number;
  failCount: number;
}): Promise<CommunityPost> {
  const id = genId(12);
  const row = {
    id,
    deep_scan_id: data.deepScanId,
    user_id: data.userId,
    domain: data.domain,
    caption: data.caption,
    score: data.score,
    pass_count: data.passCount,
    warn_count: data.warnCount,
    fail_count: data.failCount,
    created_at: Date.now(),
  };
  const { error } = await supabase.from('community_posts').insert(row);
  if (error) throw new Error(error.message);
  const posts = await enrichPosts([row], data.userId);
  return posts[0];
}

export async function toggleCommunityReaction(
  postId: string,
  userId: string,
  type: ReactionType,
): Promise<{ reactions: Record<ReactionType, number>; myReactions: ReactionType[] }> {
  const { data: existing } = await supabase
    .from('community_reactions')
    .select('type')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .eq('type', type)
    .maybeSingle();

  if (existing) {
    await supabase.from('community_reactions').delete()
      .eq('post_id', postId).eq('user_id', userId).eq('type', type);
  } else {
    await supabase.from('community_reactions').insert({ post_id: postId, user_id: userId, type });
  }

  const { data: rxnRows } = await supabase
    .from('community_reactions')
    .select('user_id, type')
    .eq('post_id', postId);

  const reactions: Record<ReactionType, number> = { solid_build: 0, interesting_stack: 0, surprised: 0 };
  const myReactions: ReactionType[] = [];
  for (const r of rxnRows ?? []) {
    reactions[r.type as ReactionType]++;
    if (r.user_id === userId) myReactions.push(r.type as ReactionType);
  }
  return { reactions, myReactions };
}

export async function getDeepScanById(id: string, userId: string) {
  const { data } = await supabase
    .from('deep_scans')
    .select('id, domain, result, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
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

// ── Rank snapshots ────────────────────────────────────────────────────────

export async function saveRankSnapshot(
  entries: { domain: string; rank: number; score: number }[],
  category: 'vibe' | 'secure',
  timeFilter: 'today' | 'week' | 'all',
): Promise<void> {
  if (!entries.length) return;
  const today = new Date().toISOString().split('T')[0];
  const rows = entries.map(e => ({
    domain: e.domain,
    category,
    time_filter: timeFilter,
    rank_position: e.rank,
    score: e.score,
    snapshot_date: today,
  }));
  await supabase
    .from('rank_snapshots')
    .upsert(rows, { onConflict: 'domain,category,time_filter,snapshot_date' });
}

export async function getRankDeltas(
  domains: string[],
  category: 'vibe' | 'secure',
  timeFilter: 'today' | 'week' | 'all',
): Promise<Map<string, number>> {
  if (!domains.length) return new Map();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
  const { data } = await supabase
    .from('rank_snapshots')
    .select('domain, rank_position')
    .in('domain', domains)
    .eq('category', category)
    .eq('time_filter', timeFilter)
    .eq('snapshot_date', yesterday);
  return new Map((data ?? []).map(r => [r.domain as string, r.rank_position as number]));
}

export async function getTopRankStreak(domain: string): Promise<number> {
  const { data } = await supabase
    .from('rank_snapshots')
    .select('snapshot_date')
    .eq('domain', domain)
    .eq('rank_position', 1)
    .order('snapshot_date', { ascending: false })
    .limit(30);
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
  const { count } = await supabase
    .from('scans')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  return count ?? 0;
}
