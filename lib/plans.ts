/** Client-safe plan display data. Secret-bearing Stripe setup lives separately. */
export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    scansPerDay: 5,
    deepScansTotal: 2,
    features: [
      '5 passive evidence scans per day',
      '2 deep scans (lifetime)',
      'Public provenance evidence',
      'Header hardening review',
      'Visible tech stack detection',
      'Shareable published results',
      'Roast Mode',
    ],
    missing: [
      'Unlimited passive scans',
      'Unlimited deep scans',
    ],
  },
  pro: {
    name: 'Pro',
    price: 4.99,
    currency: 'gbp',
    scansPerDay: null,
    deepScansTotal: null,
    features: [
      'Unlimited passive evidence scans',
      'Unlimited experimental active scans',
      'The same evidence, history, publishing, and badge tools as Free',
      'Support continued scanner development',
    ],
    missing: [],
  },
} as const;

export type PlanId = keyof typeof PLANS;
