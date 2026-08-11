import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Pricing | Ironclad',
  description: 'Free and Pro limits for public provenance evidence, header review, and experimental active checks.',
  alternates: { canonical: `${BASE}/pricing` },
  openGraph: {
    type: 'website',
    url: `${BASE}/pricing`,
    title: 'Pricing | Ironclad',
    description: 'Free and Pro limits for public provenance evidence, header review, and experimental active checks.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
