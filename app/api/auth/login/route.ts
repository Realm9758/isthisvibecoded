import { cookies } from 'next/headers';
import { consumeUsage, getUserByEmail } from '@/lib/store';
import { verifyPassword, signToken, AUTH_COOKIE, COOKIE_OPTIONS } from '@/lib/auth';
import { getAnonymousRateLimitKey } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const rateKey = getAnonymousRateLimitKey(request);
  if (!rateKey) return Response.json({ error: 'Authentication is not configured' }, { status: 503 });
  const minuteWindow = new Date().toISOString().slice(0, 16);
  const remaining = await consumeUsage(`auth-login:${rateKey}:${minuteWindow}`, 20).catch(() => null);
  if (remaining === null) return Response.json({ error: 'Could not verify login allowance' }, { status: 503 });
  if (remaining < 0) return Response.json({ error: 'Too many login attempts. Try again shortly.' }, { status: 429 });

  const { email, password } = await request.json().catch(() => ({}));
  if (typeof email !== 'string' || typeof password !== 'string') {
    return Response.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254 || password.length < 1 || password.length > 128) {
    return Response.json({ error: 'Invalid email or password' }, { status: 400 });
  }

  const user = await getUserByEmail(normalizedEmail);
  if (!user) {
    return Response.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return Response.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const token = await signToken({ userId: user.id, email: user.email, plan: user.plan, name: user.name });
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, token, COOKIE_OPTIONS);

  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
  });
}
