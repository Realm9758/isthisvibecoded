import {
  getPublicScans,
  getTopVibeScans,
  getTopSecureScans,
  getMostScannedDomains,
  saveRankSnapshot,
  getRankDeltas,
  getTopRankStreak,
} from '@/lib/store';
import { supabase } from '@/lib/supabase';

async function getUserNames(userIds: (string | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('users').select('id, name').in('id', ids);
  return new Map((data ?? []).map(u => [u.id, u.name as string]));
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function sinceFromTime(time: string | null): number | undefined {
  if (time === 'today') return Date.now() - 86_400_000;
  if (time === 'week') return Date.now() - 604_800_000;
  return undefined;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'recent';
  const limit = Math.min(50, Number(searchParams.get('limit') ?? 20));
  const timeParam = searchParams.get('time');
  const since = sinceFromTime(timeParam);
  const timeFilter = (timeParam === 'today' || timeParam === 'week' ? timeParam : 'all') as 'today' | 'week' | 'all';

  if (type === 'popular') {
    const domains = await getMostScannedDomains(limit, since);
    const names = await getUserNames(domains.map(d => d.latestScan.userId));
    return Response.json(domains.map(d => ({
      domain: d.domain,
      count: d.count,
      latestScan: {
        id: d.latestScan.id,
        createdAt: d.latestScan.createdAt,
        scannedBy: d.latestScan.userId ? (names.get(d.latestScan.userId) ?? 'Anonymous') : 'Anonymous',
        result: {
          vibe: { score: d.latestScan.result.vibe.score, label: d.latestScan.result.vibe.label },
          security: { score: d.latestScan.result.security.score, riskLevel: d.latestScan.result.security.riskLevel },
          techStack: d.latestScan.result.techStack.slice(0, 5),
        },
      },
    })));
  }

  let scans;
  if (type === 'vibe') scans = await getTopVibeScans(limit, since);
  else if (type === 'secure') scans = await getTopSecureScans(limit, since);
  else {
    // Recent tab — no rank delta needed
    scans = await getPublicScans(limit, since);
    const names = await getUserNames(scans.map(s => s.userId));
    return Response.json(scans.map(s => ({
      id: s.id,
      url: s.result.url,
      vibeScore: s.result.vibe.score,
      vibeLabel: s.result.vibe.label,
      securityScore: s.result.security.score,
      riskLevel: s.result.security.riskLevel,
      techStack: s.result.techStack.slice(0, 5).map((t: { name: string }) => t.name),
      hosting: s.result.hosting.provider,
      createdAt: s.createdAt,
      scannedBy: s.userId ? (names.get(s.userId) ?? 'Anonymous') : 'Anonymous',
      rankDelta: null,
      previousRank: null,
    })));
  }

  const category = type as 'vibe' | 'secure';
  const names = await getUserNames(scans.map(s => s.userId));

  // Compute current ranks and domains
  const domains = scans.map(s => extractDomain(s.result.url));

  // Fetch yesterday's ranks + #1 streak for top entry in parallel
  const [yesterdayRanks, topStreak] = await Promise.all([
    getRankDeltas(domains, category, timeFilter),
    domains[0] ? getTopRankStreak(domains[0]) : Promise.resolve(0),
  ]);

  // Build response with rank deltas
  const formatted = scans.map((s, i) => {
    const domain = extractDomain(s.result.url);
    const currentRank = i + 1;
    const score = category === 'vibe' ? s.result.vibe.score : s.result.security.score;
    const yesterdayRank = yesterdayRanks.get(domain) ?? null;
    const rankDelta = yesterdayRank !== null ? yesterdayRank - currentRank : null;

    return {
      id: s.id,
      url: s.result.url,
      vibeScore: s.result.vibe.score,
      vibeLabel: s.result.vibe.label,
      securityScore: s.result.security.score,
      riskLevel: s.result.security.riskLevel,
      techStack: s.result.techStack.slice(0, 5).map((t: { name: string }) => t.name),
      hosting: s.result.hosting.provider,
      createdAt: s.createdAt,
      scannedBy: s.userId ? (names.get(s.userId) ?? 'Anonymous') : 'Anonymous',
      rankDelta,
      previousRank: yesterdayRank,
      // Pass streak for #1 so frontend can show "held for X days"
      topStreak: currentRank === 1 ? topStreak : undefined,
      score,
    };
  });

  // Save today's snapshot in the background — don't block the response
  saveRankSnapshot(
    scans.map((s, i) => ({
      domain: extractDomain(s.result.url),
      rank: i + 1,
      score: category === 'vibe' ? s.result.vibe.score : s.result.security.score,
    })),
    category,
    timeFilter,
  ).catch(() => {});

  return Response.json(formatted);
}
