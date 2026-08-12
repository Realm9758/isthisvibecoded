import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE, COOKIE_OPTIONS } from '@/lib/auth';
import { absoluteUrl } from '@/lib/site';
import { normalizePublicUrl } from '@/lib/url-safety';
import { mutationRequestError, readBoundedJson } from '@/lib/request-security';
import {
  createOAuthState,
  OAUTH_STATE_COOKIE,
  type HostingProvider,
} from '@/lib/oauth-state';

export async function POST(request: Request) {
  const requestError = mutationRequestError(request);
  if (requestError) return Response.json({ error: requestError }, { status: 403 });

  const cookieStore = await cookies();
  const authToken = cookieStore.get(AUTH_COOKIE)?.value;
  const user = authToken ? await verifyToken(authToken) : null;
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  let provider: HostingProvider;
  let domain: string;
  try {
    const body = await readBoundedJson(request) as Record<string, unknown>;
    if (body?.provider !== 'vercel' && body?.provider !== 'netlify') throw new Error('Invalid provider');
    provider = body.provider;
    domain = normalizePublicUrl(String(body.domain ?? '')).hostname.toLowerCase();
  } catch {
    return Response.json({ error: 'A valid provider and public domain are required' }, { status: 400 });
  }

  const state = await createOAuthState(provider, domain, user.userId);
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    ...COOKIE_OPTIONS,
    maxAge: 10 * 60,
  });

  if (provider === 'vercel') {
    const slug = process.env.VERCEL_INTEGRATION_SLUG;
    if (!slug) return Response.json({ error: 'Vercel verification is not configured yet' }, { status: 503 });
    return Response.json({ authorizationUrl: `https://vercel.com/integrations/${encodeURIComponent(slug)}/new` });
  }

  const clientId = process.env.NETLIFY_OAUTH_CLIENT_ID;
  if (!clientId) return Response.json({ error: 'Netlify verification is not configured yet' }, { status: 503 });
  const url = new URL('https://app.netlify.com/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('redirect_uri', absoluteUrl('/verify/netlify/callback'));
  url.searchParams.set('state', state);
  return Response.json({ authorizationUrl: url.href });
}
