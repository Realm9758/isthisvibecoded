import { getPublicScans, getTopVibeScans, getTopSecureScans, getMostScannedDomains } from '@/lib/store';
import { supabase } from '@/lib/supabase';

async function getUserNames(userIds: (string | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('users').select('id, name').in('id', ids);
  return new Map((data ?? []).map(u => [u.id, u.name as string]));
}

function formatScan(s: ReturnType<typeof Object.assign>, names: Map<string, string>) {
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
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'recent';
  const limit = Math.min(50, Number(searchParams.get('limit') ?? 20));

  if (type === 'popular') {
    const domains = await getMostScannedDomains(limit);
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
  if (type === 'vibe') scans = await getTopVibeScans(limit);
  else if (type === 'secure') scans = await getTopSecureScans(limit);
  else scans = await getPublicScans(limit);

  const names = await getUserNames(scans.map(s => s.userId));
  return Response.json(scans.map(s => formatScan(s, names)));
}
