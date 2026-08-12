import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { absoluteUrl } from '@/lib/site';
import { OAUTH_STATE_COOKIE, readOAuthState } from '@/lib/oauth-state';
import { providerHasDomain, saveProviderVerification } from '@/lib/provider-verification';
import { pinnedFetch } from '@/lib/pinned-fetch';

function dashboardRedirect(params: Record<string, string>): Response {
  const url = new URL(absoluteUrl('/dashboard'));
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return Response.redirect(url);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const stateToken = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);
  const state = stateToken ? await readOAuthState(stateToken) : null;
  const authToken = cookieStore.get(AUTH_COOKIE)?.value;
  const user = authToken ? await verifyToken(authToken) : null;
  if (!state || state.provider !== 'vercel' || !user || user.userId !== state.userId) {
    return dashboardRedirect({ verificationError: 'The Vercel verification session expired. Try connecting again.' });
  }

  const code = new URL(request.url).searchParams.get('code');
  const clientId = process.env.VERCEL_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.VERCEL_INTEGRATION_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) {
    return dashboardRedirect({ domain: state.domain, verificationError: 'Vercel did not return a usable authorization code.' });
  }

  try {
    const response = await pinnedFetch('https://api.vercel.com/v2/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: absoluteUrl('/api/verify/oauth/vercel/callback'),
      }),
      signal: AbortSignal.timeout(8_000),
      redirect: 'manual',
      maxResponseBytes: 64_000,
    });
    if (!response.ok) throw new Error('Vercel rejected the authorization exchange');
    const token = await response.json() as { access_token?: unknown; team_id?: unknown };
    if (typeof token.access_token !== 'string') throw new Error('Vercel returned no access token');
    const teamId = typeof token.team_id === 'string' ? token.team_id : null;
    if (!await providerHasDomain('vercel', token.access_token, state.domain, teamId)) {
      return dashboardRedirect({
        domain: state.domain,
        verificationError: 'That domain was not found on an accessible Vercel project.',
      });
    }
    await saveProviderVerification(user.userId, 'vercel', token.access_token, teamId, state.domain);
    return dashboardRedirect({ domain: state.domain, intent: 'verified', provider: 'vercel' });
  } catch (error) {
    return dashboardRedirect({
      domain: state.domain,
      verificationError: error instanceof Error ? error.message : 'Vercel verification failed.',
    });
  }
}
