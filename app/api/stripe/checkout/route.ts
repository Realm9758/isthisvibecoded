import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { PLANS, type PlanId } from '@/lib/plans';
import { getUserById, updateUser } from '@/lib/store';
import {
  selectEntitlingSubscription,
  subscriptionBlocksNewCheckout,
} from '@/lib/stripe-entitlements';
import { absoluteUrl } from '@/lib/site';

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

  const priceId = plan === 'pro' ? process.env.STRIPE_PRO_PRICE_ID : null;
  if (!priceId) {
    return Response.json({ error: `Price ID for ${plan} not configured` }, { status: 503 });
  }

  const user = await getUserById(payload.userId);
  if (!user) return Response.json({ error: 'Account not found' }, { status: 404 });
  if (user.plan !== 'free' || user.stripeSubscriptionId) {
    return Response.json({ error: 'An active subscription is already linked to this account' }, { status: 409 });
  }

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    }, {
      idempotencyKey: `vibe-customer-${user.id}`,
    });
    customerId = customer.id;
    await updateUser(user.id, { stripeCustomerId: customerId });
  }

  // The database can lag behind Stripe when a webhook is delayed. Query the
  // customer's current subscriptions before creating a Checkout Session so a
  // completed or recoverable subscription cannot become a duplicate charge.
  const currentSubscriptions = await stripe.subscriptions.list({
    customer: customerId,
    price: priceId,
    status: 'all',
    limit: 100,
  }).autoPagingToArray({ limit: 500 });
  const currentEntitlement = selectEntitlingSubscription(currentSubscriptions, priceId);
  if (currentEntitlement) {
    await updateUser(user.id, {
      plan: 'pro',
      stripeCustomerId: customerId,
      stripeSubscriptionId: currentEntitlement.id,
    });
    return Response.json(
      { error: 'An active subscription already exists. Your account has been reconciled.' },
      { status: 409 },
    );
  }
  if (currentSubscriptions.some(subscription => subscriptionBlocksNewCheckout(subscription, priceId))) {
    return Response.json(
      { error: 'An existing subscription needs attention. Manage it in billing before starting another.' },
      { status: 409 },
    );
  }

  const existingSessions = await stripe.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 10,
  });
  const existingSession = existingSessions.data.find(session => session.metadata?.plan === plan && session.url);
  if (existingSession?.url) return Response.json({ url: existingSession.url });


  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
    client_reference_id: user.id,
    metadata: { userId: payload.userId, plan },
    subscription_data: { metadata: { userId: payload.userId, plan } },
    success_url: absoluteUrl('/pricing?success=true'),
    cancel_url: absoluteUrl('/pricing?canceled=true'),
  }, {
    // Coalesce concurrent/repeated clicks while still allowing a fresh session
    // shortly after a cancellation or expiry.
    idempotencyKey: `vibe-checkout-${user.id}-${plan}-${Math.floor(Date.now() / 60_000)}`,
  });

  return Response.json({ url: session.url });
}
