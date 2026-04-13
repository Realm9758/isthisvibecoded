import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { randomBytes } from 'crypto';
import { createNotification } from '@/lib/notifications';
import { sendEmail, commentEmailHtml, replyEmailHtml } from '@/lib/email';

function genId() {
  return randomBytes(8).toString('base64url');
}

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.userId ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scanId = searchParams.get('scanId');
  if (!scanId) return Response.json({ error: 'scanId required' }, { status: 400 });

  const currentUserId = await getCurrentUserId();

  const { data: rows, error } = await supabase
    .from('comments')
    .select('id, user_id, user_name, body, created_at, edited_at, parent_id')
    .eq('scan_id', scanId)
    .order('created_at', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return Response.json([]);

  // Fetch like counts for all comments in one query
  const ids = rows.map(r => r.id);
  const { data: likes } = await supabase
    .from('comment_likes')
    .select('comment_id, user_id')
    .in('comment_id', ids);

  const likeMap = new Map<string, { count: number; likedByMe: boolean }>();
  for (const l of likes ?? []) {
    const entry = likeMap.get(l.comment_id) ?? { count: 0, likedByMe: false };
    entry.count++;
    if (currentUserId && l.user_id === currentUserId) entry.likedByMe = true;
    likeMap.set(l.comment_id, entry);
  }

  const comments = rows.map(r => ({
    id: r.id,
    user_name: r.user_name as string,
    body: r.body as string,
    created_at: r.created_at as number,
    edited_at: r.edited_at as number | null,
    parent_id: r.parent_id as string | null,
    is_mine: currentUserId ? r.user_id === currentUserId : false,
    like_count: likeMap.get(r.id)?.count ?? 0,
    liked_by_me: likeMap.get(r.id)?.likedByMe ?? false,
  }));

  return Response.json(comments);
}

export async function POST(request: Request) {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return Response.json({ error: 'Sign in to post a comment' }, { status: 401 });

  let scanId: string, body: string, parentId: string | null;
  try {
    const json = await request.json();
    scanId = (json.scanId ?? '').trim();
    body = (json.body ?? '').trim();
    parentId = json.parentId ?? null;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!scanId) return Response.json({ error: 'scanId required' }, { status: 400 });
  if (!body) return Response.json({ error: 'Comment cannot be empty' }, { status: 400 });
  if (body.length > 500) return Response.json({ error: 'Comment too long (max 500 chars)' }, { status: 400 });

  const { data: user } = await supabase.from('users').select('name').eq('id', currentUserId).maybeSingle();
  const userName = user?.name ?? 'Anonymous';

  const comment = {
    id: genId(),
    scan_id: scanId,
    user_id: currentUserId,
    user_name: userName,
    body,
    parent_id: parentId ?? null,
    created_at: Date.now(),
    edited_at: null,
  };

  const { error } = await supabase.from('comments').insert(comment);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // ── Fire notifications (non-blocking) ────────────────────────────────────
  void fireCommentNotifications(currentUserId, userName, body, scanId, parentId).catch(() => null);

  return Response.json({
    id: comment.id,
    user_name: userName,
    body,
    created_at: comment.created_at,
    edited_at: null,
    parent_id: comment.parent_id,
    is_mine: true,
    like_count: 0,
    liked_by_me: false,
  });
}

async function fireCommentNotifications(
  commenterId: string,
  commenterName: string,
  body: string,
  scanId: string,
  parentId: string | null,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const scanLink = `${appUrl}/scan/${scanId}`;

  // Fetch scan to get owner info and domain
  const { data: scanRow } = await supabase
    .from('scans')
    .select('user_id, result')
    .eq('id', scanId)
    .maybeSingle();

  let scanDomain = scanId;
  try {
    const r = scanRow?.result as { url?: string } | null;
    const url = r?.url ?? '';
    scanDomain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch { /* ignore */ }

  // Notify scan owner of new comment (if not the commenter themselves)
  const scanOwnerId = scanRow?.user_id as string | null;
  if (scanOwnerId && scanOwnerId !== commenterId) {
    const { data: ownerRow } = await supabase
      .from('users')
      .select('email, notif_inapp, notif_email')
      .eq('id', scanOwnerId)
      .maybeSingle();

    if (ownerRow) {
      if (ownerRow.notif_inapp ?? true) {
        await createNotification(
          scanOwnerId,
          'comment',
          'New comment on your scan',
          `${commenterName} commented on your scan of ${scanDomain}: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`,
          scanLink,
        );
      }
      if (ownerRow.notif_email) {
        await sendEmail(
          ownerRow.email as string,
          `New comment on ${scanDomain}`,
          commentEmailHtml(scanDomain, commenterName, body, scanLink),
        );
      }
    }
  }

  // If this is a reply, notify the parent comment's author
  if (parentId) {
    const { data: parentComment } = await supabase
      .from('comments')
      .select('user_id, user_name')
      .eq('id', parentId)
      .maybeSingle();

    const parentAuthorId = parentComment?.user_id as string | null;
    if (parentAuthorId && parentAuthorId !== commenterId && parentAuthorId !== scanOwnerId) {
      const { data: parentAuthorRow } = await supabase
        .from('users')
        .select('email, notif_inapp, notif_email')
        .eq('id', parentAuthorId)
        .maybeSingle();

      if (parentAuthorRow) {
        if (parentAuthorRow.notif_inapp ?? true) {
          await createNotification(
            parentAuthorId,
            'reply',
            `${commenterName} replied to your comment`,
            `"${body.slice(0, 100)}${body.length > 100 ? '…' : ''}"`,
            scanLink,
          );
        }
        if (parentAuthorRow.notif_email) {
          await sendEmail(
            parentAuthorRow.email as string,
            `${commenterName} replied to your comment`,
            replyEmailHtml(commenterName, body, scanLink),
          );
        }
      }
    }
  }
}
