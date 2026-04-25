import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { site?: string; issueId?: string; issueTitle?: string; comment?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { site, issueId, issueTitle, comment } = body;
  if (!site || !issueId) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Best-effort insert — table may not exist yet, always return 200
  try {
    await supabase.from('false_positive_reports').insert({
      site,
      issue_id: issueId,
      issue_title: issueTitle ?? '',
      comment: comment ?? '',
      created_at: Date.now(),
    });
  } catch {
    // silently ignore if table doesn't exist
  }

  return Response.json({ ok: true });
}
