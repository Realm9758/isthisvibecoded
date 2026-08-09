import { supabase } from '@/lib/supabase';
import { normalizePublicUrl } from '@/lib/url-safety';
import { reserveUsage } from '@/lib/store';
import { getAnonymousRateLimitKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const anonymousKey = getAnonymousRateLimitKey(request);
  if (!anonymousKey) {
    return Response.json({ error: 'Feedback is unavailable until server rate limiting is configured' }, { status: 503 });
  }
  const remaining = await reserveUsage(`feedback:${anonymousKey}`, 10, 'feedback');
  if (remaining === null) {
    return Response.json({ error: 'Could not reserve feedback allowance' }, { status: 503 });
  }
  if (remaining < 0) {
    return Response.json({ error: 'Daily feedback limit reached' }, { status: 429 });
  }

  let body: { site?: string; issueId?: string; issueTitle?: string; comment?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { issueId, issueTitle, comment } = body;
  let site: string;
  try {
    site = normalizePublicUrl(body.site ?? '').href;
  } catch {
    return Response.json({ error: 'A valid public site URL is required' }, { status: 400 });
  }
  if (!site || !issueId) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (issueId.length > 160 || (issueTitle?.length ?? 0) > 300 || (comment?.length ?? 0) > 1_000) {
    return Response.json({ error: 'Feedback field is too long' }, { status: 400 });
  }

  const { error } = await supabase.from('false_positive_reports').insert({
    site,
    issue_id: issueId,
    issue_title: issueTitle ?? '',
    comment: comment ?? '',
    created_at: Date.now(),
  });
  if (error) {
    return Response.json({ error: 'Could not save feedback' }, { status: 503 });
  }

  return Response.json({ ok: true });
}
