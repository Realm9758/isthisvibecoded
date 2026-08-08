import { stripe } from '@/lib/stripe';
import { updateUser, getUserByStripeCustomerId } from '@/lib/store';
import type Stripe from 'stripe';

function subscriptionEntitlesPro(subscription: Stripe.Subscription): boolean {
  const configuredPrice = process.env.STRIPE_PRO_PRICE_ID;
  return Boolean(
    configuredPrice
    && (subscription.status === 'active' || subscription.status === 'trialing')
    && subscription.items.data.some(item => item.price.id === configuredPrice),
  );
}

async function reconcileSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;
  const user = await getUserByStripeCustomerId(customerId);
  if (!user) return;

  if (subscriptionEntitlesPro(subscription)) {
    // Do not let a late event from an older subscription replace a newer one.
    if (!user.stripeSubscriptionId || user.stripeSubscriptionId === subscription.id) {
      await updateUser(user.id, { plan: 'pro', stripeSubscriptionId: subscription.id });
    }
    return;
  }

  // An old cancellation/unpaid event must not downgrade a newer active plan.
  if (user.stripeSubscriptionId === subscription.id) {
    await updateUser(user.id, { plan: 'free', stripeSubscriptionId: undefined });
  }
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
    const userId = session.metadata?.userId;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
    if (userId && customerId && subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (subscriptionEntitlesPro(subscription)) {
        await updateUser(userId, { stripeCustomerId: customerId });
        await reconcileSubscription(subscription);
      }
    }
  }

  if (
    event.type === 'customer.subscription.created'
    || event.type === 'customer.subscription.updated'
    || event.type === 'customer.subscription.deleted'
  ) {
    await reconcileSubscription(event.data.object);
  }

  return Response.json({ received: true });
}
