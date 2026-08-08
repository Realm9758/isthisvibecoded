import { stripe } from '@/lib/stripe';
import { selectEntitlingSubscription } from '@/lib/stripe-entitlements';
import { getUserById, getUserByStripeCustomerId, updateUser } from '@/lib/store';
import type Stripe from 'stripe';

function customerIdFrom(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | undefined {
  return typeof value === 'string' ? value : value?.id;
}

async function reconcileCustomerSubscriptions(
  client: Stripe,
  customerId: string,
  hintedUserId?: string | null,
): Promise<void> {
  const configuredPriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!configuredPriceId) {
    throw new Error('STRIPE_PRO_PRICE_ID is not configured');
  }

  let user = await getUserByStripeCustomerId(customerId);
  if (!user && hintedUserId) {
    const hintedUser = await getUserById(hintedUserId);
    if (!hintedUser || (hintedUser.stripeCustomerId && hintedUser.stripeCustomerId !== customerId)) {
      return;
    }
    user = await updateUser(hintedUser.id, { stripeCustomerId: customerId });
  }
  if (!user) return;

  // Query Stripe's current customer state instead of trusting the event
  // snapshot. This makes delayed or out-of-order webhook deliveries converge on
  // the same entitlement and supports customers with multiple subscriptions.
  const [activeSubscriptions, trialingSubscriptions] = await Promise.all([
    client.subscriptions.list({
      customer: customerId,
      price: configuredPriceId,
      status: 'active',
      limit: 100,
    }).autoPagingToArray({ limit: 500 }),
    client.subscriptions.list({
      customer: customerId,
      price: configuredPriceId,
      status: 'trialing',
      limit: 100,
    }).autoPagingToArray({ limit: 500 }),
  ]);
  const entitlingSubscription = selectEntitlingSubscription(
    [...activeSubscriptions, ...trialingSubscriptions],
    configuredPriceId,
  );

  await updateUser(user.id, {
    plan: entitlingSubscription ? 'pro' : 'free',
    stripeCustomerId: customerId,
    stripeSubscriptionId: entitlingSubscription?.id,
  });
}

export async function POST(request: Request) {
  if (!stripe) return new Response('Stripe not configured', { status: 503 });

  const sig = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return new Response('Missing signature', { status: 400 });

  let event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return new Response(`Webhook error: ${err}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerId = customerIdFrom(session.customer);
    if (customerId) {
      await reconcileCustomerSubscriptions(
        stripe,
        customerId,
        session.metadata?.userId ?? session.client_reference_id,
      );
    }
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.pending_update_applied':
    case 'customer.subscription.pending_update_expired': {
      const subscription = event.data.object;
      const customerId = customerIdFrom(subscription.customer);
      if (customerId) {
        await reconcileCustomerSubscriptions(stripe, customerId, subscription.metadata?.userId);
      }
      break;
    }
  }

  return Response.json({ received: true });
}
