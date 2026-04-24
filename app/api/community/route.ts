import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { getCommunityPosts, createCommunityPost, getDeepScanById } from '@/lib/store';
import type { CheckedItem } from '@/types/deep-scan';

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.userId ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sort = (searchParams.get('sort') ?? 'new') as 'new' | 'trending' | 'discussed' | 'score';
  const limit = Math.min(50, Number(searchParams.get('limit') ?? 30));
  const currentUserId = await getCurrentUserId();

  const posts = await getCommunityPosts(sort, limit, currentUserId);
  return Response.json(posts);
}

export async function POST(request: Request) {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { deepScanId: string; caption?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.deepScanId) {
    return Response.json({ error: 'deepScanId required' }, { status: 400 });
  }

  const scan = await getDeepScanById(body.deepScanId, currentUserId);
  if (!scan) {
    return Response.json({ error: 'Deep scan not found or not owned by you' }, { status: 404 });
  }

  const checked: CheckedItem[] = scan.result?.checked ?? [];
  const caption = body.caption?.trim().slice(0, 280) || null;
  const summary = scan.result?.summary ?? {};
  const passCount = checked.filter((c: CheckedItem) => c.status === 'pass').length;
  const warnCount = checked.filter((c: CheckedItem) => c.status === 'warn').length;
  const failCount = checked.filter((c: CheckedItem) => c.status === 'fail').length;

  try {
    const post = await createCommunityPost({
      deepScanId: body.deepScanId,
      userId: currentUserId,
      domain: scan.domain,
      caption,
      score: summary.score ?? 0,
      passCount,
      warnCount,
      failCount,
    });
    return Response.json(post, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('community_posts_scan_uniq') || msg.includes('duplicate')) {
      return Response.json({ error: 'This scan has already been shared.' }, { status: 409 });
    }
    return Response.json({ error: 'Failed to create post' }, { status: 500 });
  }
}
