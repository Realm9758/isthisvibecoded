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
    features: [
      '5 scans per day',
      'Full vibe-code detection',
      'Security headers audit',
      'Tech stack detection',
      'Shareable scan links',
      'Roast Mode',
    ],
    missing: [
      'PDF export',
      'Verified badge embed',
      'Server-side scan history',
      'Unlimited scans',
    ],
  },
  pro: {
    name: 'Pro',
    price: 9,
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? null,
    scansPerDay: null,
    features: [
      'Unlimited scans',
      'Everything in Free',
      'PDF export',
      'Verified badge embed code',
      'Server-side scan history',
      'Priority analysis queue',
    ],
    missing: ['Team seats', 'API access'],
  },
  team: {
    name: 'Team',
    price: 29,
    priceId: process.env.STRIPE_TEAM_PRICE_ID ?? null,
    scansPerDay: null,
    features: [
      'Everything in Pro',
      '5 team seats',
      'API access',
      'Custom badge branding',
      'Dedicated support',
    ],
    missing: [],
  },
} as const;

export type PlanId = keyof typeof PLANS;
