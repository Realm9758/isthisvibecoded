import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * Attaches an anonymous scan to the account that just signed up.
 *
 * It consumes no quota. The visitor already spent their anonymous allowance
 * running this scan, and charging them a second time for the same result
 * would be the worst possible first impression of a paid product.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  let claimToken: string;
  try {
    const body = await request.json();
    if (typeof body?.claimToken !== 'string' || !body.claimToken.trim()) {
      return Response.json({ error: 'A claim token is required' }, { status: 400 });
    }
    claimToken = body.claimToken.trim();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('deep_scans')
    .select('id, user_id, claim_expires_at')
    .eq('claim_token', claimToken)
    .maybeSingle();

  if (error) {
    return Response.json({ error: 'Could not look up the scan' }, { status: 503 });
  }
  if (!row || row.user_id !== null) {
    // One message covers "no such token" and "already claimed" so the
    // endpoint cannot be used to probe which tokens exist.
    return Response.json({ error: 'That scan is no longer available to claim' }, { status: 404 });
  }
  if (!row.claim_expires_at || Number(row.claim_expires_at) < Date.now()) {
    return Response.json({ error: 'That scan has expired. Run a new one.' }, { status: 410 });
  }

  // The `is('user_id', null)` filter makes the update itself the race winner:
  // two simultaneous claims cannot both succeed.
  const { data: claimed, error: updateError } = await supabase
    .from('deep_scans')
    .update({ user_id: payload.userId, claim_token: null, claim_expires_at: null })
    .eq('id', row.id)
    .is('user_id', null)
    .select('id')
    .maybeSingle();

  if (updateError) {
    return Response.json({ error: 'Could not attach the scan to your account' }, { status: 503 });
  }
  if (!claimed) {
    return Response.json({ error: 'That scan is no longer available to claim' }, { status: 404 });
  }

  return Response.json({ scanId: row.id });
}
