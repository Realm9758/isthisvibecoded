import { cookies } from 'next/headers';
import { store } from '@/lib/store';
import { verifyPassword, signToken, AUTH_COOKIE, COOKIE_OPTIONS } from '@/lib/auth';

export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) {
    return Response.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const user = store.getUserByEmail(email);
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
