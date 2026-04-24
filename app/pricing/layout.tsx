import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Pricing — Is This Vibe-Coded?',
  description: 'Free and Pro plans for vibe-code detection, security audits, and vulnerability scanning.',
  alternates: { canonical: `${BASE}/pricing` },
  openGraph: {
    type: 'website',
    url: `${BASE}/pricing`,
    title: 'Pricing — Is This Vibe-Coded?',
    description: 'Free and Pro plans for vibe-code detection, security audits, and vulnerability scanning.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
