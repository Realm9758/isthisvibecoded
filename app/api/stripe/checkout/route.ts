import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { stripe, PLANS, type PlanId } from '@/lib/stripe';
import { getUserById } from '@/lib/store';

export async function POST(request: Request) {
  if (!stripe) {
    return Response.json({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' }, { status: 503 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    return Response.json({ error: 'You must be logged in to upgrade' }, { status: 401 });
  }

  const { plan } = await request.json().catch(() => ({})) as { plan?: PlanId };
  if (!plan || !PLANS[plan] || plan === 'free') {
    return Response.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const priceId = PLANS[plan].priceId;
  if (!priceId) {
    return Response.json({ error: `Price ID for ${plan} not configured` }, { status: 503 });
  }

  const user = await getUserById(payload.userId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user?.email,
    metadata: { userId: payload.userId, plan },
    success_url: `${appUrl}/pricing?success=true`,
    cancel_url: `${appUrl}/pricing?canceled=true`,
  });

  return Response.json({ url: session.url });
}
