import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectEntitlingSubscription,
  subscriptionBlocksNewCheckout,
  subscriptionEntitlesPro,
  type SubscriptionEntitlementCandidate,
} from '../lib/stripe-entitlements';

function subscription(
  id: string,
  status: SubscriptionEntitlementCandidate['status'],
  priceId: string,
  created: number,
): SubscriptionEntitlementCandidate {
  return {
    id,
    status,
    created,
    items: { data: [{ price: { id: priceId } }] },
  };
}

test('only active and trialing subscriptions on the configured price grant Pro', () => {
  assert.equal(subscriptionEntitlesPro(subscription('active', 'active', 'price_pro', 1), 'price_pro'), true);
  assert.equal(subscriptionEntitlesPro(subscription('trial', 'trialing', 'price_pro', 2), 'price_pro'), true);
  assert.equal(subscriptionEntitlesPro(subscription('late', 'past_due', 'price_pro', 3), 'price_pro'), false);
  assert.equal(subscriptionEntitlesPro(subscription('other', 'active', 'price_other', 4), 'price_pro'), false);
});

test('multiple subscriptions resolve to the newest current entitlement', () => {
  const subscriptions = [
    subscription('sub_old', 'active', 'price_pro', 10),
    subscription('sub_new', 'trialing', 'price_pro', 20),
    subscription('sub_canceled', 'canceled', 'price_pro', 30),
  ];

  assert.equal(selectEntitlingSubscription(subscriptions, 'price_pro')?.id, 'sub_new');
});

test('selection is deterministic when qualifying subscriptions share a timestamp', () => {
  const subscriptions = [
    subscription('sub_a', 'active', 'price_pro', 10),
    subscription('sub_b', 'active', 'price_pro', 10),
  ];

  assert.equal(selectEntitlingSubscription(subscriptions, 'price_pro')?.id, 'sub_b');
  assert.equal(selectEntitlingSubscription([...subscriptions].reverse(), 'price_pro')?.id, 'sub_b');
});

test('no current qualifying subscription removes the entitlement', () => {
  const subscriptions = [
    subscription('sub_canceled', 'canceled', 'price_pro', 10),
    subscription('sub_wrong_price', 'active', 'price_other', 20),
  ];

  assert.equal(selectEntitlingSubscription(subscriptions, 'price_pro'), undefined);
});

test('recoverable subscriptions block a duplicate checkout', () => {
  for (const status of ['active', 'trialing', 'incomplete', 'past_due', 'unpaid', 'paused']) {
    assert.equal(
      subscriptionBlocksNewCheckout(subscription(status, status, 'price_pro', 1), 'price_pro'),
      true,
    );
  }
  assert.equal(
    subscriptionBlocksNewCheckout(subscription('canceled', 'canceled', 'price_pro', 1), 'price_pro'),
    false,
  );
  assert.equal(
    subscriptionBlocksNewCheckout(subscription('expired', 'incomplete_expired', 'price_pro', 1), 'price_pro'),
    false,
  );
  assert.equal(
    subscriptionBlocksNewCheckout(subscription('other', 'active', 'price_other', 1), 'price_pro'),
    false,
  );
});
