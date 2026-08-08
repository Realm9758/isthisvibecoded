import { getUserByName, getPublicScansByUser } from '@/lib/store';

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const user = await getUserByName(name);
  if (!user) return Response.json({ error: 'Public profile not found' }, { status: 404 });

  const scans = await getPublicScansByUser(user.id, 20);
  if (scans.length === 0) {
    return Response.json({ error: 'Public profile not found' }, { status: 404 });
  }

  return Response.json({
    name: user.name,
    bio: user.bio ?? null,
    avatarColor: user.avatarColor ?? '#8b5cf6',
    avatarUrl: user.avatarUrl ?? null,
    scans: scans.map(s => ({
      id: s.id,
      url: s.result.url,
      vibeScore: s.result.vibe.score,
      securityScore: s.result.security.score,
      riskLevel: s.result.security.riskLevel,
      techStack: s.result.techStack.slice(0, 4).map((t: { name: string }) => t.name),
      createdAt: s.createdAt,
    })),
  });
}
