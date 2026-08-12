/** Client-safe plan display data. Secret-bearing Stripe setup lives separately. */
export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    scansTotal: 3,
    features: [
      '3 full scans',
      'All Surface assessment modules on any URL',
      'Every active module on a domain you verify',
      'Every finding with its evidence and how to fix it',
      'Roast Mode',
    ],
    missing: [
      'Unlimited scans',
      'Scan history and rescan comparison',
    ],
  },
  pro: {
    name: 'Pro',
    price: 4.99,
    currency: 'gbp',
    scansTotal: null,
    features: [
      'Unlimited scans, subject to fair-use burst limits',
      'Every assessment module on domains you verify',
      'Scan history, with a diff of what you fixed since last time',
      'Everything in Free',
    ],
    missing: [],
  },
} as const;

export type PlanId = keyof typeof PLANS;
