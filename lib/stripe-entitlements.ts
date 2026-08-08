export interface SubscriptionEntitlementCandidate {
  id: string;
  status: string;
  created: number;
  items: {
    data: Array<{
      price: {
        id: string;
      };
    }>;
  };
}

export function subscriptionEntitlesPro(
  subscription: SubscriptionEntitlementCandidate,
  configuredPriceId: string,
): boolean {
  return (
    (subscription.status === 'active' || subscription.status === 'trialing')
    && subscription.items.data.some(item => item.price.id === configuredPriceId)
  );
}

/**
 * Non-terminal subscriptions must be resolved in Stripe instead of creating a
 * second subscription. This includes failed/incomplete payment states that may
 * later recover and charge the customer.
 */
export function subscriptionBlocksNewCheckout(
  subscription: SubscriptionEntitlementCandidate,
  configuredPriceId: string,
): boolean {
  const hasConfiguredPrice = subscription.items.data.some(
    item => item.price.id === configuredPriceId,
  );
  return hasConfiguredPrice
    && subscription.status !== 'canceled'
    && subscription.status !== 'incomplete_expired';
}

/**
 * Pick one stable subscription to persist when a customer has more than one
 * subscription that grants Pro. Entitlement is customer-wide; the stored ID is
 * only a deterministic reference to the newest qualifying subscription.
 */
export function selectEntitlingSubscription<T extends SubscriptionEntitlementCandidate>(
  subscriptions: readonly T[],
  configuredPriceId: string,
): T | undefined {
  let selected: T | undefined;

  for (const subscription of subscriptions) {
    if (!subscriptionEntitlesPro(subscription, configuredPriceId)) continue;
    if (
      !selected
      || subscription.created > selected.created
      || (subscription.created === selected.created && subscription.id > selected.id)
    ) {
      selected = subscription;
    }
  }

  return selected;
}
