import { stripe } from '@/lib/stripe';
import { store } from '@/lib/store';
import type { Plan } from '@/lib/store';

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
    const plan = session.metadata?.plan as Plan;
    if (userId && plan) {
      store.updateUser(userId, {
        plan,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
      });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customerId = sub.customer as string;
    for (const user of store.users.values()) {
      if (user.stripeCustomerId === customerId) {
        store.updateUser(user.id, { plan: 'free', stripeSubscriptionId: undefined });
        break;
      }
    }
  }

  return Response.json({ received: true });
}
