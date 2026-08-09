import { cookies } from 'next/headers';
import { createUser, getUserByEmail, reserveUsage, StoreError } from '@/lib/store';
import { hashPassword, signToken, AUTH_COOKIE, COOKIE_OPTIONS } from '@/lib/auth';
import { ACCOUNT_POLICY_VERSION, isValidDisplayHandle } from '@/lib/policy';
import { getAnonymousRateLimitKey } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const rateKey = getAnonymousRateLimitKey(request);
  if (!rateKey) return Response.json({ error: 'Account creation is not configured' }, { status: 503 });
  const hourWindow = new Date().toISOString().slice(0, 13);
  const remaining = await reserveUsage(`auth-signup:${rateKey}:${hourWindow}`, 5, 'auth:signup');
  if (remaining === null) return Response.json({ error: 'Could not verify signup allowance' }, { status: 503 });
  if (remaining < 0) return Response.json({ error: 'Too many signup attempts. Try again later.' }, { status: 429 });

  const { email, password, name, policyVersion } = await request.json().catch(() => ({}));

  if (typeof email !== 'string' || typeof password !== 'string') {
    return Response.json({ error: 'Email and password are required' }, { status: 400 });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return Response.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 128) {
    return Response.json({ error: 'Password must be 8–128 characters' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'A public display handle is required' }, { status: 400 });
  }
  if (!isValidDisplayHandle(name.trim())) {
    return Response.json(
      { error: 'Display handle may contain letters, numbers, dots, underscores, and hyphens, and must start with a letter or number' },
      { status: 400 },
    );
  }
  if (policyVersion !== ACCOUNT_POLICY_VERSION) {
    return Response.json(
      { error: 'Accept the current privacy and account policy before creating an account' },
      { status: 400 },
    );
  }
  const normalizedName = name.trim();
  if (await getUserByEmail(normalizedEmail)) {
    return Response.json({ error: 'Invalid email or password' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await createUser({
      email: normalizedEmail,
      name: normalizedName,
      passwordHash,
      plan: 'free',
      notifEmail: false,
      notifInApp: true,
      policyVersion: ACCOUNT_POLICY_VERSION,
      policyAcceptedAt: Date.now(),
    });
  } catch (error) {
    // The database uniqueness constraints close the race between lookup and insert.
    if (error instanceof StoreError && error.code === '23505') {
      return Response.json({ error: 'That email or display name is already in use' }, { status: 409 });
    }
    console.error('Account creation database write failed', {
      code: error instanceof StoreError ? error.code : undefined,
    });
    return Response.json({ error: 'Account creation is temporarily unavailable' }, { status: 503 });
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
