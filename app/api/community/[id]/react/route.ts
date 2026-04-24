import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { toggleCommunityReaction } from '@/lib/store';
import type { ReactionType } from '@/lib/store';

const VALID_TYPES: ReactionType[] = ['solid_build', 'interesting_stack', 'surprised'];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  let type: ReactionType;
  try {
    const body = await request.json();
    type = body.type;
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!VALID_TYPES.includes(type)) {
    return Response.json({ error: 'Invalid reaction type' }, { status: 400 });
  }

  const { id } = await params;
  const result = await toggleCommunityReaction(id, payload.userId, type);
  return Response.json(result);
}
