import Stripe from 'stripe';

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })
  : null;

export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceId: null,
    scansPerDay: 5,
    deepScansTotal: 2,
    features: [
      '5 passive scans per day',
      '2 deep scans (lifetime)',
      'Full vibe-code detection',
      'Security headers audit',
      'Tech stack detection',
      'Shareable scan links',
      'Roast Mode',
    ],
    missing: [
      'Unlimited deep scans',
      'PDF export',
      'Verified badge embed',
      'Scan history',
    ],
  },
  pro: {
    name: 'Pro',
    price: 4.99,
    currency: 'gbp',
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? null,
    scansPerDay: null,
    deepScansTotal: null,
    features: [
      'Unlimited passive scans',
      'Unlimited deep scans',
      'Everything in Free',
      'PDF export',
      'Verified badge embed code',
      'Scan history',
      'Priority analysis queue',
    ],
    missing: [],
  },
} as const;

export type PlanId = keyof typeof PLANS;
