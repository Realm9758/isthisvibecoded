import { cookies } from 'next/headers';
import { getUserByEmail, createUser } from '@/lib/store';
import { hashPassword, signToken, AUTH_COOKIE, COOKIE_OPTIONS } from '@/lib/auth';

export async function POST(request: Request) {
  const { email, password, name } = await request.json().catch(() => ({}));

  if (!email || !password) {
    return Response.json({ error: 'Email and password are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }
  if (await getUserByEmail(email)) {
    return Response.json({ error: 'Invalid email or password' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    email: email.toLowerCase().trim(),
    name: (name ?? email.split('@')[0]).trim(),
    passwordHash,
    plan: 'free',
    notifEmail: false,
    notifInApp: true,
  });

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
