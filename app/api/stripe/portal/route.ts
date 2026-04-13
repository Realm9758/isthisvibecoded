import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { getUserById } from '@/lib/store';

export async function POST() {
  if (!stripe) return Response.json({ error: 'Stripe not configured' }, { status: 503 });

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Not authenticated' }, { status: 401 });

  const user = await getUserById(payload.userId);
  if (!user?.stripeCustomerId) {
    return Response.json({ error: 'No billing account found' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl}/pricing`,
  });

  return Response.json({ url: session.url });
}
