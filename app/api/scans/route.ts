import { store } from '@/lib/store';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'recent';
  const limit = Math.min(50, Number(searchParams.get('limit') ?? 20));

  let scans;
  if (type === 'vibe') {
    scans = store.getTopVibeScans(limit);
  } else if (type === 'secure') {
    scans = store.getTopSecureScans(limit);
  } else if (type === 'popular') {
    return Response.json(store.getMostScannedDomains(limit));
  } else {
    scans = store.getPublicScans(limit);
  }

  return Response.json(
    scans.map(s => ({
      id: s.id,
      url: s.result.url,
      vibeScore: s.result.vibe.score,
      vibeLabel: s.result.vibe.label,
      securityScore: s.result.security.score,
      riskLevel: s.result.security.riskLevel,
      techStack: s.result.techStack.slice(0, 5).map(t => t.name),
      hosting: s.result.hosting.provider,
      createdAt: s.createdAt,
    }))
  );
}
