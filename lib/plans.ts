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
      'Passive scans without a daily quota',
      'Active scans without a lifetime quota',
    ],
  },
  pro: {
    name: 'Pro',
    price: 4.99,
    currency: 'gbp',
    scansPerDay: null,
    deepScansTotal: null,
    features: [
      'Passive evidence scans without a daily quota',
      'Experimental active scans without a lifetime quota',
      'Fair-use burst limits still protect scanner availability',
      'The same evidence, history, publishing, and badge tools as Free',
      'Support continued scanner development',
    ],
    missing: [],
  },
} as const;

export type PlanId = keyof typeof PLANS;
