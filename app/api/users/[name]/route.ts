import { getUserByName, getPublicScansByUser } from '@/lib/store';

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const user = await getUserByName(decodeURIComponent(name));
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

  const scans = await getPublicScansByUser(user.id, 20);

  return Response.json({
    id: user.id,
    name: user.name,
    bio: user.bio ?? null,
    avatarColor: user.avatarColor ?? '#8b5cf6',
    avatarUrl: user.avatarUrl ?? null,
    plan: user.plan,
    createdAt: user.createdAt,
    scans: scans.map(s => ({
      id: s.id,
      url: s.result.url,
      vibeScore: s.result.vibe.score,
      vibeLabel: s.result.vibe.label,
      securityScore: s.result.security.score,
      riskLevel: s.result.security.riskLevel,
      techStack: s.result.techStack.slice(0, 4).map((t: { name: string }) => t.name),
      createdAt: s.createdAt,
    })),
  });
}
