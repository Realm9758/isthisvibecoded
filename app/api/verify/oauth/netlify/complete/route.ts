import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { mutationRequestError, readBoundedJson } from '@/lib/request-security';
import { OAUTH_STATE_COOKIE, readOAuthState } from '@/lib/oauth-state';
import { providerHasDomain, saveProviderVerification } from '@/lib/provider-verification';

export async function POST(request: Request) {
  const requestError = mutationRequestError(request);
  if (requestError) return Response.json({ error: requestError }, { status: 403 });
  const cookieStore = await cookies();
  const authToken = cookieStore.get(AUTH_COOKIE)?.value;
  const user = authToken ? await verifyToken(authToken) : null;
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const body = await readBoundedJson(request).catch(() => null) as { state?: unknown; accessToken?: unknown } | null;
  const cookieState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);
  if (typeof body?.state !== 'string' || body.state !== cookieState || typeof body.accessToken !== 'string') {
    return Response.json({ error: 'The Netlify verification session is invalid or expired' }, { status: 403 });
  }
  const state = await readOAuthState(body.state);
  if (!state || state.provider !== 'netlify' || state.userId !== user.userId) {
    return Response.json({ error: 'The Netlify verification state is invalid' }, { status: 403 });
  }

  try {
    if (!await providerHasDomain('netlify', body.accessToken, state.domain)) {
      return Response.json({ error: 'That domain was not found on an accessible Netlify site' }, { status: 403 });
    }
    await saveProviderVerification(user.userId, 'netlify', body.accessToken, null, state.domain);
    return Response.json({ verified: true, domain: state.domain });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Netlify verification failed' },
      { status: 503 },
    );
  }
}
